-- ============================================================
--  foh-activations-covers-backfill.sql
--  FIX: the Activations overview shows AVG COVERS/EVENT of ~23 because the
--  original revenue backfill (foh-activations-backfill.sql) loaded ONLY
--  revenue_actual and never set covers_actual. This loads the guest counts
--  that were in "Weekly Activity Performance.xlsx" all along (the "Total"
--  Guest Count of each night's Simphony block), matched to the exact night
--  by its revenue figure so nothing is mis-dated.
--
--  NOTE ON THE NUMBER: covers = Simphony's whole-night guest count for that
--  date. revenue_actual is the activation-window subtotal, so the derived
--  average spend is a hair conservative -- but this is the official guest
--  count from the sheet and is what the overview needs.
--
--  ONE NIGHT IS EXCLUDED: Cigar Night 25 Apr 2026 -- Simphony reported 578
--  guests (phantom +510/+502 spikes; avg spend AED 36). Enter the real count
--  by hand once known. See the tail of this file.
--
--  SAFE + IDEMPOTENT: only fills covers_actual where it is still empty, so
--  it will not clobber anything typed in the app. Re-running changes nothing.
--  Run in Supabase SQL editor (FOH project paoaivwtkzujmrgrfjuq).
-- ============================================================

WITH d(evmatch, wd, covers) AS (VALUES
  ('%listening%', '2026-06-15', 27),   -- The Listening Bar
  ('%listening%', '2026-06-22', 52),   -- The Listening Bar
  ('%listening%', '2026-06-29', 14),   -- The Listening Bar
  ('%jazz%',      '2026-06-16', 33),   -- Jazz Tuesdays
  ('%jazz%',      '2026-06-23', 52),   -- Jazz Tuesdays
  ('%jazz%',      '2026-06-30', 28),   -- Jazz Tuesdays
  ('%comedy%',    '2026-05-06', 36),   -- Comedy Night
  ('%comedy%',    '2026-05-20', 39),   -- Comedy Night
  ('%comedy%',    '2026-06-03', 55),   -- Comedy Night
  ('%comedy%',    '2026-06-17', 36),   -- Comedy Night
  ('%comedy%',    '2026-07-01', 42),   -- Comedy Night
  ('%cigar%',     '2026-04-03', 48),   -- Cigar Night
  ('%cigar%',     '2026-04-28', 36),   -- Cigar Night
  ('%cigar%',     '2026-05-30', 54),   -- Cigar Night
  ('%cigar%',     '2026-06-27', 68)    -- Cigar Night
)
UPDATE weeks w
SET covers_actual = d.covers
FROM d
JOIN events e ON e.name ILIKE d.evmatch
WHERE w.event_id = e.id
  AND LEFT(w.week_date::text, 10) = d.wd
  AND w.covers_actual IS NULL;   -- don't overwrite hand-entered covers

-- Verify: every activation night with its net, covers and derived spend/guest
SELECT e.name,
       LEFT(w.week_date::text, 10) AS date,
       w.revenue_actual,
       w.covers_actual,
       ROUND(w.revenue_actual / NULLIF(w.covers_actual, 0), 0) AS spend_per_guest
FROM weeks w JOIN events e ON e.id = w.event_id
WHERE w.revenue_actual IS NOT NULL
ORDER BY date;

-- ── Cigar Night 25 Apr 2026 — fill in the REAL guest count, then run: ──
-- UPDATE weeks w SET covers_actual = <REAL_COUNT>
-- FROM events e
-- WHERE w.event_id = e.id AND e.name ILIKE '%cigar%'
--   AND LEFT(w.week_date::text, 10) = '2026-04-25';
