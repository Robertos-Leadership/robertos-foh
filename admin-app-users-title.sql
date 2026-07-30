-- ════════════════════════════════════════════════════════════════════════
--  JOB TITLE for office logins — app_users.title
--  Project: FOH Supabase (paoaivwtkzujmrgrfjuq). Run in the SQL Editor.
--
--  People who have a login but no Kitchen/FOH staff record (office / HQ) had
--  nowhere to store a job title, so the People panel just printed the generic
--  "Office / HQ". This adds the field the Admin screen writes to.
--
--  Nothing else changes: staff keep their titles in foh_staff.role /
--  staff.designation as before. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

alter table app_users add column if not exists title text;

-- Seed the office logins we already know
update app_users set title = 'General Manager'    where email = 'onafid@robertos.ae'  and title is null;
update app_users set title = 'Cost Controller'    where email = 'ahtwe@robertos.ae'   and title is null;

notify pgrst, 'reload schema';
