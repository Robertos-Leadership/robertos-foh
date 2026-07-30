-- ============================================================
--  events-timings.sql
--  Make the Activations module mirror the real activation windows from
--  "Activation Schedule.xlsx":
--     Vinyl / Listening Bar (Mon) ... 7:00 PM - 11:00 PM
--     Jazz Night (Tue) .............. 8:30 PM - 11:30 PM
--     Comedy Night (Wed) ............ 8:30 PM - 11:00 PM
--     Cigar Night (Thu, "onwards") .. 8:00 PM - (open-ended)
--
--  The app stores/reads events.time_start + events.time_end as 12-hour
--  labels (e.g. '8:30 PM') -- see timeOptions() in foh-events.js -- and
--  displays "start - end" on each activation. time_end was never in the
--  base schema, so add it if missing (same drift as the weeks columns).
--
--  SAFE + IDEMPOTENT. Run in Supabase SQL editor (FOH project paoaivwtkzujmrgrfjuq).
-- ============================================================

alter table events add column if not exists time_end text;

UPDATE events SET time_start = '7:00 PM',  time_end = '11:00 PM' WHERE name ILIKE '%listening%';
UPDATE events SET time_start = '8:30 PM',  time_end = '11:30 PM' WHERE name ILIKE '%jazz%';
UPDATE events SET time_start = '8:30 PM',  time_end = '11:00 PM' WHERE name ILIKE '%comedy%';
UPDATE events SET time_start = '8:00 PM',  time_end = NULL       WHERE name ILIKE '%cigar%';   -- "onwards"

notify pgrst, 'reload schema';

-- Verify:
SELECT name, day_of_week, time_start, time_end FROM events ORDER BY name;
