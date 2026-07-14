-- ════════════════════════════════════════════════════════════
-- Email Valentina the moment a guest submits their set-menu numbers.
-- A database trigger on event_menu_choices posts to Resend (same verified
-- sender as the closing report) — no edge function deploy needed, and a
-- failure to email NEVER blocks the guest's submission.
--
-- ⚠ TWO THINGS TO FILL IN BEFORE RUNNING (then run once):
--   1. YOUR_RESEND_API_KEY  — Supabase dashboard → Edge Functions → Secrets
--                             → copy the value of RESEND_API_KEY (starts re_)
--   2. The recipient list   — in fn_notify_menu_choice below, replace
--                             valentina@robertos.ae / add more addresses.
-- Run in the FOH Supabase project (paoaivwtkzujmrgrfjuq).
-- ════════════════════════════════════════════════════════════
create extension if not exists pg_net;

-- Store the Resend key once in Vault (encrypted at rest, never client-readable).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'resend_api_key') then
    perform vault.create_secret('YOUR_RESEND_API_KEY', 'resend_api_key');
  end if;
end $$;

create or replace function public.fn_notify_menu_choice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k        text;
  ev       record;
  course   text;
  opts     jsonb;
  optline  text;
  lines    text := '';
  who      text;
  subj     text;
  esc_note text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if k is null or k = 'YOUR_RESEND_API_KEY' then return new; end if;

  select client_name, company, event_date, guests
    into ev from events_desk where client_token = new.token limit 1;
  who := coalesce(nullif(ev.client_name,''), nullif(ev.company,''), 'A guest');

  for course, opts in select key, value from jsonb_each(new.choices) loop
    select string_agg(value || ' × ' || key, ', ') into optline from jsonb_each_text(opts);
    lines := lines || '<b>' || replace(replace(course,'<','&lt;'),'>','&gt;') || '</b>: '
                   || coalesce(replace(replace(optline,'<','&lt;'),'>','&gt;'),'') || '<br>';
  end loop;
  esc_note := replace(replace(coalesce(new.note,''),'<','&lt;'),'>','&gt;');

  subj := who || ' sent their menu choices'
       || case when ev.event_date is not null then ' — ' || to_char(ev.event_date,'DD Mon') else '' end;

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization','Bearer ' || k, 'Content-Type','application/json'),
    body    := jsonb_build_object(
      'from', 'Roberto''s Events <reports@kitchenteam.robertos.ae>',
      'to',   jsonb_build_array('valentina@robertos.ae','francescoguarracino@hotmail.com'),
      'subject', subj,
      'html',
        '<div style="font-family:Georgia,serif;color:#2C1810">'
        || '<p><b>' || who || '</b> just sent their set-menu numbers'
        || case when ev.guests is not null then ' (' || ev.guests || ' guests on the event)' else '' end || ':</p>'
        || '<p>' || lines || '</p>'
        || case when esc_note <> '' then '<p><b>Their note:</b> ' || esc_note || '</p>' else '' end
        || '<p>Open the event in the FOH app → the green banner → <b>Review &amp; apply</b>, and the kitchen brief is ready.<br>'
        || '<a href="https://robertos-leadership.github.io/robertos-foh/">Open the FOH app</a></p></div>'
    )
  );
  return new;
exception when others then
  return new;  -- the guest's submission must never fail because an email did
end $$;

drop trigger if exists trg_menu_choice_email on event_menu_choices;
create trigger trg_menu_choice_email
  after insert on event_menu_choices
  for each row execute function public.fn_notify_menu_choice();
