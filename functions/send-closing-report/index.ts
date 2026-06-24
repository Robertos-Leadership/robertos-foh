// ════════════════════════════════════════════════════════════
// send-closing-report — Supabase Edge Function (Leadership Hub project)
// Emails the Daily Closing Report via Resend. Recipients now come from the
// app_users table (anyone with 'closing_report' in their notify list), managed
// from the app's Admin screen. Falls back to the fixed list if none are set,
// so the email never goes to nobody.
//
// Deploy:  supabase functions deploy send-closing-report --project-ref paoaivwtkzujmrgrfjuq
// Secret:  RESEND_API_KEY (already set). SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-provided.
// ════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FROM = "Roberto's DIFC Operations <reports@kitchenteam.robertos.ae>";   // verified Resend domain
// Fallback recipients (used only if nobody is ticked for closing_report in app_users)
const FALLBACK_TO = [
  "fguarracino@robertos.ae", "asacchi@skelmore.com", "justin@skelmore.com",
  "musti@robertos.ae", "umavila@skelmore.com",
  "kvukotic@robertos.ae", "mpetrosino@robertos.ae", "vdetoni@robertos.ae",
  "dvalla@robertos.ae", "jthomas@robertos.ae",
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

    // Recipients = everyone ticked for the closing-report email in app_users.
    let to: string[] = FALLBACK_TO;
    try {
      const supa = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data } = await supa.from("app_users").select("email").contains("notify", ["closing_report"]);
      const emails = (data || []).map((r: { email: string }) => r.email).filter(Boolean);
      if (emails.length) to = emails;
    } catch (_) { /* keep fallback */ }

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    const data = await r.json();
    if (!r.ok) return json({ error: data?.message || ("Resend HTTP " + r.status) }, 502);
    return json({ ok: true, id: data?.id, recipients: to.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
