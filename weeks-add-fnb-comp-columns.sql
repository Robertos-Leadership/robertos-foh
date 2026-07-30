-- ============================================================
--  weeks-add-fnb-comp-columns.sql
--  FIX: the Activations "Enter Results" screen writes fnb_revenue
--  and complimentary to the weeks table, but those columns were
--  never added. Every save from that screen fails (PostgREST 400,
--  "column not found"), so covers + revenue never persist.
--
--  This adds the two missing columns. SAFE + IDEMPOTENT (add if
--  not exists). After this, Enter Results saves fully.
--
--  Run in Supabase SQL editor (FOH project paoaivwtkzujmrgrfjuq).
-- ============================================================

alter table weeks add column if not exists fnb_revenue   numeric;
alter table weeks add column if not exists complimentary numeric;

-- Make PostgREST pick up the new columns immediately (no redeploy needed).
notify pgrst, 'reload schema';

-- Verify:
select column_name from information_schema.columns
where table_name = 'weeks'
order by column_name;
