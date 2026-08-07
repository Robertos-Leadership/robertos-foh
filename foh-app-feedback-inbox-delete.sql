-- ═══════════════════════════════════════════════════════════════════════════
-- foh-app-feedback-inbox-delete.sql  —  let a signed-in admin delete an inbox
-- message. Runs AFTER foh-app-feedback-inbox.sql.
--
-- FOH Supabase project: paoaivwtkzujmrgrfjuq
-- Additive and safe to re-run. It adds ONE policy and nothing else.
--
-- ── Why this is deliberately narrow ────────────────────────────────────────
-- Everywhere else in this module, what a person said is theirs: a round answer
-- can never be deleted, and "Back on the list" only removes OUR record of the
-- work. That rule is the reason the team can be candid.
--
-- This is the one exception, and it exists for a plain reason: Francesco tests
-- the button himself, and his own test messages should not sit in the work list
-- forever pretending to be the team.
--
-- So: `authenticated` only. anon can still INSERT (the whole point — the prep
-- screen has no login) and still cannot read or delete anything. A chef cannot
-- delete their own message, let alone anyone else's; only someone signed in to
-- the FOH app can, and the app asks them to confirm with the sender's name on
-- screen first.
--
-- There is deliberately no UPDATE policy: nobody edits what somebody wrote.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists app_feedback_inbox_delete on app_feedback_inbox;
create policy app_feedback_inbox_delete on app_feedback_inbox
  for delete to authenticated using (true);

-- app_feedback_work already allows authenticated ALL (foh-app-feedback-status.sql),
-- so removing the work row that belongs to a deleted message needs nothing here.

notify pgrst, 'reload schema';

-- After running: Admin → Feedback → Inbox → open a message → "Delete this
-- message". Until it has run, the button says exactly which file to run and the
-- message stays put — it never reports a delete that did not happen.
