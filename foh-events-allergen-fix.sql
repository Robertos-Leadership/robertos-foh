-- =====================================================================
--  Allergen corrections -- Private Events set menus
--  Drafted 30 Jul 2026.  Paste into the Supabase SQL editor and run.
--
--  Francesco's decisions (30 Jul):
--    Tonno Battuto        -> D, E, N, R   (egg AND dairy)
--    Branzino oven-baked  -> D, N         (the pinenuts count)
--    Vitello Tonnato      -> D, E         (it is veal: drop the (V))
--    (H) "homemade"       -> strip, it is not an allergen
--
--  Set-menu allergens live as prose inside the courses JSON, so these are
--  string replacements on that JSON, each anchored to the full description
--  so it cannot hit the wrong dish.
--
--  Every needle below was dry-run first. Expected match counts:
--     Tonno (D)(N)(R) ....... 3 menus  (mare, fuoco-set-menu-bgfg,
--                                       custom-fuoco-set-menu-bgfg-khbzkq)
--     Tonno, no allergens ... 1 menu   (netflix-event-food-menu-npqd)
--     Branzino (R)(S) ....... 2 menus  (mare, terra)
--     Branzino, none ........ 1 menu   (netflix-event-food-menu-npqd)
--     Vitello (D)(V) ........ 1 menu   (sharing-experience)
--     (H) ................... 6 menus
--
--  NOT INCLUDED -- restaurant-week and restaurant-week-sharing.
--  In those two, "Branzino" and "Branzino Carpaccio" share a byte-identical
--  description, so a text replace cannot change one without the other.
--  That pair needs the carpaccio copy-paste bug settled first.
--
--  Runs in ONE transaction. The SELECT at the bottom runs BEFORE the
--  commit -- read it, then COMMIT or ROLLBACK.
-- =====================================================================

begin;

-- --- 1. Tonno Battuto: add the missing egg -----------------------------
update event_set_menus
   set courses = replace(
         courses::text,
         'Yellowfin tuna tartare, Sicilian caponata and almond (D)(N)(R)',
         'Yellowfin tuna tartare, Sicilian caponata and almond (D)(E)(N)(R)'
       )::jsonb
 where active
   and key in ('mare','fuoco-set-menu-bgfg','custom-fuoco-set-menu-bgfg-khbzkq');

-- The Netflix menu carries no allergens on this dish at all.
-- The trailing quote anchors this to the description that ENDS here,
-- so it cannot also match the three menus updated above.
update event_set_menus
   set courses = replace(
         courses::text,
         'Yellowfin tuna tartare, Sicilian caponata and almond"',
         'Yellowfin tuna tartare, Sicilian caponata and almond (D)(E)(N)(R)"'
       )::jsonb
 where active and key = 'netflix-event-food-menu-npqd';

-- --- 2. Branzino, oven-baked "cartoccio" -------------------------------
-- mare + terra said (R)(S): raw and shellfish. It is neither, and it was
-- missing the dairy that is actually in the lemon butter sauce.
update event_set_menus
   set courses = replace(
         courses::text,
         'Oven-baked seabass in “cartoccio style’’ (R)(S)',
         'Oven-baked seabass in “cartoccio style’’ (D)(N)'
       )::jsonb
 where active and key in ('mare','terra');

update event_set_menus
   set courses = replace(
         courses::text,
         'Oven-baked seabass in cartoccio style"',
         'Oven-baked seabass in cartoccio style (D)(N)"'
       )::jsonb
 where active and key = 'netflix-event-food-menu-npqd';

-- The a la carte row is missing the nuts its own description names.
update event_alacarte
   set allergens = '{D,N}'
 where active
   and name = 'Branzino'
   and description like '%pinenuts%';

-- --- 3. Vitello Tonnato: it is veal, not vegetarian --------------------
update event_set_menus
   set courses = replace(
         courses::text,
         'famous “tonnata sauce”, celery (D)(V)',
         'famous “tonnata sauce”, celery (D)(E)'
       )::jsonb
 where active and key = 'sharing-experience';

-- --- 4. Strip (H) "homemade" -- not an allergen ------------------------
update event_set_menus
   set courses = replace(courses::text, '(H)', '')::jsonb
 where active and courses::text like '%(H)%';

-- --- 5. Read this before committing ------------------------------------
-- Expect: every Tonno Battuto (D)(E)(N)(R); mare/terra/netflix Branzino
-- (D)(N); Vitello Tonnato (D)(E); no (H) anywhere.
select m.key, d.key as dish, d.value as description
  from event_set_menus m,
       lateral jsonb_array_elements(m.courses) c,
       lateral jsonb_each_text(coalesce(c->'desc','{}'::jsonb)) d
 where m.active
   and (d.key ilike '%tonno%' or d.key ilike '%branzino%' or d.key ilike '%vitello%')
 order by m.key, d.key;

select name, allergens::text, description
  from event_alacarte
 where active and name like 'Branzino%';

-- COMMIT;    -- <-- uncomment once the rows above read correctly
-- ROLLBACK;  -- <-- otherwise this, and nothing changes
