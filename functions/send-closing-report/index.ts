// ════════════════════════════════════════════════════════════
// send-closing-report — Supabase Edge Function (Leadership Hub project)
// Emails the Daily Closing Report via Resend. Key + recipient list stay
// server-side. The client posts { subject, html } only.
//
// Deploy:  supabase functions deploy send-closing-report --project-ref paoaivwtkzujmrgrfjuq
// Secret:  supabase secrets set RESEND_API_KEY=re_... --project-ref paoaivwtkzujmrgrfjuq
//
// FROM must be on a domain VERIFIED in your Resend account (robertos.ae).
// ════════════════════════════════════════════════════════════
const FROM = "Roberto's DIFC Operations <reports@kitchenteam.robertos.ae>";   // verified Resend domain
const TO = [
  "fguarracino@robertos.ae",
  "asacchi@skelmore.com",
  "justin@skelmore.com",
  "musti@robertos.ae",
  "umavila@skelmore.com",
];
const CC = [
  "kvukotic@robertos.ae",
  "mpetrosino@robertos.ae",
  "vdetoni@robertos.ae",
  "dvalla@robertos.ae",
  "jthomas@robertos.ae",
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return json({ error: "RESEND_API_KEY secret not set" }, 500);

    const body = await req.json();
    const subject = body.subject || "Roberto's DIFC — Daily Closing Report";
    const html = body.html;
    if (!html) return json({ error: "No html provided" }, 400);

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: TO, cc: CC, subject, html }),
    });
    const data = await r.json();
    if (!r.ok) return json({ error: data?.message || ("Resend HTTP " + r.status) }, 502);
    return json({ ok: true, id: data?.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
