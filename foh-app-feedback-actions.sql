-- ═══════════════════════════════════════════════════════════════════════════
-- foh-app-feedback-actions.sql  —  Admin → Feedback: mark work done, and know
-- who was sent a round.  (Follows foh-app-feedback.sql, which must run first.)
--
-- FOH Supabase project: paoaivwtkzujmrgrfjuq  (shared with the Leadership Hub)
--
-- Run this once in the Supabase SQL editor. It is ADDITIVE ONLY and safe to
-- re-run (IF NOT EXISTS / drop-and-recreate policies). Nothing here touches
-- app_feedback or a single answer anyone has sent.
--
-- Until it runs, the app degrades the way the rest of this module already does:
-- Admin → Feedback still reads and renders every reply exactly as before, and
-- simply notes that these two extras need this file run. Nothing breaks.
--
-- ── Why these two tables ────────────────────────────────────────────────────
--
-- 1. app_feedback_done — the work list never shrank. Every round Francesco had
--    fully dealt with looked identical to one he had not touched: nine of
--    Andrea's eleven were fixed and live, and the list still showed eleven.
--    A tick here is the ONLY thing that changes, and it never edits an answer:
--    what the team said is theirs and stays exactly as they sent it.
--
-- 2. app_feedback_sent — nothing recorded that a round had been sent, so
--    "has Ouafaa answered?" lived in Francesco's memory. app_feedback only ever
--    held REPLIES, so silence and never-asked looked the same. One row per send.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── 1. Items ticked off the work list ──────────────────────────────────────
-- qkey is the answer key inside app_feedback.answers — the item's stable id if
-- its round gives it one, else its 1-based position. See foh-rounds.js.
create table if not exists app_feedback_done (
  id         uuid primary key default gen_random_uuid(),
  topic      text not null,                      -- e.g. 'coo-events'
  qkey       text not null,                      -- e.g. '2'  (matches answers ->> key)
  done_by    text,                               -- who ticked it (app user email)
  done_at    timestamptz default now(),
  venue_id   text default 'robertos-difc',
  -- One tick per question per round: ticking twice is not two facts. This also
  -- makes the untick below an ordinary delete, with nothing to disambiguate.
  unique (topic, qkey)
);

create index if not exists app_feedback_done_topic_idx on app_feedback_done (topic);

-- ── 2. A record that a round was sent ──────────────────────────────────────
-- Deliberately NOT unique on (topic, who): sending a second time is a real
-- event (a chase), and the screen wants to show that it happened, not hide it.
create table if not exists app_feedback_sent (
  id         uuid primary key default gen_random_uuid(),
  topic      text not null,
  who        text,                               -- the name that goes in the link
  email      text,                               -- who it was addressed to
  channel    text,                               -- 'email' | 'whatsapp' | 'link'
  sent_by    text,
  sent_at    timestamptz default now(),
  venue_id   text default 'robertos-difc'
);

create index if not exists app_feedback_sent_topic_idx on app_feedback_sent (topic, sent_at desc);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Both tables are ADMIN-ONLY, in both directions. Unlike app_feedback — which
-- anon must INSERT into, because the team answer on a public page with no login
-- — nothing anonymous ever reads or writes these. Only a signed-in app user
-- ticks work off or sends a round.
alter table app_feedback_done enable row level security;
alter table app_feedback_sent enable row level security;

drop policy if exists app_feedback_done_all on app_feedback_done;
create policy app_feedback_done_all on app_feedback_done
  for all to authenticated using (true) with check (true);

drop policy if exists app_feedback_sent_all on app_feedback_sent;
create policy app_feedback_sent_all on app_feedback_sent
  for all to authenticated using (true) with check (true);

-- Refresh PostgREST so the new tables are visible to the app immediately.
notify pgrst, 'reload schema';

-- After running: open Admin → Feedback and tap Refresh. The work list gains a
-- "Mark done" button on each line, and a "Sent, nothing back yet" list appears
-- under each round once you send one.
