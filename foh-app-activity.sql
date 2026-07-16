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

-- ═══════════════════════════════════════════════════════════════════════════
-- app_activity_summary  —  added 16 Jul 2026
--
-- WHY: the Usage page used to read the newest 500 rows and aggregate them in
-- the browser. Once the table passed 500 rows that window stopped reaching far
-- enough back, and anyone whose last visit fell off the edge silently vanished
-- from "who's using the app" — measured 16 Jul: 1,104 rows, window only reached
-- 14 Jul, so Danilo looked like he'd never signed in. Raising 500 only moves the
-- cliff (and PostgREST hard-caps at 1000/request anyway), so the count is done
-- in the database instead: one row per person, complete for all time, ~19 rows.
--
-- Safe to re-run. Additive: nothing reads app_activity differently, and the
-- app still degrades gracefully if this view is missing.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view app_activity_summary
with (security_invoker = on) as
with base as (
  select lower(coalesce(nullif(trim(user_email), ''), 'unknown')) as user_email,
         action, module, created_at
  from app_activity
),
mods as (   -- per-person, per-module open counts
  select user_email, module, count(*)::int as cnt
  from base
  where action = 'open' and module is not null
  group by 1, 2
),
agg as (
  select user_email,
         max(created_at) as last_seen,
         count(*)::int   as events,
         count(*) filter (
           where action = 'login' and created_at >= now() - interval '7 days'
         )::int as logins7
  from base
  group by 1
)
select a.user_email,
       a.last_seen,
       a.events,
       a.logins7,
       coalesce(
         (select jsonb_object_agg(m.module, m.cnt) from mods m where m.user_email = a.user_email),
         '{}'::jsonb
       ) as mods
from agg a;

grant select on app_activity_summary to anon, authenticated;

-- Refresh PostgREST so the new table is visible to the app immediately.
notify pgrst, 'reload schema';
