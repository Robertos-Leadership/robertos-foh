-- ============================================================
-- event_alacarte -- Roberto's a la carte, inside the app.
--
-- Source of truth: "Roberto's_Alacarte_Menu_Jun2026 (1).pdf" (the June 2026
-- guest menu). Every price below was reconciled dish-by-dish against the
-- Simphony export "260513-Ala Carte Menu Price Review.xlsx": 46 of 49 matched
-- the POS "New S.Price" column exactly, 0 conflicts. The three with no POS row
-- carry the reason in price_note, so the app can say why instead of showing a
-- silently blank price.
--
--   price        NULL + market_price true  = "Market price" on the menu
--   tiers jsonb  [{"size":"30g","price":750}, ...] -- caviar, sold by weight
--   course       which course of a plated menu this dish can fill, so the
--                Customise-menu builder only ever offers a sane swap
--   pos_code     Simphony menu-item code, so a later costing pass joins onto
--                the POS by code instead of guessing at names
--
-- Run once in the FOH Supabase project (paoaivwtkzujmrgrfjuq).
-- ============================================================
create extension if not exists pgcrypto;

create table if not exists event_alacarte (
  id           uuid primary key default gen_random_uuid(),
  pos_code     text,
  section      text not null,
  sub          text,
  name         text not null,
  description  text,
  price_note   text,
  price        numeric,
  unit         text not null default 'per portion',
  tiers        jsonb,
  market_price boolean not null default false,
  allergens    text[],
  course       text,
  sort_order   integer not null default 999,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists event_alacarte_name_section
  on event_alacarte (name, section);

alter table event_alacarte enable row level security;
drop policy if exists event_alacarte_all on event_alacarte;
create policy event_alacarte_all on event_alacarte for all using (true) with check (true);

-- The June 2026 menu, in the printed order and the order Valentina reads it:
-- Crudo Bar -> Roberto's Selection -> Insalate -> Antipasti -> Pizze ->
-- Paste e Riso -> Secondi di Pesce -> La via del Sale -> Dal Banco ->
-- Secondi di Carne -> Dalla nostra Griglia Josper -> Contorni Caldi.
-- on conflict do nothing, so a re-run never clobbers a price edited in the app.
insert into event_alacarte
  (pos_code, section, sub, name, description, price_note, price, unit, tiers,
   market_price, allergens, course, sort_order) values
  ('10002', 'CRUDO BAR', 'FROLLATO', 'Ricciola', 'Yellow tail carpaccio, purple cabbage dressing, dill oil', null, 98, 'per portion', null, false, array['R','S']::text[], 'antipasti', 10),
  ('10005', 'CRUDO BAR', 'NATURALE', 'Tonno', 'Yellowfin tuna tartare, Sicilian caponata, Pantelleria capers emulsion', null, 98, 'per portion', null, false, array['E','N','R']::text[], 'antipasti', 20),
  ('10012', 'CRUDO BAR', 'CARNE', 'Vitello Tonnato', 'Thin slice of Italian veal eye round, famous “tonnata sauce”, celery', null, 98, 'per portion', null, false, array['D','E']::text[], 'antipasti', 30),
  ('10007', 'CRUDO BAR', 'NATURALE', 'Branzino', 'Sea bass carpaccio, Amalfi lemon, artichokes salad', null, 115, 'per portion', null, false, array['R']::text[], 'antipasti', 40),
  ('10011', 'CRUDO BAR', 'CARNE', 'Manzo Carpaccio', 'Angus beef carpaccio, porcini emulsion, lamb lettuce, pecorino cheese', null, 125, 'per portion', null, false, array['D','E','R']::text[], 'antipasti', 50),
  ('10006', 'CRUDO BAR', 'NATURALE', 'Capesante', 'Scallop carpaccio, citrus dressing, crusco capsicum', null, 130, 'per portion', null, false, array['R','S']::text[], 'antipasti', 60),
  ('10301', 'ROBERTO’S SELECTION', 'CALVISIUS', 'Beluga', 'Beluga caviar comes from the Russian sturgeon and can grow to be as long as 8m and weigh more than three tons. Originally native from Black Sea it is the rarest and more costly; characterized by large eggs which tend to be oval-shaped and have a pearl-grey to dark-gray coloring.', null, null, 'by weight', '[{"size": "30g", "price": 1650}, {"size": "50g", "price": 2750}]'::jsonb, false, null, 'extra', 70),
  ('10303', 'ROBERTO’S SELECTION', 'ARS ITALICA', 'Oscietra', 'Oscietra caviar comes from the Russian sturgeon, and it is a medium size fish that can weigh over 60kg of eggs. Typical of this caviar is the persistent and delicious sea notes.', null, null, 'by weight', '[{"size": "30g", "price": 750}, {"size": "50g", "price": 1150}]'::jsonb, false, null, 'extra', 80),
  ('10010', 'ROBERTO’S SELECTION', 'OSTRICHE', 'Gillardeau, France', 'This meaty oyster has an aromatic finesse and enduring nutty flavor that lingers on the palate.', null, 60, 'per piece', null, false, null, 'extra', 90),
  ('10602', 'INSALATE', null, '4 Semi', 'Baby spinach, clementines, peanuts, iceberg, mixed seeds, agave dressing', null, 85, 'per portion', null, false, array['N','V']::text[], 'antipasti', 100),
  ('10601', 'INSALATE', null, 'Pomodori', 'Roberto''s tomatoes selection, pappa al pomodoro and olive oil dressing', null, 85, 'per portion', null, false, array['V']::text[], 'antipasti', 110),
  ('10603', 'INSALATE', null, 'Finocchi, Caco e Caprino', 'Fennel, goat cheese, persimmon, beetroot dressing', null, 90, 'per portion', null, false, array['D','N','V']::text[], 'antipasti', 120),
  ('10604', 'INSALATE', null, 'Carciofi', 'Artichokes, grana padano cheese, pine nuts dressing', null, 105, 'per portion', null, false, array['D','N','V']::text[], 'antipasti', 130),
  ('10801', 'ANTIPASTI', null, 'Fritto', 'Golden fried calamari and prawns, scapece emulsion', null, 98, 'per portion', null, false, array['E','S']::text[], 'antipasti', 140),
  ('10803', 'ANTIPASTI', null, 'Melanzane Come Una Sorrentina', 'Gratin tomato eggplant, buffalo mozzarella, basil', null, 98, 'per portion', null, false, array['D','V']::text[], 'antipasti', 150),
  ('10802', 'ANTIPASTI', null, 'Burrata Pugliese', 'Roberto''s tomatoes selection, Apulian burrata, extra virgin olive oil', null, 120, 'per portion', null, false, array['D','V']::text[], 'antipasti', 160),
  ('10806', 'ANTIPASTI', null, 'Polpo', 'Slow-roasted octopus, artichoke, cacio e pepe sauce', null, 165, 'per portion', null, false, array['D','S']::text[], 'antipasti', 170),
  ('11001', 'PIZZE', null, 'Pizza Margherita', 'Tomato sauce, buffalo mozzarella and basil', null, 85, 'per portion', null, false, array['D','V']::text[], 'extra', 180),
  ('11003', 'PIZZE', null, 'Musti', 'Crispy dough base topped with burrata cheese, datterini tomatoes and wild rocket', null, 130, 'per portion', null, false, array['D','V']::text[], 'extra', 190),
  ('11002', 'PIZZE', null, 'Roberto’s', 'Crispy dough base topped with beef carpaccio, wild rocket, grana padano shavings, black truffle brunoise', null, 145, 'per portion', null, false, array['D','R']::text[], 'extra', 200),
  ('11004', 'PIZZE', null, 'Pizza Bianca', 'Fior di latte, scamorza cheese, morel mushroom sauce, fresh black truffle', null, 180, 'per portion', null, false, array['D','V']::text[], 'extra', 210),
  ('11208', 'PASTE E RISO', null, 'Ragu Bianco', 'Fusilloni pasta, white veal ragu, provola sauce, truffle', null, 105, 'per portion', null, false, array['D']::text[], 'pasta', 220),
  ('11202', 'PASTE E RISO', null, 'Calamarata al Pomod’orato e Basilico', 'Mancini calamarata pasta in rich tomato sauce and golden basil', null, 115, 'per portion', null, false, array['D','V']::text[], 'pasta', 230),
  ('11209', 'PASTE E RISO', null, 'Gnocco all ‘nduja, Peperone Dolce e Burrata', 'Homemade gnocco with beef nduja, Italian sweet capsicum and burrata', null, 115, 'per portion', null, false, array['D','E','H']::text[], 'pasta', 240),
  ('11207', 'PASTE E RISO', null, 'Ravioli alla Genovese su Fonduta di Provolone del Monaco', 'Homemade ravioli pasta, Genovese stuffing, Provolone del Monaco fondue, balsamic vinegar', null, 120, 'per portion', null, false, array['D','E','H']::text[], 'pasta', 250),
  ('11205', 'PASTE E RISO', null, 'Tortello al Tartufo', 'Homemade tortelli pasta filled with ricotta and spinach, truffle cream sauce', null, 130, 'per portion', null, false, array['D','E','H','V']::text[], 'pasta', 260),
  ('11401', 'PASTE E RISO', null, 'Il Bosco', 'Wild forest and portobello mushroom risotto, anis powder and shaved black truffle', null, 140, 'per portion', null, false, array['D','V']::text[], 'pasta', 270),
  ('11204', 'PASTE E RISO', null, 'Spaghetto Cacio e Pepe Limonato, Cacciucco e Scampi', 'Spaghetto pasta, citrus cacio e pepe sauce, cacciucco sauce, marinated langoustine and lime', null, 195, 'per portion', null, false, array['D','S']::text[], 'pasta', 280),
  ('11206', 'PASTE E RISO', null, 'Fettuccina Roberto’s', 'Fresh lobster, homemade fettuccina pasta with asparagus', null, 225, 'per portion', null, false, array['D','E','H','S']::text[], 'pasta', 290),
  ('11502', 'SECONDI DI PESCE', null, 'Moro Oceanico', 'Toothfish, Italian glaze, charred Romanesco broccoli cream and red capsicum sauce', null, 215, 'per portion', null, false, array['D','N']::text[], 'secondi', 300),
  ('11503', 'SECONDI DI PESCE', null, 'Branzino', 'Oven baked wild seabass in “ cartoccio” style with spinach, pinenuts and lemon butter sauce', null, 220, 'per portion', null, false, array['D']::text[], 'secondi', 310),
  (null, 'LA VIA DEL SALE', null, 'Spigola al Sale Affumicato e Limone', 'Oven-baked wild sea bass in charcoal sea salt crust and lemon leaf', 'Market price — confirm with the kitchen before quoting', null, 'per portion', null, true, null, 'secondi', 320),
  ('11507', 'LA VIA DEL SALE', null, 'Rombo sul Sale Aromatico, Asparagi e Salsa Ristretta alla Mediterranea', 'Mediterranean turbot loin, aromatic salt, asparagus, Mediterranean sauce', null, 285, 'per portion', null, false, array['D']::text[], 'secondi', 330),
  ('11506', 'LA VIA DEL SALE', null, 'Orata in Pasta di Sale e Erbe Aromatiche', 'Baked sea bream in aromatic herbs and salt dough, dill lemon butter sauce', null, 320, 'per portion', null, false, array['D','E']::text[], 'secondi', 340),
  ('11504', 'LA VIA DEL SALE', null, 'Branzino all’Amo in Sale di Santa Margherita', 'Oven-baked sea bass in Apulian Santa Margherita sea salt crust', '(recommended for 2 persons; please allow 30+ minutes)', 410, 'per portion', null, false, null, 'secondi', 350),
  (null, 'DAL BANCO', null, 'Carabineros', 'Grilled jumbo king red prawns', 'Market price — POS carries Carabinero at AED 210 per piece', null, 'per portion', null, true, array['S']::text[], 'secondi', 360),
  ('11508', 'DAL BANCO', null, 'Astice alla Griglia', 'Chargrilled Canadian lobster, marinated charcoal broccolini', '(please allow 25+ minutes)', 540, 'per portion', null, false, array['S']::text[], 'secondi', 370),
  ('11803', 'SECONDI DI CARNE', null, 'Polletto', 'Spatchcock chicken “under a brick”, Italian marination, potato gateaux', null, 180, 'per portion', null, false, array['D','E']::text[], 'secondi', 380),
  ('11801', 'SECONDI DI CARNE', null, 'Stinco d’Agnello', 'Slow cooked lamb shank, pink pepper, roasted potato', null, 210, 'per portion', null, false, array['D']::text[], 'secondi', 390),
  (null, 'SECONDI DI CARNE', null, 'Costoletta d’Agnello', 'Grilled lamb chop, crispy baked potato millefeuille, artichokes', 'Menu AED 220; the POS carries one lamb row (Agnello, AED 210) — confirm', 220, 'per portion', null, false, array['D']::text[], 'secondi', 400),
  ('11805', 'SECONDI DI CARNE', null, 'Filetto di Wagyu', 'Grilled wagyu tenderloin, MB 6/7, mushroom and cauliflower steak, tropea onion compote', null, 425, 'per portion', null, false, array['D','N']::text[], 'secondi', 410),
  ('12004', 'DALLA NOSTRA GRIGLIA JOSPER', null, 'Bavetta (300g)', 'Stanbroke wagyu flank steak, MB 4/5', null, 220, 'per portion', null, false, null, 'secondi', 420),
  ('12002', 'DALLA NOSTRA GRIGLIA JOSPER', null, 'Costata di Angus (300g)', 'Stanbroke angus ribeye, MB2', null, 255, 'per portion', null, false, null, 'secondi', 430),
  ('12003', 'DALLA NOSTRA GRIGLIA JOSPER', null, 'Costata di Wagyu (300g)', 'Wagyu “Mayura” ribeye, MB8/9', null, 380, 'per portion', null, false, null, 'secondi', 440),
  ('12001', 'DALLA NOSTRA GRIGLIA JOSPER', null, 'Costata con Osso (1.2kg)', 'Canadian black angus tomahawk', null, 890, 'per portion', null, false, null, 'secondi', 450),
  ('15002', 'CONTORNI CALDI', null, 'Finocchi allo Zafferano Gratinati', 'Saffron gratinated fennel', null, 45, 'per portion', null, false, array['D','V']::text[], 'contorni', 460),
  ('15004', 'CONTORNI CALDI', null, 'Purea di Patate alla Nocciola e Funghi di Stagione', 'Hazelnut mashed potatoes, sautéed mixed mushrooms', null, 45, 'per portion', null, false, array['D','N']::text[], 'contorni', 470),
  ('15001', 'CONTORNI CALDI', null, 'Broccolini alla Brace con Aglio Olio e Peperoncino', 'Grilled broccolini with garlic olive oil and chili', null, 55, 'per portion', null, false, array['S']::text[], 'contorni', 480),
  ('15006', 'CONTORNI CALDI', null, 'Vegetali alla Brace, Roberto’s Marination', 'Charcoal-grilled vegetables, Roberto''s marination', null, 55, 'per portion', null, false, array['V']::text[], 'contorni', 490)
on conflict (name, section) do nothing;

-- ============================================================
-- Customised menus live IN event_set_menus, behind is_custom.
--
-- Why not a table of their own: client-menus.html and client-setmenu.html both
-- look a menu up by key in event_set_menus, and so do the proposal, the kitchen
-- brief, the coordination email and the per-guest price override. Putting a
-- customised menu anywhere else means teaching all six about a second table --
-- six places to forget. As a flagged row it inherits every one of them for free,
-- and the guest pages need no change at all.
--
--   is_custom   true = built by the events desk in "Customise a menu".
--               The chef's Set-menus library and the booking dropdown hide
--               these; only peSetMenuByKey resolves them, which is what the
--               documents use.
--   based_on    the event_set_menus.key it started from (null = from scratch)
--   event_id    set = built for one event; null = saved for reuse
--   price_mode  'supplement' = keep the base menu price, add per-swap
--                              supplements
--               'sum'        = reprice from every dish on the menu
--   detail      the audit trail the price is built from -- what was swapped
--               for what, what was added, and at what supplement:
--               {"swaps":[{"course":"Secondi","out":"Ribeye di Angus",
--                          "in":"Costoletta d'Agnello","price":220,
--                          "supplement":15,"guests":4}],
--                "adds":[{"course":"Antipasti","name":"Burrata Pugliese",
--                         "price":120,"per_guest":false,"qty":2}]}
--
-- courses keeps EXACTLY the existing shape -- [{"name","items":[...]} |
-- {"name","choose":1,"options":[...]}] -- so every renderer stays untouched.
-- ============================================================
alter table event_set_menus add column if not exists is_custom  boolean not null default false;
alter table event_set_menus add column if not exists based_on   text;
alter table event_set_menus add column if not exists event_id   uuid;
alter table event_set_menus add column if not exists price_mode text not null default 'supplement';
alter table event_set_menus add column if not exists detail     jsonb;

create index if not exists event_set_menus_custom on event_set_menus (is_custom, event_id);
