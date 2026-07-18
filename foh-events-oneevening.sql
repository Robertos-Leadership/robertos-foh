-- ═══════════════════════════════════════════════════════════════════════════
-- foh-events-oneevening.sql — 18 Jul 2026
--
-- Four things the team asked for, each one a separate request:
--
--   spaces        (Valentina, events-20 #5)  "Canapés in the Cortile first, then
--                 dinner in Piemonte." One booking, one price, two rooms across
--                 the evening. Her words: "only 1 price". The FIRST space stays
--                 in the existing area / time_from / time_to columns, so every
--                 booking ever made already has a valid run of the evening and
--                 nothing had to be migrated. This column carries the ones AFTER
--                 it: [{"area":"Piemonte","from":"20:30","to":"23:00","note":"Dinner"}]
--
--   options       (Valentina, events-20 #12) "Send me three options and I'll
--   option_chosen pick one." One enquiry, one email, one line in the pipeline —
--                 instead of three bookings, three emails and two to tidy up by
--                 hand afterwards. options is
--                 [{"key":"a","name":"Cortile canapés","area":…,"guests":…,
--                   "price_pp":…,"min_spend":…,"note":…}]
--                 and option_chosen is the key the guest picked ('a'), which is
--                 what puts that option's numbers onto the booking itself.
--
--   alt_dates     (Valentina, events-20 #13) "Either the 12th or the 19th —
--                 whichever you have." One booking that holds both, so neither
--                 one gets forgotten. [{"date":"2026-08-19","from":"19:00","to":"23:00"}]
--                 event_date stays the FIRST choice, so every existing screen,
--                 report and month filter keeps working untouched — and the
--                 booking is still counted exactly ONCE, on that date.
--
--   event_targets (Andrea, coo-events-2 #11) "minimum target sale expressed in
--                 number of events and revenue". There was no events target at
--                 all, so nothing could say whether a month was on plan. One row
--                 per month. Valentina never touches this.
--
-- Run ONCE in the Supabase SQL editor (project paoaivwtkzujmrgrfjuq).
-- Safe to re-run: every statement is IF NOT EXISTS. Purely additive — no
-- existing column is altered and no existing row is rewritten.
--
-- Until it runs the app degrades the way the rest of this module already does
-- (peColMissing): the new controls keep working in-session and say they need
-- this file run to save. Nothing that works today stops working.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Two spaces in one evening, one price ────────────────────────────────
alter table events_desk add column if not exists spaces jsonb;

-- ── 2. Three options on one enquiry ────────────────────────────────────────
alter table events_desk add column if not exists options       jsonb;
alter table events_desk add column if not exists option_chosen text;

-- ── 3. Two possible dates on one booking ───────────────────────────────────
alter table events_desk add column if not exists alt_dates jsonb;

-- ── 4. The monthly events target ───────────────────────────────────────────
-- target_events and target_revenue are BOTH nullable on purpose. Andrea gave us
-- a revenue target for July and August and did NOT give an event count, so the
-- count stays genuinely empty and the report says "not set" rather than showing
-- a number nobody ever asked for.
create table if not exists event_targets (
  month          text primary key,          -- 'YYYY-MM'
  target_events  integer,                   -- how many events (null = not set)
  target_revenue numeric,                   -- AED, gross (null = not set)
  venue_id       text default 'robertos-difc',
  updated_by     text,
  updated_at     timestamptz default now()
);

alter table event_targets enable row level security;

-- Same posture as events_desk: signed-in app users only, in both directions.
-- Nothing anonymous ever reads or writes a target.
drop policy if exists event_targets_all on event_targets;
create policy event_targets_all on event_targets
  for all to authenticated using (true) with check (true);

-- Andrea Sacchi, 17 Jul 2026, asked for the events target and answered with
-- exactly one number: "Target for the month of July and august for events is
-- 150000 AED". So that is the only number seeded here — the revenue, for those
-- two months, and nothing else. The event COUNT he was also asked for is left
-- null because he did not give one, and inventing it would put a figure on his
-- report that he never said.
insert into event_targets (month, target_revenue, updated_by)
values ('2026-07', 150000, 'Andrea Sacchi (feedback round)'),
       ('2026-08', 150000, 'Andrea Sacchi (feedback round)')
on conflict (month) do nothing;

-- Refresh PostgREST so the new columns and table are visible immediately.
notify pgrst, 'reload schema';
