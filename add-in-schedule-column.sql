-- "Show in the schedule" per-person toggle (Admin → person panel).
-- Run once in the FOH Supabase project (paoaivwtkzujmrgrfjuq).
-- Additive + safe: every existing person defaults to TRUE (shows in the roster),
-- so nothing changes until you turn someone OFF in Admin.

alter table foh_staff add column if not exists in_schedule boolean not null default true;
notify pgrst, 'reload schema';
