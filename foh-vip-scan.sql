-- ===================================================================
-- VIP name-match scan  ·  Reservations module
-- Run ONCE on the FOH project (paoaivwtkzujmrgrfjuq).
-- Safe to re-run: every statement is IF NOT EXISTS / ON CONFLICT.
-- ===================================================================
--
-- WHAT THIS STORES, AND WHAT IT DELIBERATELY DOES NOT.
--
-- One row per SevenRooms client the scan has looked at. It holds a NAME
-- MATCH -- "somebody notable is called this" -- and never a claim that the
-- guest IS that person. That distinction is the whole point of the feature:
-- a manager confirms or rejects, and until they do, the app says "possible".
--
-- No biography, no photo, no scraped text is kept. A title, a one-line
-- description and a source link is the entire record -- enough for a manager
-- to click through and decide for themselves, and nothing that turns this
-- table into a dossier on a guest.
--
-- `status` is the whole state machine:
--   match      -- notable name found, nobody has looked at it yet
--   confirmed  -- a manager says this IS them; shows as VIP from now on
--   dismissed  -- a manager says it is not; never shown again for this guest
--   clear      -- the lookup ran and found nothing notable. Stored ON PURPOSE
--                 so tomorrow's scan skips this guest instead of asking the
--                 same question of the same API every single night.

create table if not exists public.guest_notability (
  client_id    text primary key,          -- SevenRooms client id
  guest_name   text not null,
  status       text not null default 'match'
               check (status in ('match','confirmed','dismissed','clear')),
  title        text,                      -- e.g. "Jennifer Lopez"
  description  text,                      -- e.g. "American singer and actress"
  source       text,                      -- 'google-kg' | 'wikidata'
  source_url   text,                      -- the Wikipedia/Wikidata page
  score        numeric,                   -- notability signal, for tuning later
  scanned_at   timestamptz not null default now(),
  decided_by   text,                      -- email of the manager who decided
  decided_at   timestamptz
);

-- The nightly scan reads "who have we already seen"; the screen reads
-- "anything to show for these clients". Both are lookups by client_id, which
-- the primary key already serves. This index is for the admin count only.
create index if not exists guest_notability_status_idx
  on public.guest_notability (status);

alter table public.guest_notability enable row level security;

-- Same posture as the rest of the FOH tables: signed-in staff only. The
-- module gate (Reservations permission) is what decides who SEES it; the
-- database's job here is simply to keep anonymous readers out.
drop policy if exists guest_notability_read  on public.guest_notability;
drop policy if exists guest_notability_write on public.guest_notability;

create policy guest_notability_read on public.guest_notability
  for select to authenticated using (true);

create policy guest_notability_write on public.guest_notability
  for all to authenticated using (true) with check (true);

-- ── The admin switch ────────────────────────────────────────────────
-- Reuses app_config, the same key/value table the signers list lives in.
-- Default OFF: the feature ships dark and Francesco turns it on when he
-- wants it, rather than starting to call an external API the moment the
-- deploy lands.
insert into public.app_config (key, value, updated_at)
values ('vip_scan', '{"enabled": false}'::jsonb, now())
on conflict (key) do nothing;
