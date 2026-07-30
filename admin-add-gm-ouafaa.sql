-- ════════════════════════════════════════════════════════════════════════
--  NEW GM — Ouafaa Nafid, General Manager (started 15 Jul 2026)
--  Project: FOH Supabase (paoaivwtkzujmrgrfjuq). Run in the SQL Editor.
--
--  Grants all five modules (Closing Report, Activations, Revenue, Stock Take,
--  Events) + the nightly closing-report email. NOT an admin — Francesco stays
--  the only person who can change users & access.
--
--  Prerequisite: the Supabase Auth login for onafid@robertos.ae must exist
--  (create-foh-user.ps1). This table only controls what she SEES once in.
-- ════════════════════════════════════════════════════════════════════════

insert into app_users (email, name, modules, is_admin, notify) values
  ('onafid@robertos.ae', 'Ouafaa Nafid',
   array['events','operations','revenue','stocktake','privateevents'],
   false,
   array['closing_report'])
on conflict (email) do update set
  name     = excluded.name,
  modules  = excluded.modules,
  is_admin = excluded.is_admin,
  notify   = excluded.notify,
  updated_at = now();

notify pgrst, 'reload schema';
