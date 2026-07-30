-- Per-person event budgets.
--
-- The events target was one row per month (PRIMARY KEY (month)) — so every person
-- on the Monthly report saw the same budget. This adds a `lead` column and keys the
-- target on (month, lead), so each person can have their own monthly budget. The
-- empty string '' is the "Everyone" / overall target — existing month rows become
-- that automatically via the default.
--
-- Safe: additive column + a wider primary key; existing rows keep their values as
-- the Everyone target. Run once.
alter table event_targets add column if not exists lead text not null default '';
alter table event_targets drop constraint if exists event_targets_pkey;
alter table event_targets add primary key (month, lead);
