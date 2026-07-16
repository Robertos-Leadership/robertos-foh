-- ════════════════════════════════════════════════════════════════════════
-- GUEST REVIEWS — rating PACE, our own long-term measurement
-- Project: paoaivwtkzujmrgrfjuq (FOH). DB is shared dev+live → LIVE IMMEDIATELY.
-- Run AFTER foh-google-reviews.sql.
--
-- WHAT A ROW IS: "on this day, this venue's Google rating count had grown by
-- N since our previous look." Google never provides this number — it only
-- ever reports a running total. Each night the google-reviews edge function
-- subtracts yesterday's total from today's WHILE BOTH ARE LEGITIMATELY HELD
-- (both inside the 30-day cache window) and stores only the difference.
--
-- WHY THIS TABLE IS ALLOWED TO KEEP HISTORY (written for the IT handover):
--   Google's licence caps caching of ITS content — the totals and star
--   ratings it returns — at 30 consecutive days. google_reviews_daily
--   honours that and purges itself. The integer stored here (+3, 0, -1) is
--   NOT a figure Google ever returned; it is our own daily observation,
--   computed from two values while both were lawfully in hand. Keeping our
--   own measurements is the same position every reputation tool takes for
--   trend lines. Deliberately NOT stored here: any raw total, any star
--   rating — those live only in the 30-day table. If legal ever disagrees,
--   dropping this one table removes the entire long history cleanly.
--
-- gained CAN BE NEGATIVE: Google removes spam reviews, so a count can fall.
-- over_days: normally 1; if a night was missed the next measurement covers
-- several days (e.g. gained 5 over_days 2) — charts can normalise honestly.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.google_reviews_pace (
  venue_key  text not null,                 -- 'robertos', 'zuma', …
  day        date not null,                 -- Dubai date the measurement was taken
  gained     integer not null,              -- new ratings since the previous look (can be negative)
  over_days  integer not null default 1,    -- how many days the measurement spans
  created_at timestamptz not null default now(),
  primary key (venue_key, day)
);

comment on table public.google_reviews_pace is
  'Our own daily count of NEW Google ratings per venue (a derived measurement, not Google content) — kept long-term for trend history. Raw Google totals live only in google_reviews_daily, which purges at 30 days.';

create index if not exists google_reviews_pace_day_idx
  on public.google_reviews_pace (day desc);

-- ── Access: same shape as the other review tables ───────────────────────
-- Read: holders of the 'reviews' module (admins always). Anon: nothing.
-- Write: only the edge function via the service role — no app-side policies.
alter table public.google_reviews_pace enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname='public' and tablename='google_reviews_pace' loop
    execute format('drop policy %I on public.google_reviews_pace', p.policyname);
  end loop;
end $$;

create policy google_reviews_pace_read
  on public.google_reviews_pace
  for select to authenticated
  using (public.fn_has_module('reviews'));

notify pgrst, 'reload schema';

-- Check it worked (will be empty until the first two mornings have run):
--   select venue_key, sum(gained), min(day), max(day) from google_reviews_pace group by venue_key;
