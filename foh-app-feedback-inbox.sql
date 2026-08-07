-- ═══════════════════════════════════════════════════════════════════════════
-- foh-app-feedback-inbox.sql  —  The button the team press when THEY have
-- something to say. One inbox for BOTH apps (Kitchen + FOH).
--
-- FOH Supabase project: paoaivwtkzujmrgrfjuq  (shared with the Leadership Hub)
--
-- Run this once in the Supabase SQL editor. It is ADDITIVE ONLY and safe to
-- re-run. It creates one table and widens one function; it does not touch
-- app_feedback, app_feedback_work, or a single answer anyone has ever sent.
--
-- Until it runs, both apps degrade the way the rest of this module already
-- does: the button is there, and if the table is missing the sheet says it
-- could not send. It never says "sent" unless a row came back.
--
-- ── Why this and not another app_feedback topic ────────────────────────────
-- app_feedback is round-shaped: one row per person per round, answers keyed by
-- question. An unprompted "the market list scrolls past the total" has no round
-- and no question, so forcing it in there would mean a fake topic and a fake
-- question number on every row — and the work list, the brief and the status
-- page all read that shape. A sibling table keeps both honest.
--
-- ── Why ONE table for two apps ─────────────────────────────────────────────
-- The Kitchen app has its own Supabase project (zrpglswalgjbtghudmhu), so the
-- easy thing would be a copy of this table there. That would mean two work
-- lists, two status pages, and one of them going unread. Kitchen writes HERE
-- instead, the same way FOH already reads the Kitchen project (foh-core.js:30).
-- The `app` column is what tells them apart.
--
-- ── Why the work state is NOT a new table ──────────────────────────────────
-- An inbox item is recorded in app_feedback_work exactly like a round item,
-- with topic='inbox' and qkey=<this row's id>. So "mark it fixed with what
-- changed, which build, and how to check it" — and the evidence constraint
-- that refuses a bare tick — apply here for free, and their status page shows
-- round items and inbox items side by side.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── The inbox ──────────────────────────────────────────────────────────────
-- One row per thing someone sent. Nothing here is ever edited: what they wrote
-- is theirs. Our side of it lives in app_feedback_work.
create table if not exists app_feedback_inbox (
  id         uuid primary key default gen_random_uuid(),
  app        text not null,                      -- 'kitchen' | 'foh' — which app they pressed it in
  screen     text,                               -- the screen they were on, captured by the app
  kind       text not null default 'idea',       -- 'problem' | 'idea'
  body       text not null,                      -- what they wrote, verbatim
  who        text,                               -- optional: a name, if they gave one
  build      text,                               -- the version they were running
  device     text,                               -- 'iPhone' / 'Android' / 'Laptop' — one word, no fingerprint
  venue_id   text default 'robertos-difc',       -- invisible today; a second branch is a setting, not a rebuild
  created_at timestamptz default now()
);

-- Newest first, and per app — what Admin → Feedback → Inbox reads.
create index if not exists app_feedback_inbox_new_idx on app_feedback_inbox (created_at desc);
create index if not exists app_feedback_inbox_app_idx on app_feedback_inbox (app, created_at desc);

do $$ begin
  alter table app_feedback_inbox drop constraint if exists app_feedback_inbox_kind_ck;
  alter table app_feedback_inbox add constraint app_feedback_inbox_kind_ck
    check (kind in ('problem','idea'));
  -- An empty send is not a send. The sheet already refuses one; so does this,
  -- because the sheet is not the only thing that can reach this table.
  alter table app_feedback_inbox drop constraint if exists app_feedback_inbox_body_ck;
  alter table app_feedback_inbox add constraint app_feedback_inbox_body_ck
    check (coalesce(btrim(body),'') <> '');
end $$;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Deliberately the SAME shape as app_feedback: the whole point is that anyone
-- can press this without a login (the Kitchen prep screen has none and never
-- will — see THE-GOAL.md), so anon may INSERT. Reading is signed-in only:
-- people are talking candidly about their own tools and their own colleagues,
-- so this must not be world-readable just because the key is in the page.
alter table app_feedback_inbox enable row level security;

drop policy if exists app_feedback_inbox_insert on app_feedback_inbox;
create policy app_feedback_inbox_insert on app_feedback_inbox
  for insert to anon, authenticated with check (true);

drop policy if exists app_feedback_inbox_read on app_feedback_inbox;
create policy app_feedback_inbox_read on app_feedback_inbox
  for select to authenticated using (true);

-- ── The status page sees inbox items too ───────────────────────────────────
-- Same narrow door as before: an unguessable token resolves to exactly ONE
-- person and returns only their own rows. Widened by one array — the items
-- THEY sent through the button, each carrying its own work state.
--
-- Unlike a round item, an inbox item's text is not in foh-rounds.js — it is
-- what they typed. So the text comes back with the row; there is nowhere else
-- for the page to get it.
create or replace function feedback_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_who text;
  v_out jsonb;
begin
  select who into v_who from app_feedback_people where token = p_token;
  if v_who is null then
    return jsonb_build_object('ok', false);
  end if;

  select jsonb_build_object(
    'ok', true,
    'who', v_who,
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'topic', s.topic, 'answers', s.answers, 'created_at', s.created_at))
      from (
        select distinct on (f.topic) f.topic, f.answers, f.created_at
        from app_feedback f
        where lower(btrim(f.who)) = lower(btrim(v_who))
        order by f.topic, f.created_at desc
      ) s
    ), '[]'::jsonb),
    -- What they sent through the button in either app, newest first, each with
    -- where we have got to on it. Anonymous sends have no name to match on, so
    -- they never appear on anyone's status page — that is the trade they made.
    'inbox', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'app', i.app, 'screen', i.screen, 'kind', i.kind,
               'body', i.body, 'created_at', i.created_at,
               'work', (select jsonb_build_object(
                          'status', w.status, 'what_changed', w.what_changed,
                          'build', w.build, 'check_line', w.check_line,
                          'verified_at', w.verified_at, 'updated_at', w.updated_at)
                        from app_feedback_work w
                        where w.topic = 'inbox' and w.qkey = i.id::text))
             order by i.created_at desc)
      from app_feedback_inbox i
      where lower(btrim(i.who)) = lower(btrim(v_who))
    ), '[]'::jsonb),
    'work', coalesce((
      select jsonb_agg(jsonb_build_object(
               'topic', w.topic, 'qkey', w.qkey, 'status', w.status,
               'what_changed', w.what_changed, 'build', w.build,
               'check_line', w.check_line, 'verified_at', w.verified_at,
               'updated_at', w.updated_at))
      from app_feedback_work w
      where w.topic in (
        select distinct f2.topic from app_feedback f2
        where lower(btrim(f2.who)) = lower(btrim(v_who))
      )
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $$;

revoke all on function feedback_status(text) from public;
grant execute on function feedback_status(text) to anon, authenticated;

-- Refresh PostgREST so the new table and the widened function are visible to
-- both apps immediately.
notify pgrst, 'reload schema';

-- After running: the button (bottom-right of every screen, both apps) can send,
-- and what comes back is in Admin → Feedback → Inbox.
