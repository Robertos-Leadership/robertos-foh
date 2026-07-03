-- Events module — set menus reaching the kitchen (additive only, safe to re-run).
-- Run in the FOH project (paoaivwtkzujmrgrfjuq) SQL editor.

-- The chosen set menu + the per-choice headcount split, e.g.
-- { "key":"fuoco", "choices": { "Secondi": { "Ribeye di Wagyu":18, "Moro":8, "Melanzane":4 } } }
ALTER TABLE events_desk ADD COLUMN IF NOT EXISTS set_menu jsonb;

NOTIFY pgrst, 'reload schema';
