-- =====================================================================
--  foh-events-fix-seed-twins.sql
--  Repairs the damage left by foh-events-seed-canape-2026.sql.
--
--  WHAT WENT WRONG
--    That seed decided whether a canapé already existed by matching its
--    NAME against a hardcoded pattern. Two of Danilo's canapés are named
--    differently, so the seed concluded they were missing and inserted
--    its own blank copies — no price, no cost, no menu line. Portici and
--    Salotto were then built pointing at those blanks. Separately, where
--    the seed DID match a dish it reused it and silently discarded the
--    allergens it was carrying — which is why "Crispy calamari" reads
--    "Allergens: none" and stopped Valentina's send.
--
--  WHAT THIS DOES
--    1. Repoints Portici + Salotto from each blank to Danilo's real dish.
--    2. Moves any event line item off the blank onto the real dish, so no
--       past event loses a canapé or its money.
--    3. Deletes the two blanks.
--    4. Sets the calamari's shellfish allergen.
--
--  WHAT THIS DELIBERATELY LEAVES ALONE
--    Three seed rows are NOT duplicates — they are real canapés Danilo
--    never entered, and both packages need them. They stay; Danilo adds
--    the price and the menu line in Chef Corner:
--       • Scallop tartelette, citrus dressing, crusco pepper
--       • Tuscan bruschetta, tomato, burrata and basil
--       • Selection of mini Italian desserts   (his own "Mini Italian
--         desserts" is paused on purpose, so this one stays as the dolci)
--
--  HOW TO RUN:  Supabase → SQL editor → paste → Run.
--    https://supabase.com/dashboard/project/paoaivwtkzujmrgrfjuq/sql/new
--  Watch the "Messages" tab for a line-by-line NOTICE summary.
--  Safe to run twice: the second run finds nothing and reports it.
--  If Danilo's dish can't be found the whole run raises and rolls back —
--  it will never leave a package pointing at a deleted canapé.
-- =====================================================================

-- ── 1-3. the two true duplicates ─────────────────────────────────────
do $$
declare
  v_udt  text;
  v_pair record;
  v_real uuid;
  v_n    int;
begin
  select udt_name into v_udt
    from information_schema.columns
   where table_schema = 'public' and table_name = 'event_packages' and column_name = 'dish_ids';
  raise notice 'event_packages.dish_ids type: %', v_udt;

  for v_pair in
    select * from (values
      ('5feaa24d-217a-4b05-97f4-6098a3e5a08c'::uuid, 'Slow-cooked beef short rib'),  -- blank: "...Italian glaze, mashed potato"
      ('2441a499-98e3-4278-b889-a067c2093771'::uuid, 'Tonno battuto')                -- blank: "Tuna tartare, Sicilian caponata, capers"
    ) t(blank_id, real_name)
  loop
    -- the blank may already be gone (second run) — then there is nothing to do
    if not exists (select 1 from event_dishes where id = v_pair.blank_id) then
      raise notice 'already fixed : blank % is gone — skipped', v_pair.blank_id;
      continue;
    end if;

    select id into v_real
      from event_dishes
     where name = v_pair.real_name
       and coalesce(created_by,'') <> 'canape-2026-seed'
     order by id
     limit 1;
    if v_real is null then
      raise exception 'Cannot find Danilo''s "%" — NOTHING changed, everything rolled back.', v_pair.real_name;
    end if;

    -- 1. repoint every package that holds the blank
    if v_udt in ('jsonb','json') then
      execute format(
        'update event_packages
            set dish_ids = (select jsonb_agg(case when e = %L::jsonb then %L::jsonb else e end)
                              from jsonb_array_elements(dish_ids::jsonb) e)
          where dish_ids::jsonb @> %L::jsonb',
        to_jsonb(v_pair.blank_id::text)::text,
        to_jsonb(v_real::text)::text,
        jsonb_build_array(v_pair.blank_id::text)::text);
    elsif v_udt = '_uuid' then
      execute format(
        'update event_packages set dish_ids = array_replace(dish_ids, %L::uuid, %L::uuid)
          where %L::uuid = any(dish_ids)', v_pair.blank_id, v_real, v_pair.blank_id);
    else
      execute format(
        'update event_packages set dish_ids = array_replace(dish_ids, %L, %L)
          where %L = any(dish_ids)', v_pair.blank_id::text, v_real::text, v_pair.blank_id::text);
    end if;
    get diagnostics v_n = row_count;
    raise notice 'repointed     : % package(s)  %  ->  %', v_n, v_pair.real_name, v_real;

    -- 2. carry any quoted line item across to the real dish, so the event
    --    keeps the canapé AND its price (the blank sells for nothing)
    update event_items set dish_id = v_real where dish_id::text = v_pair.blank_id::text;
    get diagnostics v_n = row_count;
    if v_n > 0 then raise notice '                also moved % event line item(s)', v_n; end if;

    -- 3. the blank is now unreferenced — remove it
    delete from event_dishes where id = v_pair.blank_id;
    raise notice '                deleted the blank copy';
  end loop;
end $$;

-- ── 4. the calamari the seed reused but never tagged ─────────────────
do $$
declare v_udt text; v_n int;
begin
  select udt_name into v_udt
    from information_schema.columns
   where table_schema = 'public' and table_name = 'event_dishes' and column_name = 'allergens';

  if v_udt in ('jsonb','json') then
    execute 'update event_dishes set allergens = ''["S"]''::jsonb, updated_at = now()
              where name ilike ''%crispy%calamari%'' and coalesce(jsonb_array_length(allergens::jsonb),0) = 0';
  else
    execute 'update event_dishes set allergens = ARRAY[''S'']::text[], updated_at = now()
              where name ilike ''%crispy%calamari%'' and coalesce(array_length(allergens,1),0) = 0';
  end if;
  get diagnostics v_n = row_count;
  raise notice 'calamari      : shellfish set on % row(s)%', v_n,
    case when v_n = 0 then ' (already had allergens — left alone)' else '' end;
end $$;

-- ── what's left for Danilo ───────────────────────────────────────────
--  These should come back with a price and a menu line once he's done.
select name, category, serve, allergens, cost, description
  from event_dishes
 where created_by = 'canape-2026-seed'
 order by category, name;
