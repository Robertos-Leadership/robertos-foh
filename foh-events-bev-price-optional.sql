-- Make the beverage per-guest price OPTIONAL — run in Supabase project
-- paoaivwtkzujmrgrfjuq (FOH). Additive/safe, no downtime.
--
-- A minimum-spend / confidential package carries no per-guest price: the money
-- lives on the proposal's minimum spend, so the package just names what's poured.
-- Until this runs, price_pp is NOT NULL and a price-free package cannot be saved.

ALTER TABLE event_bev_packages
  ALTER COLUMN price_pp DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
