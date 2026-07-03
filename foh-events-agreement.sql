-- Events module: agreement / e-sign fields (additive only — safe to re-run).
-- Run in the FOH project (paoaivwtkzujmrgrfjuq) SQL editor.
ALTER TABLE events_desk ADD COLUMN IF NOT EXISTS pricing_type text;          -- 'set_price' | 'min_spend'
ALTER TABLE events_desk ADD COLUMN IF NOT EXISTS deposit_pct numeric;        -- 0 = no deposit, usually 50 or 100
ALTER TABLE events_desk ADD COLUMN IF NOT EXISTS guests_min integer;         -- minimum guaranteed guests on the agreement
ALTER TABLE events_desk ADD COLUMN IF NOT EXISTS agreement_remarks text;     -- extras: cake, flowers, tobacco, set-up...
ALTER TABLE events_desk ADD COLUMN IF NOT EXISTS signed_at timestamptz;
ALTER TABLE events_desk ADD COLUMN IF NOT EXISTS signed_name text;
ALTER TABLE events_desk ADD COLUMN IF NOT EXISTS signed_designation text;
ALTER TABLE events_desk ADD COLUMN IF NOT EXISTS contract_snapshot text;     -- frozen HTML of exactly what was signed
NOTIFY pgrst, 'reload schema';
