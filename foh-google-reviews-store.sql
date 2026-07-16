-- ════════════════════════════════════════════════════════════════════════
-- GUEST REVIEWS — the "newest reviews we have collected" store
-- Project: paoaivwtkzujmrgrfjuq (FOH). DB is shared dev+live → LIVE IMMEDIATELY.
-- Run AFTER foh-google-reviews.sql (needs fn_has_module from security-batch-a).
--
-- WHY THIS TABLE EXISTS:
--   Google only ever hands us 5 "most relevant" reviews per venue and never a
--   newest-first list. But the 5 ROTATE, and fresh reviews pass through the
--   window while they are new. So each night the google-reviews edge function
--   keeps any review it sees that was PUBLISHED within the last 7 days. Stored
--   here, sorted by publish date, that pile becomes an honest "newest reviews
--   we have collected" list — the same method the CRM's reputation page uses.
--   It is NOT guaranteed complete: a review that never enters Google's five is
--   never seen. Nothing here may ever promise 1-star alerting.
--
-- ⚠ LICENCE CONSTRAINT, NOT A PREFERENCE:
--   Google forbids keeping their content beyond 30 consecutive days (Place IDs
--   exempt). Review TEXT lives here, so this table purges anything first seen
--   more than 30 days ago, on every write — stricter than the 31-day window on
--   google_reviews_daily, which holds only our own counted numbers.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.google_reviews_seen (
  venue_key    text not null,               -- 'robertos', 'zuma', …
  review_key   text not null,               -- Google's review resource name (places/…/reviews/…)
  rating       numeric(2,1),
  review_text  text,                        -- may be empty: a rating with no words
  author       text,
  author_uri   text,
  maps_uri     text,                        -- deep link back to the review (required attribution)
  publish_time timestamptz not null,        -- when the guest published it
  first_seen   date not null default (now() at time zone 'Asia/Dubai')::date,
  last_seen    date not null default (now() at time zone 'Asia/Dubai')::date,
  primary key (venue_key, review_key)
);

comment on table public.google_reviews_seen is
  'Reviews seen in Google''s rotating five while under 7 days old, kept max 30 days (Google licence), then self-purged. Honest but NOT complete — never alert off this.';

create index if not exists google_reviews_seen_pub_idx
  on public.google_reviews_seen (venue_key, publish_time desc);

-- ── The 30-day purge (from first_seen — the day the text entered our DB) ──
create or replace function public.fn_google_reviews_seen_purge()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.google_reviews_seen
   where first_seen < (current_date - interval '30 days');
  return null;
end;
$$;

drop trigger if exists trg_google_reviews_seen_purge on public.google_reviews_seen;
create trigger trg_google_reviews_seen_purge
  after insert or update on public.google_reviews_seen
  for each statement execute function public.fn_google_reviews_seen_purge();

-- ── Access: same shape as google_reviews_daily ─────────────────────────────
-- Read: holders of the 'reviews' module (admins always). Anon: nothing.
-- Write: only the edge function via the service role — no app-side policies.
alter table public.google_reviews_seen enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname='public' and tablename='google_reviews_seen' loop
    execute format('drop policy %I on public.google_reviews_seen', p.policyname);
  end loop;
end $$;

create policy google_reviews_seen_read
  on public.google_reviews_seen
  for select to authenticated
  using (public.fn_has_module('reviews'));

notify pgrst, 'reload schema';

-- Check it worked:
--   select venue_key, count(*), max(publish_time) from google_reviews_seen group by venue_key;
