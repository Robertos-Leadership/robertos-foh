// ════════════════════════════════════════════════════════════
// google-reviews - Supabase Edge Function (FOH project paoaivwtkzujmrgrfjuq)
// Feeds the FOH app's Guest Reviews module.
//
// MODES (daily / digest / reviews):
//   POST {mode:"digest"}                 - the Monday-morning email: the week's
//                                          collected reviews + the pace race +
//                                          star moves, composed ONLY from our
//                                          own tables, sent via Resend to
//                                          Francesco + the GM. {dry:true}
//                                          returns the summary WITHOUT sending.
//   POST {mode:"daily"}                  - for all 7 DIFC venues, three writes:
//                                          (1) today's rating + count row into
//                                          google_reviews_daily (purges at 30d,
//                                          Google's licence); (2) any returned
//                                          review PUBLISHED within the last 7
//                                          days into google_reviews_seen (upsert
//                                          on review resource name, no dupes);
//                                          (3) today's GAIN in rating count into
//                                          google_reviews_pace - OUR derived
//                                          measurement, kept long-term (see the
//                                          licence note in that SQL file).
//                                          Idempotent: safe to call many times a
//                                          day. Meant to run each morning; the
//                                          app also calls it when today's rows
//                                          are missing, so the board is never
//                                          blank.
//   POST {mode:"reviews", venue:"zuma"}  - the 5 reviews Google returns for that
//                                          one venue, fetched live on demand.
//                                          NOTE 15 Jul PM: the UI no longer
//                                          calls this - Francesco ruled the
//                                          "most relevant" five must never be
//                                          shown (months-old reviews). Kept as
//                                          a working diagnostic door only.
//
// WHY THE STORE: Google's 5 are "most relevant", never newest - but the set
// ROTATES, and fresh reviews pass through while they are new. Saving the
// under-7-day ones nightly builds an honest "newest we have collected" list
// (the same accumulation method the CRM's reputation page uses). It is NOT
// complete - a review that never enters the five is never seen - which is why
// no 1-star alerting may ever be promised on it. Stored text purges itself at
// 30 days (Google's licence) via the trigger in foh-google-reviews-store.sql.
//
// GOOGLE'S LIMITS, honoured here and stated on screen (do not "fix" these):
//   - Max 5 reviews per place. No pagination, no sorting. They are Google's
//     "most relevant", NOT the newest - the set changes between calls. So this
//     can never drive 1-star alerting; a bad review may never enter the five.
//   - Their content may not be cached beyond 30 days. Only Place IDs are exempt
//     (which is exactly why they are pinned below, never resolved by search).
//     Snapshots purge at 31 days, stored review text at 30 (both DB triggers).
//     google_reviews_pace is OUR derived daily gain and may keep history.
//
// TRAP: with billing off, the reviews field comes back as {} with HTTP 200 and
// no error at all, while rating/count keep working - it looks exactly like a
// code bug. If reviews are empty, check billing on the Google Cloud project
// before touching this file.
//
// Uses Places API (NEW) - places.googleapis.com. The legacy Places API is not
// available to projects created after March 2025, so ignore legacy examples.
//
// Deploy with verify_jwt = true (the app calls it with the user's session).
// Secrets: GOOGLE_PLACES_API_KEY (Francesco sets this), SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY (both injected automatically).
// NOTE: keep every literal in this file ASCII - non-ASCII gets double-encoded
// by the deploy upload.
// ════════════════════════════════════════════════════════════
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// PINNED Place IDs. Never resolve a competitor by text search at runtime: a
// search can silently return a different branch and the whole board would lie.
// Place IDs are the one Google value we are allowed to store permanently.
const VENUES: { key: string; name: string; place_id: string; us?: boolean }[] = [
  { key: "robertos",   name: "Roberto's",        place_id: "ChIJ2X2-8ZFCXz4RO-NBVI1w_78", us: true },
  { key: "zuma",       name: "Zuma",             place_id: "ChIJZTweiZFCXz4RdaYGx-3ktrA" },
  { key: "lpm",        name: "La Petite Maison", place_id: "ChIJC1IO84VCXz4RdlE5yzrVRes" },
  { key: "cipriani",   name: "Cipriani",         place_id: "ChIJa8y1k5FCXz4RsZH_ppoAeOY" },
  { key: "clap",       name: "Clap",             place_id: "ChIJLc5e2fpDXz4RejqydmKb988" },
  { key: "gattopardo", name: "Il Gattopardo",    place_id: "ChIJg9vdJ-JDXz4RtwWDayzLO8M" },
  { key: "chicnonna",  name: "Chic Nonna",       place_id: "ChIJ28ZA_41DXz4RUL91CkR12rY" },
];

const GP = "https://places.googleapis.com/v1/places/";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const KEY = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!KEY) return json({ error: "GOOGLE_PLACES_API_KEY is not set on this project" }, 503);

  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const CRON_SECRET = Deno.env.get("REVIEWS_CRON_SECRET") || "";

  try {
    const body = await req.json().catch(() => ({}));
    const mode = String(body.mode || "daily");

    // ── Who is asking ─────────────────────────────────────────────────
    // The scheduled morning job presents x-cron-secret. Everyone else is a
    // signed-in app user: the platform has already verified the JWT, so we
    // only read the email out of it and check the module in the database.
    // Default-deny - no app_users row means no access, same as the app.
    const isCron = !!CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;
    if (!isCron) {
      const email = emailFromJwt(req.headers.get("authorization") || "");
      if (!email) return json({ error: "Not signed in" }, 401);
      const uR = await fetch(
        supaUrl + "/rest/v1/app_users?select=modules,is_admin&email=eq." + encodeURIComponent(email.toLowerCase()),
        { headers: { apikey: svcKey, Authorization: "Bearer " + svcKey } },
      );
      const rows = await uR.json();
      const u = Array.isArray(rows) ? rows[0] : null;
      const allowed = !!u && (u.is_admin === true || (Array.isArray(u.modules) && u.modules.indexOf("reviews") !== -1));
      if (!allowed) return json({ error: "You do not have the Guest Reviews module" }, 403);
    }

    // ── MODE: reviews (on demand, never stored) ───────────────────────
    if (mode === "reviews") {
      const v = VENUES.find((x) => x.key === String(body.venue || ""));
      if (!v) return json({ error: "Unknown venue" }, 400);
      const r = await fetch(GP + v.place_id + "?languageCode=en", {
        headers: {
          "X-Goog-Api-Key": KEY,
          "X-Goog-FieldMask": "rating,userRatingCount,googleMapsUri,reviews",
        },
      });
      const d = await r.json();
      if (!r.ok) return json({ error: gErr(d) }, 502);
      // reviews === undefined with a 200 means the Atmosphere tier is not
      // billable on the Cloud project (see the TRAP note at the top), NOT that
      // this venue has no reviews. Say so plainly rather than showing "none".
      const list = Array.isArray(d.reviews) ? d.reviews : [];
      return json({
        venue: v.key,
        name: v.name,
        rating: d.rating ?? null,
        user_rating_count: d.userRatingCount ?? null,
        maps_uri: d.googleMapsUri || null,
        // deno-lint-ignore no-explicit-any
        reviews: list.map((rv: any) => ({
          rating: rv.rating ?? null,
          text: (rv.text && rv.text.text) || (rv.originalText && rv.originalText.text) || "",
          author: (rv.authorAttribution && rv.authorAttribution.displayName) || "A Google user",
          author_uri: (rv.authorAttribution && rv.authorAttribution.uri) || null,
          photo_uri: (rv.authorAttribution && rv.authorAttribution.photoUri) || null,
          publish_time: rv.publishTime || null,
          relative_time: rv.relativePublishTimeDescription || "",
          maps_uri: rv.googleMapsUri || null,
          flag_uri: rv.flagContentUri || null,
        })),
        atmosphere_unavailable: list.length === 0,
      });
    }

    // ── MODE: digest (Monday morning email - the week in reviews) ─────
    // Composed ONLY from our own tables; sends via Resend using the same
    // sender as the closing report. {dry:true} returns the summary without
    // sending - used for testing so no email ever fires unannounced.
    if (mode === "digest") {
      const RESEND = Deno.env.get("RESEND_API_KEY");
      const FROM = "Roberto's DIFC Operations <reports@kitchenteam.robertos.ae>";
      const TO = ["fguarracino@robertos.ae", "onafid@robertos.ae"];
      const hdr = { apikey: svcKey, Authorization: "Bearer " + svcKey };
      const weekIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const monthIso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const [revR, paceR, dailyR] = await Promise.all([
        fetch(supaUrl + "/rest/v1/google_reviews_seen?select=venue_key,rating,review_text,author,publish_time,lang,maps_uri" +
          "&publish_time=gte." + weekIso + "&order=publish_time.desc", { headers: hdr }),
        fetch(supaUrl + "/rest/v1/google_reviews_pace?select=venue_key,day,gained&order=day.asc", { headers: hdr }),
        fetch(supaUrl + "/rest/v1/google_reviews_daily?select=venue_key,snapshot_date,rating&snapshot_date=gte." + monthIso +
          "&order=snapshot_date.asc", { headers: hdr }),
      ]);
      // deno-lint-ignore no-explicit-any
      const revs: any[] = revR.ok ? await revR.json() : [];
      // deno-lint-ignore no-explicit-any
      const paceRows: any[] = paceR.ok ? await paceR.json() : [];
      // deno-lint-ignore no-explicit-any
      const dailyRows: any[] = dailyR.ok ? await dailyR.json() : [];

      const name = (k: string) => (VENUES.find((v) => v.key === k) || { name: k }).name;
      const sums: Record<string, number> = {};
      paceRows.forEach((p) => { sums[p.venue_key] = (sums[p.venue_key] || 0) + Number(p.gained || 0); });
      const race = Object.keys(sums).map((k) => ({ key: k, name: name(k), sum: sums[k] }))
        .sort((a, b) => b.sum - a.sum);
      const firstDay = paceRows.length ? String(paceRows[0].day) : null;
      // Star-rating moves inside the 30-day window we lawfully hold.
      const moves: string[] = [];
      const byVenue: Record<string, { first?: number; last?: number }> = {};
      dailyRows.forEach((r) => {
        const b = byVenue[r.venue_key] = byVenue[r.venue_key] || {};
        if (r.rating != null) { if (b.first == null) b.first = Number(r.rating); b.last = Number(r.rating); }
      });
      Object.keys(byVenue).forEach((k) => {
        const b = byVenue[k];
        if (b.first != null && b.last != null && b.first !== b.last) {
          moves.push(name(k) + " " + (b.last > b.first ? "up " : "down ") + b.first.toFixed(1) + " to " + b.last.toFixed(1));
        }
      });
      const ours = revs.filter((r) => r.venue_key === "robertos");
      const theirs = revs.filter((r) => r.venue_key !== "robertos");
      const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const stars = (n: number) => "&#9733;".repeat(Math.round(Number(n) || 0));
      // deno-lint-ignore no-explicit-any
      const revHtml = (r: any) =>
        '<div style="border:1px solid #E3D7C8;border-left:' + (Number(r.rating) <= 2 ? "4px solid #B3402F" : "1px solid #E3D7C8") +
        ';border-radius:6px;padding:12px 14px;margin:0 0 10px;background:#fff">' +
        '<div style="font:12px Arial,sans-serif;color:#8B7355"><span style="color:#C9A84C">' + stars(r.rating) + "</span> " +
        "<b style=\"color:#2C1810\">" + esc(r.author) + "</b> &middot; " + String(r.publish_time).slice(0, 10) +
        (r.lang && r.lang !== "en" ? " &middot; written in " + esc(String(r.lang).toUpperCase()) : "") + "</div>" +
        '<div style="font:14px Georgia,serif;color:#3d3129;margin-top:6px">' + esc(String(r.review_text || "").slice(0, 420)) + "</div></div>";
      const raceHtml = race.length
        ? "<table style=\"font:13px Arial,sans-serif;color:#2C1810;border-collapse:collapse\">" +
          race.map((x) => "<tr><td style=\"padding:3px 14px 3px 0\">" + (x.key === "robertos" ? "<b>" + esc(x.name) + "</b>" : esc(x.name)) +
            "</td><td style=\"text-align:right\">" + (x.sum < 0 ? "&minus;" : "+") + Math.abs(x.sum) + "</td></tr>").join("") + "</table>"
        : '<div style="font:13px Arial,sans-serif;color:#8B7355">The pace counter has just started - the first race table appears next week.</div>';
      const today10 = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
      const html =
        '<div style="max-width:640px;margin:0 auto;padding:8px">' +
        '<h1 style="font:600 22px Georgia,serif;color:#400207;margin:6px 0 2px">Guest Reviews &mdash; the week</h1>' +
        '<div style="font:12px Arial,sans-serif;color:#8B7355;margin-bottom:18px">Week ending ' + today10 + " &middot; from the FOH app's nightly collection</div>" +
        '<h2 style="font:600 15px Georgia,serif;color:#400207;margin:16px 0 8px">New at Roberto&rsquo;s (' + ours.length + ")</h2>" +
        (ours.length ? ours.map(revHtml).join("") :
          '<div style="font:13px Arial,sans-serif;color:#8B7355">Nothing under a week old surfaced - Google shows only a small rotating sample, so quiet weeks happen.</div>') +
        '<h2 style="font:600 15px Georgia,serif;color:#400207;margin:18px 0 8px">The race &middot; new ratings' + (firstDay ? " since " + firstDay : "") + "</h2>" + raceHtml +
        (moves.length ? '<h2 style="font:600 15px Georgia,serif;color:#400207;margin:18px 0 8px">Star moves (30 days)</h2><div style="font:13px Arial,sans-serif;color:#2C1810">' + moves.map(esc).join("<br>") + "</div>" : "") +
        (theirs.length ? '<h2 style="font:600 15px Georgia,serif;color:#400207;margin:18px 0 8px">Collected at competitors (' + theirs.length + ")</h2>" + theirs.slice(0, 8).map((r) => revHtml({ ...r, author: name(r.venue_key) + " - " + r.author })).join("") : "") +
        '<div style="font:11px Arial,sans-serif;color:#9c8a72;margin-top:18px;line-height:1.6">Reviews from Google, collected nightly while under 7 days old; not every review - one can be missing entirely. Full inbox: SevenRooms Guest Satisfaction. This email is assembled from the app&rsquo;s own tables; no figure in it is written by hand or by an AI.</div></div>';

      if (body.dry) {
        return json({ dry: true, ours: ours.length, competitors: theirs.length, race, moves, html_bytes: html.length, to: TO });
      }
      if (!RESEND) return json({ error: "RESEND_API_KEY is not set on this project" }, 503);
      const eR = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + RESEND, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: TO, subject: "Guest Reviews - the week at Roberto's (" + today10 + ")", html }),
      });
      const eD = await eR.json().catch(() => ({}));
      if (!eR.ok) return json({ error: "Resend refused: " + JSON.stringify(eD).slice(0, 200) }, 502);
      return json({ sent: true, id: eD.id || null, ours: ours.length, competitors: theirs.length });
    }

    // ── MODE: daily (snapshot + fresh-review harvest for all 7) ───────
    if (mode !== "daily") return json({ error: "Unknown mode" }, 400);

    // Dubai is UTC+4 and has no daylight saving, so the shift is constant.
    const today = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const seen: Record<string, unknown>[] = [];

    // ── PRIMARY NET: SerpApi (Francesco's informed go, 16 Jul) ─────────
    // Returns the actual NEWEST reviews per venue - the thing Google's own
    // API refuses to do. ~210 calls/month fits their free tier. It works by
    // scraping Google (their ToS risk, provider-side); the decision and the
    // trade-off are recorded in the module memory - do not silently remove
    // OR silently expand. When the key is set and delivers, the Google
    // rotating-five harvest below is SKIPPED so the same review can never
    // land under two different keys (which would display twice).
    const SERP = Deno.env.get("SERPAPI_KEY");
    let serpKept = 0, serpFail = 0;
    if (SERP) {
      await Promise.all(VENUES.map(async (v) => {
        try {
          const r = await fetch("https://serpapi.com/search.json?engine=google_maps_reviews&place_id=" +
            v.place_id + "&sort_by=newestFirst&hl=en&api_key=" + SERP);
          const d = await r.json();
          if (!r.ok || d.error) { serpFail++; return; }
          // deno-lint-ignore no-explicit-any
          (Array.isArray(d.reviews) ? d.reviews : []).forEach((rv: any) => {
            const pub = Date.parse(rv.iso_date || "");
            if (!pub || pub < weekAgo) return; // only under-7-day reviews, his rule
            seen.push({
              venue_key: v.key,
              review_key: "serp:" + (rv.review_id || (((rv.user && rv.user.name) || "anon") + "|" + rv.iso_date)),
              rating: rv.rating ?? null,
              review_text: ((rv.extracted_snippet && rv.extracted_snippet.translated && rv.extracted_snippet.translated.snippet) ||
                rv.snippet || "").slice(0, 2000),
              author: (rv.user && rv.user.name) || "A Google user",
              author_uri: (rv.user && rv.user.link) || null,
              maps_uri: rv.link || null,
              publish_time: new Date(pub).toISOString(),
              lang: rv.original_language || null,
              last_seen: today,
              _pri: 2,
            });
            serpKept++;
          });
        } catch (_e) { serpFail++; }
      }));
    }
    const useGoogleNet = !SERP || serpKept === 0 && serpFail >= VENUES.length; // fallback if SerpApi is absent or fully down

    const results = await Promise.all(VENUES.map(async (v) => {
      try {
        // One call per venue. The "reviews" field is only requested when the
        // Google rotating-five net is the active source - it is the dearer
        // Enterprise+Atmosphere tier, pointless when SerpApi delivers.
        const mask = useGoogleNet ? "id,rating,userRatingCount,reviews" : "id,rating,userRatingCount";
        const r = await fetch(GP + v.place_id + "?languageCode=en", {
          headers: { "X-Goog-Api-Key": KEY, "X-Goog-FieldMask": mask },
        });
        const d = await r.json();
        if (!r.ok) return { key: v.key, error: gErr(d) };
        // Keep only reviews PUBLISHED in the last 7 days (Francesco's rule:
        // "only collect reviews one week old - even if they are fewer").
        // deno-lint-ignore no-explicit-any
        (Array.isArray(d.reviews) ? d.reviews : []).forEach((rv: any) => {
          const pub = Date.parse(rv.publishTime || "");
          if (!rv.name || !pub || pub < weekAgo) return;
          seen.push({
            venue_key: v.key,
            review_key: rv.name,
            rating: rv.rating ?? null,
            review_text: ((rv.text && rv.text.text) || (rv.originalText && rv.originalText.text) || "").slice(0, 2000),
            author: (rv.authorAttribution && rv.authorAttribution.displayName) || "A Google user",
            author_uri: (rv.authorAttribution && rv.authorAttribution.uri) || null,
            maps_uri: rv.googleMapsUri || null,
            publish_time: rv.publishTime,
            lang: (rv.originalText && rv.originalText.languageCode) || (rv.text && rv.text.languageCode) || "en",
            last_seen: today,
            _pri: 1, // English pull: its (translated) text wins the dedupe
          });
        });
        return {
          venue_key: v.key,
          place_id: v.place_id,
          snapshot_date: today,
          rating: d.rating ?? null,
          user_rating_count: d.userRatingCount ?? null,
        };
      } catch (e) {
        return { key: v.key, error: String((e as Error)?.message || e).slice(0, 120) };
      }
    }));

    // ── LANGUAGE NET (fallback source only): Google returns a DIFFERENT
    // handful per language, so a second pull in Russian (Dubai's biggest
    // non-English reviewer group) roughly doubles what the rotating-five net
    // catches. Skipped entirely while SerpApi is delivering - one source at a
    // time, so a review can never appear under two keys. Failures swallowed -
    // the extra net must never sink the main pull.
    if (useGoogleNet) await Promise.all(VENUES.map(async (v) => {
      try {
        const r = await fetch(GP + v.place_id + "?languageCode=ru", {
          headers: { "X-Goog-Api-Key": KEY, "X-Goog-FieldMask": "reviews" },
        });
        const d = await r.json();
        if (!r.ok) return;
        // deno-lint-ignore no-explicit-any
        (Array.isArray(d.reviews) ? d.reviews : []).forEach((rv: any) => {
          const pub = Date.parse(rv.publishTime || "");
          if (!rv.name || !pub || pub < weekAgo) return;
          seen.push({
            venue_key: v.key,
            review_key: rv.name,
            rating: rv.rating ?? null,
            review_text: ((rv.originalText && rv.originalText.text) || (rv.text && rv.text.text) || "").slice(0, 2000),
            author: (rv.authorAttribution && rv.authorAttribution.displayName) || "A Google user",
            author_uri: (rv.authorAttribution && rv.authorAttribution.uri) || null,
            maps_uri: rv.googleMapsUri || null,
            publish_time: rv.publishTime,
            lang: (rv.originalText && rv.originalText.languageCode) || (rv.text && rv.text.languageCode) || "ru",
            last_seen: today,
            _pri: 0, // language-net catch: loses the dedupe to an English-pull row
          });
        });
      } catch (_e) { /* the net is best-effort by design */ }
    }));

    const rows = results.filter((x) => !("error" in x));
    const failed = results.filter((x) => "error" in x);

    // ── PACE: our own measurement, computed while both totals are lawfully
    // held (both inside the 30-day window). gained = today - previous look.
    // Google never returns this number; we may keep it long-term. Can be
    // negative (Google removes spam). over_days > 1 covers missed nights.
    // deno-lint-ignore no-explicit-any
    const pace: Record<string, unknown>[] = [];
    let paceErr: string | null = null;
    try {
      const pR = await fetch(
        supaUrl + "/rest/v1/google_reviews_daily?select=venue_key,snapshot_date,user_rating_count" +
          "&snapshot_date=lt." + today + "&order=snapshot_date.desc&limit=100",
        { headers: { apikey: svcKey, Authorization: "Bearer " + svcKey } },
      );
      if (!pR.ok) throw new Error((await pR.text()).slice(0, 150));
      const prior = await pR.json();
      const prev: Record<string, { d: string; c: number }> = {};
      // deno-lint-ignore no-explicit-any
      (Array.isArray(prior) ? prior : []).forEach((p: any) => {
        // rows arrive newest-first; keep the first (most recent) per venue
        if (!prev[p.venue_key] && p.user_rating_count != null) {
          prev[p.venue_key] = { d: String(p.snapshot_date).slice(0, 10), c: Number(p.user_rating_count) };
        }
      });
      // deno-lint-ignore no-explicit-any
      rows.forEach((r: any) => {
        const p = prev[r.venue_key];
        if (!p || r.user_rating_count == null) return; // first-ever day: nothing to measure yet
        const span = Math.max(1, Math.round((Date.parse(today) - Date.parse(p.d)) / 86400000));
        pace.push({
          venue_key: r.venue_key,
          day: today,
          gained: Number(r.user_rating_count) - p.c,
          over_days: span,
        });
      });
      if (pace.length) {
        const wP = await fetch(supaUrl + "/rest/v1/google_reviews_pace?on_conflict=venue_key,day", {
          method: "POST",
          headers: {
            apikey: svcKey,
            Authorization: "Bearer " + svcKey,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(pace),
        });
        if (!wP.ok) paceErr = (await wP.text()).slice(0, 200);
      }
    } catch (e) {
      // Pace must never break the board or the harvest - report and move on.
      paceErr = String((e as Error)?.message || e).slice(0, 200);
    }

    // One venue failing must not lose the other six - write what we have.
    if (rows.length) {
      const wR = await fetch(supaUrl + "/rest/v1/google_reviews_daily?on_conflict=venue_key,snapshot_date", {
        method: "POST",
        headers: {
          apikey: svcKey,
          Authorization: "Bearer " + svcKey,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(rows),
      });
      if (!wR.ok) return json({ error: "Write failed: " + (await wR.text()).slice(0, 200) }, 500);
    }
    // Fresh reviews: upsert on (venue_key, review_key) so a review seen on
    // several nights stays ONE row (first_seen keeps its original value; the
    // DB trigger purges anything first seen >30 days ago). If this table is
    // missing (SQL not run yet) the snapshot above must still succeed - the
    // store is reported in the response, never allowed to break the board.
    // The same review can arrive from both language pulls; Postgres rejects a
    // payload that touches one row twice, so dedupe first (higher _pri wins).
    const byKey: Record<string, Record<string, unknown>> = {};
    seen.forEach((s) => {
      const k = String(s.venue_key) + "|" + String(s.review_key);
      if (!byKey[k] || Number(s._pri || 0) > Number(byKey[k]._pri || 0)) byKey[k] = s;
    });
    const unique = Object.values(byKey).map((s) => {
      const row = { ...s };
      delete row._pri;
      return row;
    });
    let harvested = 0, harvestErr: string | null = null;
    if (unique.length) {
      const sR = await fetch(supaUrl + "/rest/v1/google_reviews_seen?on_conflict=venue_key,review_key", {
        method: "POST",
        headers: {
          apikey: svcKey,
          Authorization: "Bearer " + svcKey,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(unique),
      });
      if (sR.ok) harvested = unique.length;
      else harvestErr = (await sR.text()).slice(0, 200);
    }
    return json({
      date: today, written: rows.length, failed,
      reviews_kept: harvested, reviews_store_error: harvestErr,
      pace_written: pace.length, pace_error: paceErr,
      source: SERP ? (useGoogleNet ? "google-net (serpapi down)" : "serpapi") : "google-net",
      serp_kept: serpKept, serp_failed_venues: serpFail,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});

// The platform verifies the JWT signature before we ever run; this only reads
// the email claim out of the already-verified payload.
function emailFromJwt(auth: string): string {
  try {
    const t = auth.replace(/^Bearer\s+/i, "");
    const p = t.split(".")[1];
    if (!p) return "";
    const pad = p.replace(/-/g, "+").replace(/_/g, "/");
    const j = JSON.parse(atob(pad + "=".repeat((4 - pad.length % 4) % 4)));
    return String(j.email || "");
  } catch (_e) {
    return "";
  }
}

// deno-lint-ignore no-explicit-any
function gErr(d: any): string {
  return String((d && d.error && d.error.message) || "Google rejected the request").slice(0, 200);
}
