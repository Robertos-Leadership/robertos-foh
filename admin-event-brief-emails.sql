-- ═══════════════════════════════════════════════════════════════════
-- Event brief -> Admin → Emails
-- Puts the event-brief recipient list where every other automatic email
-- already lives (app_users.notify), so Valentina/Andrea can add or drop
-- someone without a code change or a deploy.
-- Run once, on the FOH project (paoaivwtkzujmrgrfjuq). Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

-- 1. The read path.
--    RLS on app_users only lets a person read their OWN row unless they are an
--    admin, and Francesco is the only admin. So the Events module cannot just
--    select the list — it would show the sender one name and send the brief to
--    the wrong team. This function reads it with definer rights and returns
--    nothing but the name and email of the people on one named list.
create or replace function public.fn_notify_list(p_key text)
returns table(email text, name text)
language sql
security definer
set search_path = public
as $$
  select u.email, u.name
  from public.app_users u
  where p_key in ('closing_report','event_brief','roster_foh','roster_kitchen')
    and u.notify @> array[p_key]
  order by u.name nulls last, u.email
$$;

-- ⚠ `revoke from public` is NOT enough. This project grants EXECUTE on new public
--   functions to anon/authenticated/service_role by default, and those are named
--   grants that `from public` does not touch — leaving the list readable by anyone
--   with the anon key, signed in or not. anon must be revoked BY NAME.
revoke all     on function public.fn_notify_list(text) from public;
revoke execute on function public.fn_notify_list(text) from anon;
grant  execute on function public.fn_notify_list(text) to authenticated;

-- 2. The one recipient who has no row yet.
--    Receive-only: no modules, not an admin — it grants no access at all,
--    it only holds the tick that says "send this person the brief".
insert into public.app_users (email, name, modules, is_admin, notify)
values ('amahmoud@skelmore.com', 'A. Mahmoud (Design)', '{}', false, '{}')
on conflict (email) do nothing;

-- 3. Seed the list with exactly who receives the brief today, so the screen
--    tells the truth from the first minute instead of reading as empty.
update public.app_users
   set notify = coalesce(notify,'{}') || array['event_brief'],
       updated_at = now()
 where not (coalesce(notify,'{}') @> array['event_brief'])
   and email in (
   'fguarracino@robertos.ae','vdetoni@robertos.ae','dvalla@robertos.ae',
   'jthomas@robertos.ae','mpetrosino@robertos.ae','astellacci@robertos.ae',
   'afalcone@robertos.ae','rmazouz@robertos.ae','reservations@robertos.ae',
   'aviscardi@robertos.ae','kvukotic@robertos.ae','ahtwe@robertos.ae',
   'asacchi@skelmore.com','amahmoud@skelmore.com'
 );

-- 4. Check: this must return 14 rows, and they must match the list above.
select email, name from public.app_users where notify @> array['event_brief'] order by name;
