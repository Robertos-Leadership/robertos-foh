-- ============================================================
--  jazz-2026-07-07-plug.sql
--  Plug last night's Jazz Tuesday (7 Jul 2026) into the Activations
--  module. The week row already exists (status 'upcoming', all null).
--
--  SOURCE: Oracle Simphony -> My Reports -> Operations Performance ->
--  "Service Performance" (metrics by daypart, hour & quarter hour),
--  pulled live 8 Jul 2026. Params: Business Date = 7 Jul (Yesterday),
--  Revenue Center = Lounge, Day Parts = All.
--
--  METHOD = Option A (Francesco's call): sum the whole clock-hour buckets
--  8 PM + 9 PM + 10 PM + 11 PM -- exactly how the historical Weekly-Activity
--  figures were built (verified: 30 Jun = 1,278.37+2,528.17+3,786.13+3,080.82
--  = 10,673.49). All figures are Sales NET of VAT.
--
--    8 PM  ...... 624.00
--    9 PM  ...... 582.04
--    10 PM ...... 833.96
--    11 PM ...... 2,107.76
--    -------------------------
--    8-11 PM NET  AED 4,147.76   <-- revenue_actual
--
--  NOTE: unusually low for a Jazz night (recent nights 8-11k) because last
--  night's Lounge trade fell largely OUTSIDE 8-11 PM: AED 1,959.68 at 6 PM,
--  a negative 7 PM (-842.12, voids/refunds), and AED 3,248.98 after midnight
--  (12-2 AM). Full-night Lounge total was 9,209.81.
--
--  COVERS left NULL: guest count under-logged again (only 5 keyed across
--  ~20 checks in the 8-11 PM window). Set the real count below when known.
--  Run in Supabase SQL editor (FOH project paoaivwtkzujmrgrfjuq).
-- ============================================================

UPDATE weeks w
SET revenue_actual = 4147.76,
    status         = 'completed'
FROM events e
WHERE w.event_id = e.id
  AND e.name ILIKE '%jazz%'
  AND LEFT(w.week_date::text, 10) = '2026-07-07';

-- When the real cover count is known, fill it in (avg spend auto-derives):
-- UPDATE weeks w
-- SET covers_actual = <REAL_COUNT>,
--     avg_spend_actual = ROUND(4147.76 / <REAL_COUNT>, 2)
-- FROM events e
-- WHERE w.event_id = e.id AND e.name ILIKE '%jazz%'
--   AND LEFT(w.week_date::text, 10) = '2026-07-07';

-- Verify:
SELECT e.name, LEFT(w.week_date::text,10) AS date, w.status,
       w.revenue_actual, w.covers_actual
FROM weeks w JOIN events e ON e.id = w.event_id
WHERE e.name ILIKE '%jazz%' AND LEFT(w.week_date::text,10) = '2026-07-07';
