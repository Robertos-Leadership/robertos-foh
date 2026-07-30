-- One-day "cover another section" support for the FOH schedule + Roster tool.
-- Run once in the FOH Supabase project → SQL editor.
-- Adds a single optional column to the existing foh_roster table: when set, that
-- person is working in a DIFFERENT section for that ONE day only. Their real
-- section (foh_staff.section) never changes. NULL = normal (their own section).
--
-- Safe to run once. Does nothing if the column already exists.

alter table foh_roster add column if not exists station_override text;

-- Let PostgREST see the new column immediately.
notify pgrst, 'reload schema';
