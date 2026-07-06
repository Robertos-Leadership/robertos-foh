-- ═══════════════════════════════════════════════════════════════════════════
-- foh-app-activity.sql  —  Usage / adoption tracker (Admin → Usage)
-- FOH Supabase project: paoaivwtkzujmrgrfjuq  (shared with the Leadership Hub)
--
-- Run this once in the Supabase SQL editor. It is ADDITIVE ONLY and safe to
-- re-run (IF NOT EXISTS / drop-and-recreate policy). Until it runs, the app
-- degrades gracefully: activity inserts fail silently and the Admin "Usage"
-- view shows a "run foh-app-activity.sql" note instead of erroring.
--
-- What it records: one row per sign-in ('login') and per module open ('open'),
-- so Francesco can show — before the September IT handover — who actually
-- uses the app and which modules.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists app_activity (
  id         uuid primary key default gen_random_uuid(),
  user_email text,
  action     text,                              -- 'login' or 'open'
  module     text,                              -- null for 'login'
  venue_id   text default 'robertos-difc',
  created_at timestamptz default now()
);

-- Fast "recent activity" reads + per-user summaries.
create index if not exists app_activity_created_at_idx on app_activity (created_at desc);
create index if not exists app_activity_user_email_idx on app_activity (user_email);

-- Open layer: anon insert + read (the app uses the anon key; accountability is
-- the signed-in email written into each row, not RLS auth — same pattern as the
-- other FOH tables).
alter table app_activity enable row level security;
drop policy if exists "Allow all app_activity" on app_activity;
create policy "Allow all app_activity" on app_activity for all using (true) with check (true);

-- Refresh PostgREST so the new table is visible to the app immediately.
notify pgrst, 'reload schema';
