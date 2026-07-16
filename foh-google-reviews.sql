-- ════════════════════════════════════════════════════════════════════════
-- GUEST REVIEWS — Google ratings snapshot table
-- Project: paoaivwtkzujmrgrfjuq (FOH). DB is shared dev+live → LIVE IMMEDIATELY.
--
-- Holds ONE row per venue per day: the star rating and the number of ratings,
-- pulled each morning by the google-reviews edge function. That daily trail is
-- the only way to answer "how many new ratings did we collect this month" —
-- Google never tells us, it only ever reports the running total.
--
-- ⚠ LICENCE CONSTRAINT, NOT A PREFERENCE:
--   Google's terms forbid keeping their content beyond 30 consecutive days.
--   Place IDs are the single exception (they may be stored indefinitely).
--   So this table PURGES ITSELF on every write — see trg_google_reviews_purge
--   below. It can never become a longer history, and no review TEXT is ever
--   stored here at all (review text is fetched live and shown, never saved).
--
-- Depends on fn_has_module() from security-batch-a.sql (applied 14 Jul 2026).
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.google_reviews_daily (
  venue_key         text not null,          -- 'robertos', 'zuma', 'lpm', …
  place_id          text not null,          -- Google Place ID (storable forever)
  snapshot_date     date not null,          -- Dubai business date of the pull
  rating            numeric(2,1),           -- e.g. 4.5
  user_rating_count integer,                -- e.g. 2679
  created_at        timestamptz not null default now(),
  primary key (venue_key, snapshot_date)
);

comment on table public.google_reviews_daily is
  'Daily Google rating/count per DIFC venue. Self-purging at 30 days to honour Google''s caching terms. Never stores review text.';

create index if not exists google_reviews_daily_date_idx
  on public.google_reviews_daily (snapshot_date desc);

-- ── The 30-day purge ────────────────────────────────────────────────────
-- Statement-level, fires after every insert/update. Belt and braces: the
-- table cannot drift past 30 days even if the daily job is edited later or
-- someone back-fills by hand. 31 days kept so a full 30-day window is always
-- comparable (today vs the row 30 days ago).
create or replace function public.fn_google_reviews_purge()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.google_reviews_daily
   where snapshot_date < (current_date - interval '31 days');
  return null;
end;
$$;

drop trigger if exists trg_google_reviews_purge on public.google_reviews_daily;
create trigger trg_google_reviews_purge
  after insert or update on public.google_reviews_daily
  for each statement execute function public.fn_google_reviews_purge();

-- ── Access ──────────────────────────────────────────────────────────────
-- Read: users holding the 'reviews' module (admins always). Anon: nothing.
-- Write: NOBODY through the app. Only the edge function writes, using the
-- service role key, which bypasses RLS — so there is deliberately no insert,
-- update or delete policy here. A logged-in user cannot alter the trail.
alter table public.google_reviews_daily enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname='public' and tablename='google_reviews_daily' loop
    execute format('drop policy %I on public.google_reviews_daily', p.policyname);
  end loop;
end $$;

create policy google_reviews_daily_read
  on public.google_reviews_daily
  for select to authenticated
  using (public.fn_has_module('reviews'));

notify pgrst, 'reload schema';

-- ── Grant the module ────────────────────────────────────────────────────
-- Access is default-deny: a user with no app_users row gets events+operations
-- only. Named users need 'reviews' added explicitly. Adjust this list before
-- running — these are the people who asked for it.
update public.app_users
   set modules = (select array_agg(distinct m) from unnest(modules || array['reviews']) m)
 where lower(email) in (
   'fguarracino@robertos.ae',
   'onafid@robertos.ae'          -- Ouafaa Nafid, GM (started 15 Jul 2026)
 );

-- Check what each person can now open:
--   select email, modules, is_admin from app_users order by email;
