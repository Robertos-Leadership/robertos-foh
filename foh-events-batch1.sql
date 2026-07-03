-- Events module — Batch 1 hardening (additive only, safe to re-run).
-- Run in the FOH project (paoaivwtkzujmrgrfjuq) SQL editor.

-- #5 dry event / beverage mode: 'standard' | 'dry' (no alcohol) | 'custom'
ALTER TABLE events_desk ADD COLUMN IF NOT EXISTS bev_mode text;

-- #6 whether a dish's quantity was confirmed by a human, or is still the
-- placeholder a package/selection inserted (so the prep sheet can flag it).
ALTER TABLE event_items ADD COLUMN IF NOT EXISTS qty_confirmed boolean;

NOTIFY pgrst, 'reload schema';
