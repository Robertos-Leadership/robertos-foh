// ════════════════════════════════════════════════════════════════════════
// send-roster — Supabase Edge Function
//
// ⚠️ THIS FUNCTION LIVES IN THE **KITCHEN** PROJECT, NOT THE FOH ONE.
//    Deploy: supabase functions deploy send-roster --project-ref zrpglswalgjbtghudmhu
//    Both apps call it: the FOH app passes source:'FOH', the Kitchen app passes
//    nothing. One function, two brandings — that is deliberate, so the roster
//    email looks and reads the same whichever schedule it came from.
//
// This copy exists so the source is in the repo. Before this, it lived ONLY in
// the Supabase dashboard, which is why nobody could see who the roster was
// actually going to without opening an email. Edit here, then deploy.
//
// WHO IT SENDS TO
// ---------------
// hr@robertos.ae is always the addressee. The email opens "Dear HR Team" and
// that mailbox is the reason the email exists, so it is fixed here and cannot
// be removed by accident from a settings screen.
//
// Everyone ELSE is copied in, and that list is NOT in this file — it is read at
// send time from app_users.notify in the FOH project, managed from the app's
// Admin → Emails screen. Add or drop someone there and the very next send
// obeys it; no redeploy. Keys: 'roster_foh' / 'roster_kitchen'.
//
// WHAT CHANGED IN THIS ROSTER
// ---------------------------
// `note` — free text the manager types on the Send-to-HR screen. It is printed
// under the greeting so HR reads the change instead of comparing two sheets
// person by person. Optional; when it is empty the email is exactly as before.
// Escaped, never trusted as HTML. `sentBy` signs it.
//
// If that lookup fails or returns nobody, we fall back to the exact list that
// was hardcoded here before this change. A roster that quietly reaches nobody
// is far worse than one that reaches a slightly stale list.
//
// SECRETS
//   RESEND_API_KEY   — the Resend key. REQUIRED. The old version of this
//                      function carried the key inline in the source; that key
//                      is considered exposed and must be rotated. Nothing is
//                      sent if this secret is missing, and the caller is told
//                      why, rather than failing silently.
//   FOH_SERVICE_KEY  — service_role key of the FOH project (paoaivwtkzujmrgrfjuq).
//                      Without it the recipient lookup is skipped and the
//                      fallback list is used — the email still goes out.
// ════════════════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// The FOH project holds app_users. Its URL is public (it is in the FOH app's
// own source); only the service key is a secret.
const FOH_URL = "https://paoaivwtkzujmrgrfjuq.supabase.co";

const RESEND_KEY = Deno.env.get("RESEND_API_KEY");

// The addressee. Never read from the database, never removable from a screen.
const HR_TO = ["hr@robertos.ae"];

// Exactly who was copied before recipients moved into app_users. Used only when
// the lookup gives us nothing.
const FALLBACK_CC: Record<string, string[]> = {
  roster_foh:     ["lmadlag@robertos.ae", "dsaxena@robertos.ae", "fguarracino@robertos.ae",
                   "mpetrosino@robertos.ae", "jthomas@robertos.ae"],
  roster_kitchen: ["lmadlag@robertos.ae", "dsaxena@robertos.ae", "fguarracino@robertos.ae",
                   "dvalla@robertos.ae", "astellacci@robertos.ae"],
};

// Anything a person typed goes through this before it reaches HR's inbox.
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Reads everyone ticked for this roster on the Admin → Emails screen.
// Deliberately total: any failure returns null so the caller uses the fallback,
// because "we could not read the list" must never become "we sent it to nobody".
async function ccFromAppUsers(notifyKey: string): Promise<string[] | null> {
  const svc = Deno.env.get("FOH_SERVICE_KEY");
  if (!svc) return null;
  try {
    const url = FOH_URL + "/rest/v1/app_users"
      + "?select=email&notify=cs." + encodeURIComponent("{" + notifyKey + "}");
    const r = await fetch(url, { headers: { apikey: svc, Authorization: "Bearer " + svc } });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows)) return null;
    const emails = rows
      .map((x: { email?: unknown }) => typeof x.email === "string" ? x.email.trim().toLowerCase() : "")
      .filter((e: string) => e.includes("@"));
    return emails.length ? emails : null;
  } catch (_) {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // Said plainly, and BEFORE building anything: a missing key must read as
    // "not sent, here is why", never as a silent success on the schedule screen.
    if (!RESEND_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY secret is not set on this project — nothing was sent." }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const body = await req.json();
    const { xlsxBase64, fileName, weekStr, source, update, sentBy } = body;

    // The line the manager typed on the Send-to-HR screen: what changed in this
    // roster, in their own words.
    //
    // Antonio asked for this on 10 Aug 2026. He had already sent the week to HR
    // when Gaejindra asked to swap his day off with Joker, so the roster changed
    // by two cells — and the email had no way to say so. The only options were to
    // send an identical-looking attachment and leave HR to compare every person
    // line by line, or to tell Leverina on WhatsApp instead, which is what he did.
    //
    // Typed text, never markup: escaped here, so a stray < or & from a phone
    // keyboard cannot break the email or inject anything into HR's inbox.
    const note   = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
    const noteBy = typeof sentBy === "string" ? sentBy.trim().slice(0, 80) : "";

    // Brand + recipients depend on which app sent it (FOH app passes source:'FOH')
    const isFOH = source === "FOH";
    const fromName  = isFOH ? "Roberto's FOH" : "Roberto's Kitchen";
    const subjLabel = isFOH ? "FOH Roster" : "Kitchen Roster";
    const bodyLabel = isFOH ? "Front of House" : "kitchen";
    const signOff   = isFOH ? "Front of House Management" : "Kitchen Management";
    const notifyKey = isFOH ? "roster_foh" : "roster_kitchen";

    // update:true means this week was already sent — tell HR to discard the old one.
    const isUpdate = update === true;

    // A test send goes to ONE address and nobody else — not HR, not the Cc list.
    // Without this the only way to check the roster email was to send a real one
    // to HR, which is not a test, it is a mistake with a nice name. Anything
    // that is not a single sane address is ignored rather than half-honoured.
    const testTo = typeof body.testTo === "string" && body.testTo.includes("@")
      ? body.testTo.trim().toLowerCase() : null;

    const to = testTo ? [testTo] : HR_TO;
    const managed = testTo ? [] : await ccFromAppUsers(notifyKey);
    const usedFallback = !testTo && managed === null;
    // Never copy the addressee back to itself — it reads as a mistake to HR.
    const cc = testTo ? [] : (managed || FALLBACK_CC[notifyKey] || [])
      .filter((e) => !to.includes(e));
    const replyTo = isFOH ? "mpetrosino@robertos.ae" : "dvalla@robertos.ae";

    // A test must be unmistakable in the inbox. If it ever did reach HR by
    // accident, the subject line alone tells them to ignore it.
    const subject = (testTo ? "TEST — " : "") + (isUpdate ? "UPDATED — " : "") + subjLabel + ": " + weekStr;

    const banner = isUpdate
      ? "<p style=\"background:#fbeaea;border-left:4px solid #b91c1c;padding:10px 14px;color:#7f1d1d;font-weight:bold;border-radius:4px\">⚠️ UPDATED ROSTER — this replaces the version sent earlier for this week. Please discard the previous roster and use this latest one.</p>"
      : "";

    const intro = isUpdate
      ? "<p>Dear HR Team,</p><p>Please find attached the <strong>updated</strong> " + bodyLabel + " roster for the week of <strong>" + weekStr + "</strong>. It <strong>replaces</strong> any earlier version sent for this week.</p>"
      : "<p>Dear HR Team,</p><p>Please find attached the <strong>" + bodyLabel + "</strong> roster for the week of <strong>" + weekStr + "</strong>.</p>";

    // Sits directly under the greeting — above the attachment sentence — because
    // it is the reason HR would otherwise have to re-read the whole sheet.
    const noteHtml = note
      ? '<div style="background:#F5F0E8;border-left:4px solid #6B1F2A;padding:12px 15px;border-radius:4px;margin:16px 0">'
        + '<div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6B1F2A;font-weight:bold;margin-bottom:7px">What changed in this roster</div>'
        + '<div style="color:#3D0F15;line-height:1.5">' + esc(note).replace(/\n/g, "<br>") + "</div>"
        + (noteBy ? '<div style="font-size:12px;color:#7a6b55;margin-top:9px;font-style:italic">&mdash; ' + esc(noteBy) + "</div>" : "")
        + "</div>"
      : "";

    const emailPayload = {
      from: fromName + " <roster@kitchenteam.robertos.ae>",
      to: to,
      cc: cc,
      reply_to: replyTo,
      subject: subject,
      html: banner + intro + noteHtml + "<p>The Excel file contains shift times, total hours and days worked per person.</p><p>Best regards,<br>" + signOff + "<br>Roberto's DIFC</p>",
      attachments: [{ filename: fileName, content: xlsxBase64 }],
    };

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + RESEND_KEY,
      },
      body: JSON.stringify(emailPayload),
    });

    const data = await res.json();

    // The caller shows a green tick on 2xx, so tell it who was actually copied.
    // usedFallback:true is the one thing worth noticing — it means the Admin
    // list could not be read and the built-in list was used instead.
    // `noted` is how the sending screen can say "your note went with it" without
    // guessing — if the note were ever dropped on the way here, the tick would say so.
    return new Response(JSON.stringify({ ...data, cc: cc.length, usedFallback, noted: note.length }), {
      status: res.status,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
