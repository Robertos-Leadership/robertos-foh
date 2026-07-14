-- ════════════════════════════════════════════════════════════
-- Kitchen cost per guest on set menus (chef enters it in Chef Corner →
-- Set menus). Feeds the food-cost % check on set-menu events, measured
-- against the agreed price so discounts show honestly. Never guest-facing.
-- Run once in the FOH Supabase project (paoaivwtkzujmrgrfjuq).
-- ════════════════════════════════════════════════════════════
alter table event_set_menus add column if not exists cost_pp numeric;
