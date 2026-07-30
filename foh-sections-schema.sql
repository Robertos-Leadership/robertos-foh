-- FOH schedule: sections list (lets a manager add / rename sections in the Roster tool).
-- Run once in the FOH Supabase project → SQL editor.
-- The keys below MUST match the foh_staff.section values already on the staff rows, so the
-- existing team stays grouped correctly. The app falls back to its built-in list until
-- this table exists, so nothing breaks before you run it.

create table if not exists foh_sections (
  section_key text primary key,          -- stable id used by foh_staff.section (never changes on rename)
  label       text not null,             -- the display name (this is what "rename" changes)
  sort_order  int  not null default 0,
  active      boolean not null default true,
  updated_at  timestamptz default now()
);

-- Seed with the sections currently hardcoded in the app (FOH_SECTIONS).
insert into foh_sections (section_key, label, sort_order) values
  ('Management',      'Management',        1),
  ('Restaurant',      'Restaurant',        2),
  ('Head Waiter',     'Head Waiter',       3),
  ('Waiter/Waitress', 'Waiter / Waitress', 4),
  ('Runners',         'Runners',           5),
  ('Bar',             'Bar',               6),
  ('Hostess Desk',    'Hostess Desk',      7),
  ('Security',        'Security',          8),
  ('Housekeeping',    'Housekeeping',      9),
  ('Cashiers',        'Cashiers',          10)
on conflict (section_key) do nothing;

-- Same access model as the foh_staff / foh_roster / foh_events tables (PIN-gated anon layer).
alter table foh_sections enable row level security;
drop policy if exists foh_sections_all on foh_sections;
create policy foh_sections_all on foh_sections for all using (true) with check (true);

-- Make PostgREST pick up the new table immediately.
notify pgrst, 'reload schema';
