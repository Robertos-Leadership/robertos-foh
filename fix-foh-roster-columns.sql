-- Roberto's FOH — foh_roster missing-column fix (June 2026)
-- Project: Leadership Hub Supabase (paoaivwtkzujmrgrfjuq). Run in SQL Editor. Safe to re-run.
--
-- SYMPTOM: Duplicate Week (and saving a shift) silently did nothing / produced
-- an empty week. The schedule upsert payload includes `notes` and `updated_at`,
-- but the live foh_roster table was missing both columns, so every upsert failed
-- with PGRST204 ("Could not find the '<col>' column ... in the schema cache")
-- and zero rows were written.
--
-- CAUSE: foh-schema.sql declares these columns, but uses `create table if not
-- exists` — which does NOT add columns to an already-existing table. The table
-- pre-existed, so the columns were never added.

alter table foh_roster add column if not exists notes      text;
alter table foh_roster add column if not exists updated_at timestamptz default now();

-- Tell PostgREST to refresh its schema cache (otherwise it keeps returning PGRST204)
notify pgrst, 'reload schema';
