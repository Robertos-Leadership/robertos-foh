-- Events: let Valentina choose how the price reads on a guest's proposal.
-- 'total' (whole event, the default) or 'pp' (per person). Presentation only —
-- the underlying total is unchanged. Safe to run more than once.
alter table events_desk add column if not exists price_display text;
