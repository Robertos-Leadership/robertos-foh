-- FOH schedule: 4 shared quick-fill shift presets (shown in the shift editor).
-- Run once in the FOH Supabase project → SQL editor.
-- The app falls back to built-in defaults until this table exists, so nothing breaks
-- before you run it. Edit the presets later from the "Edit presets" link in the app.

create table if not exists foh_shift_presets (
  slot        int primary key,            -- 1..4 (the four buttons)
  label       text not null,              -- button name (e.g. Lunch)
  status      text not null default 'working',
  shift_start text, shift_end text,       -- 'HH:MM'
  shift_start2 text, shift_end2 text,     -- optional split-shift second block
  updated_at  timestamptz default now()
);

-- Seed four sensible FOH defaults (editable in-app).
insert into foh_shift_presets (slot, label, status, shift_start, shift_end, shift_start2, shift_end2) values
  (1, 'Lunch',    'working', '11:00', '17:00', null,    null),
  (2, 'Dinner',   'working', '17:00', '01:00', null,    null),
  (3, 'Double',   'working', '11:00', '16:00', '18:00', '01:00'),
  (4, 'Day off',  'off',     null,    null,    null,    null)
on conflict (slot) do nothing;

-- Same access model as the foh_staff / foh_roster / foh_events / foh_sections tables.
alter table foh_shift_presets enable row level security;
drop policy if exists foh_shift_presets_all on foh_shift_presets;
create policy foh_shift_presets_all on foh_shift_presets for all using (true) with check (true);

notify pgrst, 'reload schema';
