// ════════════════════════════════════════════════════════════
// event-dish-describe — Supabase Edge Function (Leadership Hub project)
// Drafts an elegant one-line menu descriptor for a dish the chef is adding.
// The chef approves/edits the line in the app BEFORE saving — this function
// never writes anything to the database or to client documents.
// Secret: ANTHROPIC_API_KEY.
// ════════════════════════════════════════════════════════════
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY secret not set" }, 500);
    const body = await req.json();
    const name = String(body.name || "").slice(0, 120);
    if (!name) return json({ error: "No dish name" }, 400);
    const category = String(body.category || "").slice(0, 40);
    const serve = String(body.serve || "").slice(0, 40);
    const notes = String(body.notes || "").slice(0, 300);

    const prompt =
      `You write menu lines for Roberto's, a luxury Italian restaurant in DIFC, Dubai. ` +
      `A chef is adding a canapé/event dish to the library.\n` +
      `Dish name: ${name}\nCategory: ${category}\nServed: ${serve}` +
      (notes ? `\nChef's notes on what's in it: ${notes}` : "") +
      `\n\nWrite ONLY the short descriptor line that appears under the dish name on an elegant menu: ` +
      `2 to 6 words, key ingredients or preparation, comma-separated, sentence case, English, ` +
      `no dish name repetition, no allergen codes, no full stop, no quotes. ` +
      `Style examples from the current menu: "Lemon gel, cress" / "Mozzarella, cherry tomato, basil" / "BBQ glaze, mashed potato".`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 60,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!r.ok) return json({ error: "AI request failed", detail: (await r.text()).slice(0, 300) }, 502);
    const data = await r.json();
    let text = (data.content?.[0]?.text || "").trim().replace(/^["']|["'.]$/g, "").trim();
    if (!text) return json({ error: "Empty AI response" }, 502);
    if (text.length > 90) text = text.slice(0, 90);
    return json({ description: text });
  } catch (e) {
    return json({ error: String(e).slice(0, 300) }, 500);
  }
});
