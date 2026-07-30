// ════════════════════════════════════════════════════════════
// vip-probe  ·  TEMPORARY. Delete after the test.
//
// ROUND 2. Round 1 killed the naive version of this idea: "name appears in
// result titles" scored 7-10 for almost every guest, because LinkedIn,
// Instagram and Facebook profile pages all carry the person's name in the
// title. It measured "this name belongs to humans with social accounts",
// which is everyone. A Dubai chef with real press (373 results, 7 titles) was
// indistinguishable from three ordinary guests (339/7, 276/8, 212/7).
//
// The one thing round 1 hinted at: the chef's results included arabnews.com --
// an actual publication -- while ordinary guests returned only LinkedIn,
// Instagram, Facebook, scholar and university pages.
//
// So this round returns the RAW top ten per name: the domain, and whether the
// title carries the full name. No classification happens here on purpose --
// the editorial-vs-social split is decided from the real distribution
// afterwards, rather than from a guessed list of "news sites" that would
// quietly define the answer it was meant to test.
//
// Writes NOTHING, reads NO table. Returns domains and booleans, never result
// text.
//
// Deploy with verify_jwt = true. Secret: SERPAPI_KEY (already set for reviews).
// NOTE: keep every literal ASCII - non-ASCII gets double-encoded on upload.
// ════════════════════════════════════════════════════════════
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function norm(s: string): string {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SERP = Deno.env.get("SERPAPI_KEY");
  if (!SERP) return json({ error: "SERPAPI_KEY is not set on this project" }, 503);

  const body = await req.json().catch(() => ({}));
  const names: string[] = Array.isArray(body.names) ? body.names.slice(0, 60) : [];
  if (!names.length) return json({ error: "send { names: [...] }" }, 400);

  const out: Record<string, unknown>[] = [];

  for (let i = 0; i < names.length; i++) {
    const name = String(names[i] || "").trim();
    if (!name) continue;
    const url = "https://serpapi.com/search.json?engine=google&num=10&hl=en"
      + "&q=" + encodeURIComponent('"' + name + '"')
      + "&api_key=" + encodeURIComponent(SERP);
    try {
      const r = await fetch(url);
      if (!r.ok) { out.push({ name, error: "HTTP " + r.status }); continue; }
      const j = await r.json();
      const organic = (j.organic_results || []) as { title?: string; link?: string; date?: string }[];
      const n = norm(name);
      const hits: { d: string; t: boolean; dated: boolean }[] = [];
      for (const o of organic) {
        let d = "";
        try { d = new URL(o.link || "").hostname.replace(/^www\./, ""); } catch (_e) { continue; }
        hits.push({
          d,
          t: norm(o.title || "").includes(n),
          // A publication date is a decent tell for an ARTICLE as opposed to a
          // profile page, which normally has none.
          dated: !!o.date,
        });
      }
      out.push({
        name,
        total_results: (j.search_information && j.search_information.total_results) ?? null,
        hits,
      });
    } catch (e) {
      out.push({ name, error: String(e && (e as Error).message || e).slice(0, 120) });
    }
    if (i < names.length - 1) await sleep(250);
  }

  return json({ ok: true, count: out.length, results: out });
});
