-- ════════════════════════════════════════════════════════════════════════
--  Seed the CURRENT closing-report recipients into app_users so they keep
--  getting the email once it's driven by the ticks. External directors get a
--  notification-only row (no modules = they can't log in; they just receive it).
--  Project paoaivwtkzujmrgrfjuq. Safe to re-run (merges the notify flag, never
--  removes existing access).
-- ════════════════════════════════════════════════════════════════════════
insert into app_users (email, name, modules, notify) values
  ('fguarracino@robertos.ae','Francesco Guarracino','{}','{closing_report}'),
  ('asacchi@skelmore.com',  'A. Sacchi (Director)', '{}','{closing_report}'),
  ('justin@skelmore.com',   'Justin (Director)',    '{}','{closing_report}'),
  ('musti@robertos.ae',     'Musti',                '{}','{closing_report}'),
  ('umavila@skelmore.com',  'U. Mavila (Director)', '{}','{closing_report}'),
  ('kvukotic@robertos.ae',  'K. Vukotic',           '{}','{closing_report}'),
  ('mpetrosino@robertos.ae','Manuel Petrosino',     '{}','{closing_report}'),
  ('vdetoni@robertos.ae',   'V. De Toni',           '{}','{closing_report}'),
  ('dvalla@robertos.ae',    'D. Valla',             '{}','{closing_report}'),
  ('jthomas@robertos.ae',   'J. Thomas',            '{}','{closing_report}')
on conflict (email) do update
  set notify = (select array(select distinct e from unnest(app_users.notify || excluded.notify) e));

notify pgrst, 'reload schema';
