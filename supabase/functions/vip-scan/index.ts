// ════════════════════════════════════════════════════════════
// vip-scan  ·  "is anyone in tonight's book a public figure?"
//
// The app sends tonight's guests (client id + name). This returns, for each
// one, either nothing or a NAME MATCH against a genuinely notable person.
//
// WHAT THIS IS NOT: it is not identification. Nothing here can tell you that
// the Jennifer Lopez on table 21 is the Jennifer Lopez. It tells you that the
// name belongs to somebody notable, which is a reason for a manager to look --
// and that is the whole claim. The app's wording ("possible public figure --
// verify") and the confirm/dismiss step exist because of this limit, not in
// spite of it.
//
// WHY THE BAR IS SET HIGH. The failure mode that kills a feature like this is
// not missing a celebrity, it is crying wolf. Google will return something for
// literally any name, so a naive search flags every guest, the team learns
// within a week that the badge means nothing, and then it means nothing on the
// night it mattered. So: a match needs a Wikipedia-grade entity, typed as a
// person, above a notability floor. Everything else is recorded as `clear` and
// never shown. Better to miss a minor figure than to train the team to ignore
// the chip.
//
// TWO SOURCES, ONE FALLBACK:
//   1. Google Knowledge Graph, using the GOOGLE_PLACES_API_KEY that already
//      exists on this project for the reviews module. Same Google Cloud
//      project -- but a key only works on APIs enabled for that project, so
//      this may come back 403. That is EXPECTED and is not an error state.
//   2. Wikidata, which needs no key at all and covers essentially every
//      person with a Wikipedia article.
//   If Google is not authorised, this quietly runs on Wikidata alone and
//   reports which source it used, so the admin screen can show the truth
//   instead of a silent half-working feature.
//
// Results are cached in guest_notability forever -- including the misses. A
// guest who is nobody famous is written as `clear` so tomorrow's scan skips
// them entirely. Without that, the same 40 names get looked up every night.
//
// Deploy with verify_jwt = true (the app calls it with the user's session).
// Secrets: GOOGLE_PLACES_API_KEY (optional), SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY (both injected automatically).
// NOTE: keep every literal in this file ASCII - non-ASCII gets double-encoded
// by the deploy upload.
// ════════════════════════════════════════════════════════════
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── The notability floor ────────────────────────────────────────────
// Google's resultScore is unbounded and roughly tracks how much the world
// writes about an entity. Jennifer Lopez scores in the thousands; a footballer
// in one national league scores in the hundreds; a person who merely has a
// page scores in the tens. 250 sits above "has a page" and below "regionally
// famous", which is the line a Dubai restaurant cares about.
const KG_MIN_SCORE = 250;
// Wikidata has no score, so the proxy is sitelinks: how many language
// Wikipedias carry an article. 12+ means genuinely international. A local
// businessman with a single Arabic-language stub does not clear this.
const WD_MIN_SITELINKS = 12;

// ── The seniority route ─────────────────────────────────────────────
// The fame floor above is the wrong instrument for the guest Francesco most
// wants to know about: the chief executive of a bank. That person is rarely on
// Wikipedia in twelve languages, and often not in English at all -- but they
// may well have a Wikidata entry with two or three.
//
// The fix is NOT to lower the fame floor. Dropping to 3 sitelinks for everyone
// lets every minor historical figure back in -- that is precisely the "John
// Smith, Labour leader" noise the death filter was added to kill.
//
// Instead there is a second, narrower door: a much lower fame bar, but only
// for people whose RECORDED ROLE is one that matters commercially, and only
// when the name matches exactly. Seniority, not celebrity.
const WD_ROLE_MIN_SITELINKS = 3;

// P106 "occupation" values that mean influence rather than renown. Kept
// deliberately tight -- every entry here widens the net, and a role like
// "writer" or "athlete" is fame, which the main floor already handles.
const WD_SENIOR_ROLES = new Set([
  "Q43845",    // businessperson
  "Q131524",   // entrepreneur
  "Q806798",   // banker
  "Q484876",   // chief executive officer
  "Q1662323",  // investor
  "Q82955",    // politician
  "Q193391",   // diplomat
  "Q2961975",  // company founder
  "Q189290",   // military officer
  "Q1097498",  // government official
  "Q12362622", // corporate executive
]);

// Royalty and heads of state/government, via P39 "position held". In this
// region that is not an edge case.
const WD_SENIOR_POSITIONS = new Set([
  "Q12097",    // king
  "Q116",      // monarch
  "Q2478141",  // emir
  "Q1097498",  // government official
  "Q83307",    // minister
  "Q48352",    // head of state
  "Q14212",    // head of government
  "Q30461",    // president
  "Q11696",    // president of the United States (kept: cheap, unambiguous)
]);

function claimIds(claims: Record<string, unknown> | undefined, prop: string): string[] {
  const list = (claims && (claims[prop] as { mainsnak?: { datavalue?: { value?: { id?: string } } } }[])) || [];
  return list.map((c) => c?.mainsnak?.datavalue?.value?.id || "").filter(Boolean);
}

// For the seniority route the name must match the entity's label EXACTLY once
// punctuation, accents and casing are normalised.
//
// WHY THIS IS NOT OPTIONAL: Wikidata's search is fuzzy. At the 12-Wikipedia
// level a fuzzy match is self-correcting -- there is only one famous person
// close to "Jennifer Lopez". At the 3-Wikipedia level it is not: a search for
// a common Gulf name would happily return a different person with a similar
// name and a qualifying job title, and the app would flag the wrong guest on
// the strength of it.
// Checked against the label AND every recorded alias, because the label is
// often the fullest legal form. Mohamed Alabbar is filed as "Mohamed Ali
// Alabbar", so a label-only test rejected the chairman of Emaar -- exactly the
// guest this route exists to catch. Aliases keep the discipline (still an
// exact match) while accepting the other names the same person is known by.
// Returns WHICH form matched, not merely whether one did, because that form is
// what the manager should be shown.
//
// Found in testing: "Mohamed Alabbar" matches an entity whose English label
// currently reads "Mohamed Atiya" while the description is unmistakably the
// chairman of Emaar. Printing the label would show a manager a name that is
// not their guest's, and they would dismiss a correct hit. Showing the form
// that actually matched keeps the card honest -- and the source link is right
// there for anyone who wants to check the entry itself.
function matchedForm(name: string, forms: string[]): string | null {
  const norm = (s: string) =>
    String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const n = norm(name);
  if (!n) return null;
  return forms.find((f) => norm(f) === n) || null;
}

// Names that cannot be meaningfully searched. A single word is far too likely
// to collide with a band, a brand or a place ("Madonna" is also a painting
// subject); anything very short is noise.
function searchable(name: string): boolean {
  const n = String(name || "").trim();
  if (n.length < 5) return false;
  if (n.split(/\s+/).filter(Boolean).length < 2) return false;
  return true;
}

type Hit = {
  title: string;
  description: string;
  source: string;
  source_url: string;
  score: number;
} | null;

// A lookup has THREE outcomes, not two, and conflating the last two is the bug
// this type exists to prevent:
//   hit      -- a notable person of that name
//   clear    -- looked, found nobody notable. Safe to remember forever.
//   failed   -- the lookup itself did not happen (rate limit, network, outage).
//
// WHY THIS MATTERS: `clear` is written to the database permanently so the same
// name is never looked up twice. If a failure is recorded as `clear`, a guest
// who happens to book on a night the API is throttling is marked "nobody
// famous" for good and never re-checked -- the feature would silently rot, and
// worst on the busy nights when the most lookups run. So a failure writes
// NOTHING and is simply retried on the next scan.
type Outcome = { kind: "hit"; hit: Hit } | { kind: "clear" } | { kind: "failed" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Source 1: Google Knowledge Graph ────────────────────────────────
// Returns null for "no notable match" and throws ONLY on "not authorised",
// so the caller can tell a genuine miss apart from a key problem.
async function googleKG(name: string, key: string): Promise<Outcome> {
  const url = "https://kgsearch.googleapis.com/v1/entities:search"
    + "?query=" + encodeURIComponent(name)
    + "&types=Person&limit=3&indent=false&key=" + encodeURIComponent(key);
  const r = await fetch(url);
  if (r.status === 403 || r.status === 400) {
    // 403 = API not enabled on the project or the key is restricted away from
    // it. 400 = the key is not valid for this API at all. Either way the
    // caller should fall through to Wikidata, permanently, not retry.
    throw new Error("kg-unauthorised");
  }
  // Any other bad status is the lookup failing, NOT the guest being nobody.
  if (!r.ok) return { kind: "failed" };
  const j = await r.json().catch(() => null);
  if (!j) return { kind: "failed" };
  const items = j.itemListElement || [];
  for (const it of items) {
    const score = Number(it && it.resultScore) || 0;
    const e = (it && it.result) || {};
    const types: string[] = e["@type"] || [];
    if (score < KG_MIN_SCORE) continue;
    if (!types.includes("Person")) continue;
    // detailedDescription is Google's way of saying "this entity has a
    // Wikipedia article". No article, no match -- that is the notability
    // test doing its job.
    const dd = e.detailedDescription;
    if (!dd || !dd.url) continue;
    return {
      kind: "hit",
      hit: {
        title: String(e.name || name),
        description: String(e.description || dd.articleBody || "").slice(0, 200),
        source: "google-kg",
        source_url: String(dd.url),
        score: score,
      },
    };
  }
  return { kind: "clear" };
}

// ── Source 2: Wikidata (no key, no cost) ────────────────────────────
//
// Wikimedia rate-limits anonymous callers hard and answers 429 with a plain
// text body, so every response has to be checked before it is parsed and a 429
// must never be mistaken for "no such person" -- see the Outcome type.
//
// A descriptive User-Agent is not decoration: Wikimedia's policy asks for one
// and throttles generic clients first. `origin=*` was removed deliberately --
// it is a browser CORS parameter and, server-side, only opts into the
// stricter anonymous limits.
const WD_UA = { "User-Agent": "RobertosFOH/1.0 (https://robertos.ae; reservations VIP check)" };

async function wdFetch(url: string): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: WD_UA });
    if (r.status === 429 || r.status === 503) {
      // Backing off and trying again is the whole point: the alternative is
      // recording a celebrity as "clear" because the API was busy.
      await sleep(600 * (attempt + 1));
      continue;
    }
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  }
  return null;
}

async function wikidata(name: string): Promise<Outcome> {
  const s = "https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json"
    + "&language=en&uselang=en&type=item&limit=5&search=" + encodeURIComponent(name);
  const js = await wdFetch(s);
  if (!js) return { kind: "failed" };
  const cands = ((js.search as { id: string }[]) || []).map((x) => x.id).filter(Boolean).slice(0, 5);
  if (!cands.length) return { kind: "clear" };

  // One batched call for all candidates rather than five round trips.
  const g = "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json"
    + "&props=labels|aliases|descriptions|claims|sitelinks&languages=en&ids=" + cands.join("|");
  const jg = await wdFetch(g);
  if (!jg) return { kind: "failed" };
  const ents = (jg.entities as Record<string, never>) || {};

  let best: Hit = null;
  for (const id of cands) {
    const e = ents[id];
    if (!e) continue;
    // P31 "instance of" must include Q5 "human". This is what stops the
    // scan matching a film, an album or a racehorse named after someone.
    const p31 = (e.claims && e.claims.P31) || [];
    const isHuman = p31.some((c: { mainsnak?: { datavalue?: { value?: { id?: string } } } }) =>
      c && c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value
      && c.mainsnak.datavalue.value.id === "Q5");
    if (!isHuman) continue;
    // P570 is "date of death". Nobody dead is sitting at table 21, so a
    // historical figure sharing a guest's name is pure noise -- and on common
    // English names it is the single biggest source of it. Found in testing:
    // "John Smith" matched the Labour leader who died in 1994, which a manager
    // would have had to read and dismiss for no reason.
    if ((e.claims && e.claims.P570 || []).length) continue;

    const links = Object.keys(e.sitelinks || {}).length;
    const label = (e.labels && e.labels.en && e.labels.en.value) || name;

    // TWO DOORS, and a candidate only needs to clear one.
    //
    //   fame       -- 12+ language Wikipedias, any walk of life. Jennifer
    //                 Lopez, Roger Federer.
    //   seniority  -- a recorded role that carries commercial weight, an
    //                 exact name match, and a much lower fame bar. This is
    //                 the door a bank chief executive comes through.
    const byFame = links >= WD_MIN_SITELINKS;
    const roles = claimIds(e.claims, "P106");
    const positions = claimIds(e.claims, "P39");
    const senior = roles.some((r) => WD_SENIOR_ROLES.has(r))
      || positions.some((p) => WD_SENIOR_POSITIONS.has(p));
    const aliases = ((e.aliases && e.aliases.en) as { value: string }[] || []).map((a) => a.value);
    const matched = matchedForm(name, [label as string].concat(aliases));
    const bySeniority = senior && links >= WD_ROLE_MIN_SITELINKS && !!matched;

    if (!byFame && !bySeniority) continue;
    if (best && links <= best.score) continue;
    // The name the manager sees: the form that matched their guest when the
    // seniority route fired, otherwise the entity's own label.
    const shown = bySeniority && matched ? matched : label;
    const desc = (e.descriptions && e.descriptions.en && e.descriptions.en.value) || "";
    const en = e.sitelinks && e.sitelinks.enwiki;
    best = {
      title: String(shown),
      description: String(desc).slice(0, 200),
      source: "wikidata",
      source_url: en && en.title
        ? "https://en.wikipedia.org/wiki/" + encodeURIComponent(String(en.title).replace(/ /g, "_"))
        : "https://www.wikidata.org/wiki/" + id,
      score: links,
    };
  }
  return best ? { kind: "hit", hit: best } : { kind: "clear" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const GKEY = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";

  const body = await req.json().catch(() => ({}));
  const guests: { client: string; name: string }[] = Array.isArray(body.guests) ? body.guests : [];
  if (!guests.length) return json({ ok: true, rows: [], scanned: 0, source: "none" });

  // The switch is read HERE, not just in the browser. A disabled feature must
  // not call an external API just because someone crafted a request -- the
  // admin toggle has to be the real gate, not a hidden button.
  const cfgRes = await fetch(supaUrl + "/rest/v1/app_config?key=eq.vip_scan&select=value", {
    headers: { apikey: svcKey, Authorization: "Bearer " + svcKey },
  });
  const cfg = await cfgRes.json().catch(() => []);
  const enabled = !!(cfg && cfg[0] && cfg[0].value && cfg[0].value.enabled);
  if (!enabled) return json({ ok: true, rows: [], scanned: 0, source: "off", enabled: false });

  const ids = guests.map((g) => g.client).filter(Boolean);
  if (!ids.length) return json({ ok: true, rows: [], scanned: 0, source: "none" });

  // ── What do we already know? ──────────────────────────────────────
  const inList = "(" + ids.map((i) => '"' + String(i).replace(/"/g, "") + '"').join(",") + ")";
  const knownRes = await fetch(
    supaUrl + "/rest/v1/guest_notability?client_id=in." + encodeURIComponent(inList) + "&select=*",
    { headers: { apikey: svcKey, Authorization: "Bearer " + svcKey } },
  );
  const known: Record<string, Record<string, unknown>> = {};
  for (const row of (await knownRes.json().catch(() => [])) as { client_id: string }[]) {
    known[row.client_id] = row as unknown as Record<string, unknown>;
  }

  // ── Look up only the genuinely new ones ───────────────────────────
  // Capped per request. Tonight's book is ~25 bookings and most are already
  // known, so this is a ceiling that should never be reached -- it exists so
  // a bad call can never turn into hundreds of outbound requests.
  const todo = guests.filter((g) => g.client && !known[g.client] && searchable(g.name)).slice(0, 40);

  // Names too short/ambiguous to search are written off as `clear` rather
  // than being retried nightly forever.
  const unsearchable = guests.filter((g) => g.client && !known[g.client] && !searchable(g.name));

  let kgDead = !GKEY;          // no key at all -> Wikidata from the start
  let usedGoogle = false;
  let failures = 0;
  const writes: Record<string, unknown>[] = [];

  for (let i = 0; i < todo.length; i++) {
    const g = todo[i];
    let out: Outcome = { kind: "failed" };

    if (!kgDead) {
      try {
        out = await googleKG(g.name, GKEY);
        usedGoogle = true;
      } catch (_e) {
        // Not authorised for Knowledge Graph. Stop asking for the rest of
        // this run and fall through to Wikidata for this guest too.
        kgDead = true;
        out = { kind: "failed" };
      }
    }
    // Wikidata runs when Google could not answer AND when Google answered
    // "nobody" -- the two sources are complementary, not redundant.
    //
    // MEASURED 28 Jul, which is why this is not the cheaper "only on failure":
    // Google found Noel Quinn (ex-CEO HSBC, score 891), Mohamed Alabbar (3032)
    // and Abdul Aziz Al Ghurair (1736), but returned NOTHING for Bill Winters,
    // the chief executive of Standard Chartered -- whom Wikidata's seniority
    // route finds. Google's score bar is tuned to public renown; Wikidata's
    // occupation claims are tuned to what someone does for a living. A bank
    // chief executive can fall below the first and clear the second.
    //
    // The cost is a second request only for guests Google has nothing on, and
    // those are exactly the ones worth a second look.
    // Google answering "nobody" is a real answer and worth keeping: if the
    // second opinion then fails, fall back to it rather than discarding a good
    // result and asking about this guest again every night.
    const googleSaidClear = !kgDead && out.kind === "clear";
    if (kgDead || out.kind !== "hit") {
      let wd: Outcome;
      try { wd = await wikidata(g.name); } catch (_e) { wd = { kind: "failed" }; }
      out = (wd.kind === "failed" && googleSaidClear) ? { kind: "clear" } : wd;
      // Space the calls out. A 25-booking night is a handful of new names, so
      // this costs a second or two in a background scan nobody is waiting on,
      // and it is what keeps Wikimedia answering at all.
      if (i < todo.length - 1) await sleep(350);
    }

    if (out.kind === "failed") {
      // Deliberately writes NOTHING. Tomorrow's scan tries this guest again.
      failures++;
      continue;
    }
    writes.push(out.kind === "hit" && out.hit
      ? {
        client_id: g.client, guest_name: g.name, status: "match",
        title: out.hit.title, description: out.hit.description,
        source: out.hit.source, source_url: out.hit.source_url, score: out.hit.score,
        scanned_at: new Date().toISOString(),
      }
      : {
        client_id: g.client, guest_name: g.name, status: "clear",
        scanned_at: new Date().toISOString(),
      });
    // If the source is refusing us outright there is no sense grinding through
    // another 30 names to collect 30 more failures.
    if (failures >= 5) break;
  }
  for (const g of unsearchable) {
    writes.push({
      client_id: g.client, guest_name: g.name, status: "clear",
      scanned_at: new Date().toISOString(),
    });
  }

  let wrote = 0, writeError: string | null = null;
  if (writes.length) {
    // merge-duplicates: a manager's confirm/dismiss can land between the read
    // above and this write. resolution=merge-duplicates would overwrite their
    // decision, so only rows we did NOT already know about are written -- and
    // `known` was built from that same read.
    // The result is CHECKED, not fired and forgotten. An unchecked write here
    // fails invisibly: the response still carries the matches (they are built
    // in memory), the screen still shows the chips, and nothing is stored --
    // so the same names get looked up again the next night and a manager's
    // "not them" has nothing to attach to. It cost real time to diagnose
    // exactly that, because the failure left no trace anywhere.
    const wres = await fetch(supaUrl + "/rest/v1/guest_notability", {
      method: "POST",
      headers: {
        apikey: svcKey, Authorization: "Bearer " + svcKey,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify(writes),
    });
    if (wres.ok) {
      wrote = writes.length;
    } else {
      writeError = "HTTP " + wres.status + " " + (await wres.text().catch(() => "")).slice(0, 200);
      console.error("[vip-scan] could not store results:", writeError);
    }
  }

  // Return everything the screen needs: the pre-existing rows plus the new
  // ones, minus the `clear` ones, which have nothing to show.
  const out = Object.values(known).concat(writes)
    .filter((r) => r && (r as { status: string }).status !== "clear");

  return json({
    ok: true,
    rows: out,
    scanned: writes.length,
    stored: wrote,
    store_error: writeError,
    // Surfaced rather than swallowed: "looked up nobody and failed 5 times" is
    // a very different night from "looked up 5 and found nothing", and only
    // one of them means something is wrong.
    failed: failures,
    enabled: true,
    // Which source actually answered. The admin screen shows this so a
    // Google key that is not authorised for Knowledge Graph is visible
    // rather than being a silent downgrade.
    source: kgDead ? (GKEY ? "wikidata (google key not authorised for knowledge graph)" : "wikidata")
      : (usedGoogle ? "google-kg" : "wikidata"),
  });
});
