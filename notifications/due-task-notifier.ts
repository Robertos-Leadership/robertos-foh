// Roberto's Leadership Hub - Due Task Notifier
// Runs daily at 13:00 Dubai (09:00 UTC) via pg_cron.
// Sends ONE digest email per person listing their Important / Non-negotiable
// tasks whose due date has arrived. Each task is notified exactly once
// (due_notified_at stamp). Editing a task's due date clears the stamp.

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_KEY) {
    return json({ error: "RESEND_API_KEY secret not set" }, 500);
  }

  // Today's date in Dubai (UTC+4)
  const dubaiToday = new Date(Date.now() + 4 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  // Team email directory
  const { data: members, error: mErr } = await supabase
    .from("team_members")
    .select("name,email");
  if (mErr) return json({ error: mErr.message }, 500);

  // Priority tasks due (today or overdue), open, never notified
  const { data: rawTasks, error: tErr } = await supabase
    .from("tasks")
    .select("id,title,description,due_date,assigned_to,champion,event_id,status")
    .neq("status", "done")
    .not("due_date", "is", null)
    .lte("due_date", dubaiToday)
    .is("due_notified_at", null);
  if (tErr) return json({ error: tErr.message }, 500);

  // Priority is stored as JSON inside description: {"__rlh":true,"priority":"...","stage":"..."}
  const getPriority = (t: any): string | null => {
    try { return JSON.parse(t.description || "{}").priority ?? null; }
    catch { return null; }
  };
  const tasks = (rawTasks ?? [])
    .map((t: any) => ({ ...t, priority: getPriority(t) }))
    .filter((t: any) => t.priority === "non_negotiable" || t.priority === "important");

  const { data: events } = await supabase.from("events").select("id,name");
  const evName = Object.fromEntries((events ?? []).map((e) => [e.id, e.name]));

  // Group tasks by person (assigned_to first, champion as fallback)
  const byEmail: Record<string, { name: string; tasks: any[] }> = {};
  for (const t of tasks ?? []) {
    const owner = (t.assigned_to || t.champion || "").trim();
    if (!owner) continue;
    const member = (members ?? []).find(
      (m) => m.name.toLowerCase() === owner.toLowerCase(),
    );
    if (!member?.email) continue;
    (byEmail[member.email] ??= { name: member.name, tasks: [] }).tasks.push(t);
  }

  const notifiedIds: string[] = [];
  let sent = 0;

  for (const [email, info] of Object.entries(byEmail)) {
    const rows = info.tasks
      .sort((a, b) => (a.priority < b.priority ? 1 : -1))
      .map((t) => {
        const pr = t.priority === "non_negotiable"
          ? '<span style="color:#c0392b;font-weight:600">Non-negotiable</span>'
          : '<span style="color:#9a7b22;font-weight:600">Important</span>';
        const overdue = t.due_date < dubaiToday
          ? ' <span style="color:#c0392b">(overdue)</span>'
          : "";
        return `<tr>
          <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:14px;color:#2c1810">${t.title}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:13px;color:#6b5d52">${evName[t.event_id] ?? ""}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:13px">${pr}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:13px;color:#6b5d52">${t.due_date}${overdue}</td>
        </tr>`;
      })
      .join("");

    const n = info.tasks.length;
    const html = `
    <div style="background:#F5F0E8;padding:32px 16px;font-family:Georgia,serif">
      <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5ddd0">
        <div style="background:#6B1F2A;padding:22px 28px">
          <div style="color:#C9A84C;font-size:11px;letter-spacing:0.25em;text-transform:uppercase">Roberto's Leadership Hub</div>
          <div style="color:#fff;font-size:22px;margin-top:6px">Ciao ${info.name} — ${n} priority task${n > 1 ? "s" : ""} due</div>
        </div>
        <div style="padding:24px 28px">
          <p style="font-size:14px;color:#2c1810;margin:0 0 16px">These need your attention today:</p>
          <table style="width:100%;border-collapse:collapse">
            <tr>
              <th style="text-align:left;padding:8px 14px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#9a8b7d;border-bottom:2px solid #C9A84C">Task</th>
              <th style="text-align:left;padding:8px 14px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#9a8b7d;border-bottom:2px solid #C9A84C">Event</th>
              <th style="text-align:left;padding:8px 14px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#9a8b7d;border-bottom:2px solid #C9A84C">Priority</th>
              <th style="text-align:left;padding:8px 14px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#9a8b7d;border-bottom:2px solid #C9A84C">Due</th>
            </tr>
            ${rows}
          </table>
          <div style="text-align:center;margin-top:26px">
            <a href="https://robertos-leadership.github.io/robertos-leadership-hub"
               style="background:#6B1F2A;color:#fff;text-decoration:none;padding:12px 28px;font-size:13px;letter-spacing:0.15em;text-transform:uppercase">Open the Hub</a>
          </div>
        </div>
        <div style="padding:14px 28px;border-top:1px solid #eee;font-size:11px;color:#9a8b7d">
          You receive this once per task, at 1pm on its due date. Mark tasks done in the Hub to keep your list clean.
        </div>
      </div>
    </div>`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Roberto's Leadership Hub <hub@robertos.ae>",
        to: [email],
        subject: `${n} priority task${n > 1 ? "s" : ""} due today — Roberto's Hub`,
        html,
      }),
    });

    if (r.ok) {
      sent++;
      notifiedIds.push(...info.tasks.map((t) => t.id));
    } else {
      console.error("Resend error for", email, await r.text());
    }
  }

  // Stamp notified tasks so they are never emailed twice
  if (notifiedIds.length) {
    await supabase
      .from("tasks")
      .update({ due_notified_at: new Date().toISOString() })
      .in("id", notifiedIds);
  }

  return json({ emailsSent: sent, tasksNotified: notifiedIds.length });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
