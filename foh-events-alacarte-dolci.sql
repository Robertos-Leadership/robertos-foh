-- ============================================================
-- event_alacarte -- DOLCI. The dessert menu, so a customised menu can change
-- the dolci course with a real dish at a real price.
--
-- Why this matters: Valentina's first real customised menu (30 Jul 2026,
-- "Mare set menu") changed the dolci and, with no desserts in the app, she had
-- to type it by hand -- as "Pistacho Tiramisu". Unpriced and misspelt, heading
-- for a guest proposal. The correct dish is "Tiramisu al Pistacchio", AED 60.
--
-- Source of truth: "Roberto's_Dessert_Menu_Apr 2026_2.pdf" (April 2026).
-- Every price reconciled against the Simphony export
-- "260513-Ala Carte Menu Price Review.xlsx": 6 of 6 matched exactly, 0
-- conflicts --
--   Torta al Limone        40  = POS Lemon Tart       40
--   Fior di Fragola        50  = POS Fior Fragola     50
--   Choc-choc              50  = POS Choc-Choc        50
--   Benvenuti al Nord      50  = POS Benvenuti Nord   50
--   Tiramisu al Pistacchio 60  = POS Pista Tiramisu   60
--   Gelato Verde Oro      130  = POS Gelato Verdeoro 130
--
-- NOTE the new allergen code on this menu: A = Alcohol (Benvenuti al Nord
-- carries a Negroni bagna). It is not on the food menu's legend, and it is the
-- one a guest is most likely to need to avoid here.
--
-- The POS carries nine further dessert lines that are NOT on this printed menu
-- (Torrone, Frutta Sorbetto, Tiramisu, Bombolone, Maritozzo, Torta Nonna, and
-- the three 0.5kg whole cakes). They are deliberately not seeded: the printed
-- menu is what a guest may choose from. Add them if that changes.
--
-- Run once in the FOH Supabase project (paoaivwtkzujmrgrfjuq).
-- ============================================================
insert into event_alacarte
  (pos_code, section, sub, name, description, price_note, price, unit, tiers,
   market_price, allergens, course, sort_order) values
  ('15554', 'DOLCI', null, 'Torta al Limone',
   'Lemon meringue tarte', null, 40, 'per portion', null, false,
   array['D','E','N']::text[], 'dolci', 500),
  ('15504', 'DOLCI', null, 'Fior di Fragola',
   'Philo pastry tarte, goat cheese ice cream, strawberry and strawberry jus', null, 50, 'per portion', null, false,
   array['D','E','N']::text[], 'dolci', 510),
  ('15502', 'DOLCI', null, 'Choc-choc',
   'Gianduja ganache, cocoa sorbet, warm chocolate foam', null, 50, 'per portion', null, false,
   array['D','E','N']::text[], 'dolci', 520),
  ('15505', 'DOLCI', null, 'Benvenuti al Nord',
   'Baba sponge, Negroni bagna, mandarin and creme brulee',
   'Contains alcohol (Negroni bagna) -- check before offering it', 50, 'per portion', null, false,
   array['A','D','E','N']::text[], 'dolci', 530),
  ('15557', 'DOLCI', null, 'Tiramisu al Pistacchio',
   'Pistachio-flavoured tiramisu', null, 60, 'per portion', null, false,
   array['D','E','N']::text[], 'dolci', 540),
  ('15506', 'DOLCI', null, 'Gelato Verde Oro',
   '500g pistachio ice cream, extra virgin olive oil. The pistachio gelato is churned fresh in our kitchen, made the moment you ask for it, and finished with Lorenzo No. 5 extra virgin olive oil.',
   'Sold as a 500g dish to share, not a single portion', 130, 'per portion', null, false,
   array['D','E','N']::text[], 'dolci', 550)
on conflict (name, section) do nothing;
