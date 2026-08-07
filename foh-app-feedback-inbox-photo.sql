-- ═══════════════════════════════════════════════════════════════════════════
-- foh-app-feedback-inbox-photo.sql  —  let a message carry a photo.
-- Runs AFTER foh-app-feedback-inbox.sql. Additive and safe to re-run.
--
-- FOH Supabase project: paoaivwtkzujmrgrfjuq
--
-- "The button doesn't work" plus a picture of the screen is a fix. Without it,
-- it is a conversation — and the person who has to have that conversation is
-- mid-service.
--
-- ── The bucket is PRIVATE, and that is the whole design ────────────────────
-- Anyone may PUT into it (the prep screen has no login and never will), but
-- nobody may read it back — not even with the key that is sitting in the page.
-- The admin screen reaches an image only through a short-lived signed URL that
-- its signed-in session mints. So a photo of a roster, a guest name on a
-- reservation screen, or someone's payslip cannot be fetched by guessing a URL.
--
-- The 5MB cap is a backstop, not the plan: the apps shrink a photo to roughly
-- 300KB on the device before it is sent, because a 4MB upload on the venue wifi
-- mid-service is a send that appears to hang, and a button that appears to hang
-- is a button nobody presses twice.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Where the photo lives on the message ────────────────────────────────
-- The object PATH, not a URL: a URL would go stale the moment the bucket or the
-- project moved, and a signed one expires by design.
alter table app_feedback_inbox add column if not exists shot text;

-- ── 2. The bucket ──────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-shots', 'feedback-shots', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,                                  -- never flips public by accident
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- ── 3. Who may do what ─────────────────────────────────────────────────────
-- Exactly the shape of the table itself: anyone may add, only signed-in may
-- look, only signed-in may remove. There is deliberately no UPDATE — an
-- uploaded photo is never overwritten in place.
drop policy if exists feedback_shots_insert on storage.objects;
create policy feedback_shots_insert on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'feedback-shots');

drop policy if exists feedback_shots_read on storage.objects;
create policy feedback_shots_read on storage.objects
  for select to authenticated
  using (bucket_id = 'feedback-shots');

-- Deleting a message deletes its photo too — otherwise the image outlives the
-- words it belonged to, in a bucket nobody ever looks in.
drop policy if exists feedback_shots_delete on storage.objects;
create policy feedback_shots_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'feedback-shots');

notify pgrst, 'reload schema';

-- After running: "Add a photo" appears in the Tell us sheet in both apps, and
-- the picture shows under their words in Admin → Feedback → Inbox.
