-- ════════════════════════════════════════════════════════════
-- Storage bucket for the chefs' uploaded set-menu PDFs.
-- Chef Corner → Set menus → "upload the menu PDF" stores the file here and
-- the guest email gets its "View the full menu" button. Public read (guests
-- open the menu from an email link); only logged-in app users can upload.
-- Run once in the FOH Supabase project (paoaivwtkzujmrgrfjuq).
-- ════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('event-menus', 'event-menus', true)
on conflict (id) do nothing;

drop policy if exists event_menus_upload on storage.objects;
create policy event_menus_upload on storage.objects
  for insert to authenticated with check (bucket_id = 'event-menus');

drop policy if exists event_menus_replace on storage.objects;
create policy event_menus_replace on storage.objects
  for update to authenticated using (bucket_id = 'event-menus') with check (bucket_id = 'event-menus');

drop policy if exists event_menus_read on storage.objects;
create policy event_menus_read on storage.objects
  for select to public using (bucket_id = 'event-menus');
