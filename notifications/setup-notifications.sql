-- Roberto's Leadership Hub - Due-task emails, all-in-database version
-- Replace PASTE_RESEND_KEY_HERE with your Resend API key, then run once.

create or replace function send_due_task_emails() returns jsonb
language plpgsql security definer as $fn$
declare
  m record; t record;
  rows_html text; n int; task_ids uuid[];
  emails_sent int := 0; tasks_count int := 0;
  today date := (now() at time zone 'Asia/Dubai')::date;
  resend_key text := 'PASTE_RESEND_KEY_HERE';
  html text;
begin
  for m in select name, email from team_members loop
    rows_html := ''; n := 0; task_ids := '{}';
    for t in
      select tk.id, tk.title, tk.due_date, e.name as event_name,
             (tk.description::jsonb->>'priority') as priority
      from tasks tk
      left join events e on e.id = tk.event_id
      where tk.status <> 'done'
        and tk.due_date is not null
        and tk.due_date::date <= today
        and tk.due_notified_at is null
        and tk.description like '{"__rlh"%'
        and (tk.description::jsonb->>'priority') in ('non_negotiable','important')
        and lower(coalesce(nullif(trim(tk.assigned_to),''), nullif(trim(tk.champion),''), '')) = lower(m.name)
      order by tk.due_date
    loop
      n := n + 1;
      task_ids := task_ids || t.id;
      rows_html := rows_html || format(
        '<tr><td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:14px;color:#2c1810">%s</td><td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:13px;color:#6b5d52">%s</td><td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:13px">%s</td><td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:13px;color:#6b5d52">%s%s</td></tr>',
        t.title, coalesce(t.event_name,''),
        case when t.priority='non_negotiable'
          then '<span style="color:#c0392b;font-weight:600">Non-negotiable</span>'
          else '<span style="color:#9a7b22;font-weight:600">Important</span>' end,
        t.due_date,
        case when t.due_date::date < today then ' <span style="color:#c0392b">(overdue)</span>' else '' end
      );
    end loop;

    if n > 0 then
      html :=
        '<div style="background:#F5F0E8;padding:32px 16px;font-family:Georgia,serif">'
        || '<div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5ddd0">'
        || '<div style="background:#6B1F2A;padding:22px 28px">'
        || '<div style="color:#C9A84C;font-size:11px;letter-spacing:0.25em;text-transform:uppercase">Roberto''s Leadership Hub</div>'
        || format('<div style="color:#fff;font-size:22px;margin-top:6px">Ciao %s &mdash; %s priority task%s due</div>', m.name, n, case when n>1 then 's' else '' end)
        || '</div><div style="padding:24px 28px">'
        || '<table style="width:100%;border-collapse:collapse">'
        || '<tr><th style="text-align:left;padding:8px 14px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#9a8b7d;border-bottom:2px solid #C9A84C">Task</th><th style="text-align:left;padding:8px 14px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#9a8b7d;border-bottom:2px solid #C9A84C">Event</th><th style="text-align:left;padding:8px 14px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#9a8b7d;border-bottom:2px solid #C9A84C">Priority</th><th style="text-align:left;padding:8px 14px;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#9a8b7d;border-bottom:2px solid #C9A84C">Due</th></tr>'
        || rows_html || '</table>'
        || '<div style="text-align:center;margin-top:26px"><a href="https://robertos-leadership.github.io/robertos-leadership-hub" style="background:#6B1F2A;color:#fff;text-decoration:none;padding:12px 28px;font-size:13px;letter-spacing:0.15em;text-transform:uppercase">Open the Hub</a></div>'
        || '</div><div style="padding:14px 28px;border-top:1px solid #eee;font-size:11px;color:#9a8b7d">You receive this once per task, at 1pm on its due date. Mark tasks done in the Hub to keep your list clean.</div>'
        || '</div></div>';

      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization','Bearer '||resend_key,'Content-Type','application/json'),
        body := jsonb_build_object(
          'from','Roberto''s Leadership Hub <hub@robertos.ae>',
          'to', jsonb_build_array(m.email),
          'subject', format('%s priority task%s due today - Roberto''s Hub', n, case when n>1 then 's' else '' end),
          'html', html
        )
      );
      update tasks set due_notified_at = now() where id = any(task_ids);
      emails_sent := emails_sent + 1;
      tasks_count := tasks_count + n;
    end if;
  end loop;
  return jsonb_build_object('emails_sent', emails_sent, 'tasks_notified', tasks_count);
end $fn$;

-- Allow triggering a run via the app/API (idempotent thanks to the stamp)
grant execute on function send_due_task_emails() to anon;

-- Point the daily 13:00 Dubai schedule at this function (replaces the old job)
select cron.unschedule('due-task-emails');
select cron.schedule('due-task-emails', '0 9 * * *', $$ select send_due_task_emails() $$);
