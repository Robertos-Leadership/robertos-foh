-- ════════════════════════════════════════════════════════════════════════
--  ROSTER EMAIL RECIPIENTS → moved out of code and into Admin → Emails
--  Project: FOH Supabase (paoaivwtkzujmrgrfjuq). Run once in the SQL Editor.
--
--  Seeds the people who are ALREADY receiving the roster emails today, read
--  off the real send of 1 Aug 2026, plus Ouafaa on the FOH roster.
--
--  hr@robertos.ae is deliberately NOT here. It is the addressee ("Dear HR
--  Team") and stays fixed in the send-roster function so it can never be
--  removed by accident from a settings screen. Everyone below is a copy (Cc).
--
--  lmadlag / dsaxena are receive-only rows: modules '{}' and is_admin false
--  grants nothing. Without a Supabase Auth account they cannot sign in.
--
--  Safe to re-run: it MERGES the notify flags and never touches anyone's
--  existing name, modules or admin rights.
-- ════════════════════════════════════════════════════════════════════════

insert into app_users (email, name, modules, is_admin, notify) values
  -- On BOTH rosters (they are on both today)
  ('lmadlag@robertos.ae',    'Leverina Madlag',      '{}', false, '{roster_foh,roster_kitchen}'),
  ('dsaxena@robertos.ae',    'Diana Saxena',         '{}', false, '{roster_foh,roster_kitchen}'),
  ('fguarracino@robertos.ae','Francesco Guarracino', '{}', false, '{roster_foh,roster_kitchen}'),
  -- FOH roster only
  ('mpetrosino@robertos.ae', 'Manuel Petrosino',     '{}', false, '{roster_foh}'),
  ('jthomas@robertos.ae',    'Jins Thomas',          '{}', false, '{roster_foh}'),
  -- Kitchen roster only
  ('dvalla@robertos.ae',     'Danilo Valla',         '{}', false, '{roster_kitchen}'),
  ('astellacci@robertos.ae', 'Antonio Stellacci',    '{}', false, '{roster_kitchen}'),
  -- NEW: Ouafaa (GM) copied on the FOH roster
  ('onafid@robertos.ae',     'Ouafaa Nafid',         '{}', false, '{roster_foh}')
on conflict (email) do update
  set notify = (select array(select distinct e from unnest(app_users.notify || excluded.notify) e)),
      updated_at = now();

notify pgrst, 'reload schema';

-- ── Check what you just built (this is the list the emails will use) ──
select
  n.key as email_list,
  count(*) as people,
  string_agg(u.email, ', ' order by u.email) as recipients
from (values ('roster_foh'), ('roster_kitchen'), ('closing_report')) as n(key)
join app_users u on u.notify @> array[n.key]
group by n.key
order by n.key;
