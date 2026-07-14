-- ════════════════════════════════════════════════════════════
-- event_menu_choices — the guest's own per-course numbers for a set menu.
-- The guest opens client-setmenu.html?t=<client_token>&m=<menu>&g=<guests>,
-- enters how many of each choice (must add up to the guest count) and submits;
-- the row lands here. Valentina reviews and applies it on the event's Food
-- card ("Guest's numbers") — nothing reaches the kitchen without her tap.
--
--   anon may only INSERT (the guest page); only logged-in app users can read
--   or mark a row applied. token = events_desk.client_token (the link secret).
-- Run once in the FOH Supabase project (paoaivwtkzujmrgrfjuq).
-- ════════════════════════════════════════════════════════════
create extension if not exists pgcrypto;

create table if not exists event_menu_choices (
  id         uuid primary key default gen_random_uuid(),
  token      text not null,
  menu_key   text,
  guests     int,
  choices    jsonb not null default '{}'::jsonb,
  note       text,
  applied    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists event_menu_choices_token on event_menu_choices (token, created_at desc);

alter table event_menu_choices enable row level security;
drop policy if exists event_menu_choices_insert on event_menu_choices;
create policy event_menu_choices_insert on event_menu_choices
  for insert to anon, authenticated with check (true);
drop policy if exists event_menu_choices_read on event_menu_choices;
create policy event_menu_choices_read on event_menu_choices
  for select to authenticated using (true);
drop policy if exists event_menu_choices_update on event_menu_choices;
create policy event_menu_choices_update on event_menu_choices
  for update to authenticated using (true) with check (true);
