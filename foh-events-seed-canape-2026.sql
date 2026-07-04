-- =====================================================================
--  foh-events-seed-canape-2026.sql
--  Adds the two missing 2026 canapé packages to the Events module:
--     • Canapé Portici — AED 170/guest
--     • Canapé Salotto — AED 295/guest
--  Canapé Cortile (AED 230) already exists and is LEFT UNTOUCHED.
--
--  HOW TO RUN:  Supabase → SQL editor → paste → Run.  (Leadership Hub
--  project.)  Safe to run more than once — it is idempotent:
--    - a dish is REUSED if one already matches (so no duplicates of the
--      dishes Cortile already introduced: focaccia, sea bass tart,
--      roasted shrimp, mini desserts, mini pizza);
--    - a dish is CREATED only if nothing matches;
--    - a package is SKIPPED if a package of that name already exists;
--    - if any dish can't be resolved the whole run rolls back (no blanks).
--
--  It auto-detects whether allergens / dish_ids are text[], uuid[] or
--  jsonb, so it works regardless of how those columns were defined.
--  Watch the "Messages" tab for a per-item NOTICE summary.
-- =====================================================================

-- ── helper: find-or-create a dish, return its id ─────────────────────
create or replace function pg_temp.ensure_dish(
  p_pattern    text,        -- ILIKE used to REUSE an existing dish
  p_exclude    text,        -- ILIKE that must NOT match (or null)
  p_name       text,
  p_category   text,        -- Vegetarian | Fish | Beef | Chicken | Dessert
  p_serve      text,        -- Cold | Hot | Dessert
  p_allergens  text[]       -- codes: D E H N R S V
) returns uuid
language plpgsql as $fn$
declare
  v_id   uuid;
  v_udt  text;
  v_alit text;
begin
  -- reuse an existing active dish if one matches
  select id into v_id
    from event_dishes
   where active is not false
     and name ilike p_pattern
     and (p_exclude is null or name not ilike p_exclude)
   order by name
   limit 1;
  if v_id is not null then
    raise notice 'dish reused  : %  ->  %', p_name, v_id;
    return v_id;
  end if;

  -- otherwise create it, matching the allergens column type
  select udt_name into v_udt
    from information_schema.columns
   where table_schema = 'public' and table_name = 'event_dishes' and column_name = 'allergens';

  if v_udt in ('jsonb','json') then
    v_alit := quote_literal(to_jsonb(p_allergens)::text) || '::' || v_udt;
  else
    v_alit := 'ARRAY[' ||
      coalesce((select string_agg(quote_literal(x), ',') from unnest(p_allergens) x), '') ||
      ']::text[]';
  end if;

  execute format(
    'insert into event_dishes (name, category, serve, allergens, min_order, active, created_by, updated_at)
       values (%L, %L, %L, %s, 10, true, %L, now()) returning id',
    p_name, p_category, p_serve, v_alit, 'canape-2026-seed'
  ) into v_id;

  raise notice 'dish created : %  ->  %', p_name, v_id;
  return v_id;
end $fn$;

-- ── helper: create a package (skip if the name already exists) ───────
create or replace function pg_temp.ensure_pack(
  p_name     text,
  p_price    numeric,
  p_dish_ids uuid[]
) returns void
language plpgsql as $fn$
declare
  v_udt text;
  v_lit text;
  v_ex  uuid;
begin
  select id into v_ex from event_packages where name ilike p_name limit 1;
  if v_ex is not null then
    raise notice 'package kept  : "%" already exists — skipped', p_name;
    return;
  end if;

  select udt_name into v_udt
    from information_schema.columns
   where table_schema = 'public' and table_name = 'event_packages' and column_name = 'dish_ids';

  if v_udt in ('jsonb','json') then
    v_lit := quote_literal(to_jsonb(p_dish_ids)::text) || '::' || v_udt;
  elsif v_udt = '_uuid' then
    v_lit := 'ARRAY[' ||
      coalesce((select string_agg(quote_literal(x::text), ',') from unnest(p_dish_ids) x), '') ||
      ']::uuid[]';
  else
    v_lit := 'ARRAY[' ||
      coalesce((select string_agg(quote_literal(x::text), ',') from unnest(p_dish_ids) x), '') ||
      ']::text[]';
  end if;

  execute format(
    'insert into event_packages (name, price_pp, dish_ids) values (%L, %s, %s)',
    p_name, p_price, v_lit
  );
  raise notice 'package made  : "%" (AED %/guest, % dishes)', p_name, p_price, array_length(p_dish_ids, 1);
end $fn$;

-- ── build the two packages ───────────────────────────────────────────
do $$
declare
  -- shared with Cortile (reused if present, else created once)
  d_focaccia   uuid;
  d_seabass    uuid;
  d_shrimp     uuid;
  d_desserts   uuid;
  d_minipizza  uuid;
  -- new for these two menus
  d_brusch     uuid;   -- plain Tuscan bruschetta (Portici)
  d_brusch_bur uuid;   -- burrata Tuscan bruschetta (Salotto)
  d_arancini   uuid;
  d_shortrib   uuid;   -- Italian-glaze short rib (Portici + Salotto)
  d_tuna       uuid;
  d_scallop    uuid;
  d_ravioli    uuid;
  d_calamari   uuid;
  d_margherita uuid;
begin
  -- shared dishes (Cortile already has these — reused, not duplicated)
  d_focaccia  := pg_temp.ensure_dish('%focaccia%bresaola%', null, 'Focaccia, mushroom and bresaola', 'Beef', 'Cold', array['D','E']);
  d_seabass   := pg_temp.ensure_dish('%bass tart%',         null, 'Sea bass tart, lemon gel, basil', 'Fish', 'Cold', array['E','R']);
  d_shrimp    := pg_temp.ensure_dish('%roasted shrimp%',    null, 'Roasted shrimp, light arrabbiata', 'Fish', 'Hot', array['S']);
  d_desserts  := pg_temp.ensure_dish('%mini italian dessert%', null, 'Selection of mini Italian desserts', 'Dessert', 'Dessert', array['D','E','N']);
  d_minipizza := pg_temp.ensure_dish('%mini pizza%',        null, 'Mini pizza Roberto''s', 'Vegetarian', 'Cold', array['D','R']);

  -- new dishes
  d_brusch     := pg_temp.ensure_dish('%tuscan bruschetta%', '%burrata%', 'Tuscan bruschetta, tomato and basil', 'Vegetarian', 'Cold', array['V']);
  d_brusch_bur := pg_temp.ensure_dish('%bruschetta%burrata%', null, 'Tuscan bruschetta, tomato, burrata and basil', 'Vegetarian', 'Cold', array['D','V']);
  d_arancini   := pg_temp.ensure_dish('%saffron arancini%', null, 'Saffron arancini, green peas', 'Vegetarian', 'Hot', array['D','E','V']);
  d_shortrib   := pg_temp.ensure_dish('%beef short rib%italian%', null, 'Slow-cooked beef short rib, Italian glaze, mashed potato', 'Beef', 'Hot', array['D']);
  d_tuna       := pg_temp.ensure_dish('%tuna tartare%', null, 'Tuna tartare, Sicilian caponata, capers', 'Fish', 'Cold', array['N','R']);
  d_scallop    := pg_temp.ensure_dish('%scallop tart%', null, 'Scallop tartelette, citrus dressing, crusco pepper', 'Fish', 'Hot', array['R','S']);
  d_ravioli    := pg_temp.ensure_dish('%ravioli%genovese%', null, 'Ravioli, Genovese stuffing, Grana Padano fondue, balsamic', 'Vegetarian', 'Hot', array['D','E','H']);
  d_calamari   := pg_temp.ensure_dish('%crispy%calamari%', null, 'Crispy fried calamari, Mediterranean herbs', 'Fish', 'Hot', array['S']);
  d_margherita := pg_temp.ensure_dish('%margherita%', null, 'Margherita pizza', 'Vegetarian', 'Hot', array['D','V']);

  -- Canapé Portici — AED 170/guest
  perform pg_temp.ensure_pack('Canapé Portici', 170, array[
    d_brusch, d_focaccia, d_seabass, d_arancini, d_shrimp, d_shortrib, d_desserts
  ]);

  -- Canapé Salotto — AED 295/guest
  perform pg_temp.ensure_pack('Canapé Salotto', 295, array[
    d_minipizza, d_brusch_bur, d_tuna, d_focaccia, d_arancini, d_scallop,
    d_ravioli, d_calamari, d_shortrib, d_margherita, d_desserts
  ]);

  raise notice 'Done. Reload the Events module → Menu packages → Canapé packages to see them.';
end $$;

-- Make PostgREST pick up any new rows immediately.
notify pgrst, 'reload schema';
