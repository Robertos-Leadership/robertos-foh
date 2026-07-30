-- ═══════════════════════════════════════════════════════════════════════
--  FOH ROSTER TOOL — all 3 schema pieces in ONE paste. Run once in the
--  FOH Supabase project → SQL editor. Safe to re-run (everything is
--  IF NOT EXISTS / ON CONFLICT DO NOTHING).
--  Combines: foh-sections-schema.sql + foh-shift-presets-schema.sql
--            + foh-station-override-schema.sql
-- ═══════════════════════════════════════════════════════════════════════

-- 1) Sections list (lets a manager add / rename / reorder / delete sections
--    in the Roster tool). Keys MUST match foh_staff.section values.
create table if not exists foh_sections (
  section_key text primary key,          -- stable id used by foh_staff.section (never changes on rename)
  label       text not null,             -- the display name (this is what "rename" changes)
  sort_order  int  not null default 0,
  active      boolean not null default true,
  updated_at  timestamptz default now()
);

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

alter table foh_sections enable row level security;
drop policy if exists foh_sections_all on foh_sections;
create policy foh_sections_all on foh_sections for all using (true) with check (true);

-- 2) The 4 shared quick-fill shift presets (shown in the shift editor,
--    on the live schedule AND in the Roster tool; editable in-app).
create table if not exists foh_shift_presets (
  slot        int primary key,            -- 1..4 (the four buttons)
  label       text not null,              -- button name (e.g. Lunch)
  status      text not null default 'working',
  shift_start text, shift_end text,       -- 'HH:MM'
  shift_start2 text, shift_end2 text,     -- optional split-shift second block
  updated_at  timestamptz default now()
);

insert into foh_shift_presets (slot, label, status, shift_start, shift_end, shift_start2, shift_end2) values
  (1, 'Lunch',    'working', '11:00', '17:00', null,    null),
  (2, 'Dinner',   'working', '17:00', '01:00', null,    null),
  (3, 'Double',   'working', '11:00', '16:00', '18:00', '01:00'),
  (4, 'Day off',  'off',     null,    null,    null,    null)
on conflict (slot) do nothing;

alter table foh_shift_presets enable row level security;
drop policy if exists foh_shift_presets_all on foh_shift_presets;
create policy foh_shift_presets_all on foh_shift_presets for all using (true) with check (true);

-- 3) One-day "cover another section": a single optional column on foh_roster.
--    When set, that person works a DIFFERENT section for that ONE day only;
--    their real section (foh_staff.section) never changes. NULL = normal.
alter table foh_roster add column if not exists station_override text;

-- Make PostgREST pick everything up immediately.
notify pgrst, 'reload schema';
