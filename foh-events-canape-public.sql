-- Canapé packages on the guest link — run in Supabase project paoaivwtkzujmrgrfjuq (FOH).
-- Additive only, safe to run at any time, and safe to re-run.
--
-- WHY: Katarina (8 Aug 2026) asked to send canapé packages in the same message as
-- the set menus and beverage packages. The EMAIL needs nothing from this file — it
-- is built inside the app, where she is signed in. The WHATSAPP link does: the
-- guest page (client-menus.html) is opened by a stranger with no login, and
-- event_packages / event_dishes are both authenticated-only.
--
-- Until this runs, ticking a canapé package and sending by WhatsApp shows the guest
-- everything EXCEPT the canapés. The app says so on the screen rather than sending
-- a link that quietly leaves them out.

-- The guest-safe view, mirroring event_bev_public. Only what a guest may read:
-- the package name, the price per guest, and the canapés in it. The kitchen cost
-- on event_dishes never appears here.
CREATE OR REPLACE VIEW event_packages_public AS
  SELECT p.id,
         p.name,
         p.price_pp,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'name', d.name,
                    'description', d.description,
                    'allergens', d.allergens
                  ) ORDER BY u.ord)
           FROM unnest(p.dish_ids) WITH ORDINALITY AS u(did, ord)
           JOIN event_dishes d ON d.id = u.did AND d.active IS NOT FALSE
         ), '[]'::jsonb) AS dishes
  FROM event_packages p
  WHERE p.active IS NOT FALSE;

GRANT SELECT ON event_packages_public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- After running: Events → Menu packages → Set menus & beverage, tick a canapé
-- package and send by WhatsApp. The guest page then lists the package with every
-- canapé in it, beside the set menus and the beverage packages.
