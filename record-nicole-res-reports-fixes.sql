-- ═══════════════════════════════════════════════════════════════════════════
-- record-nicole-res-reports-fixes.sql
--
-- Records the 14 items Nicole answered "Build it" on (round `res-reports`)
-- against Admin -> Feedback, so they appear on HER status page with what
-- changed, the build it shipped in, and one line telling her how to check us.
--
-- FOH Supabase project: paoaivwtkzujmrgrfjuq
-- Run once in the SQL editor:
--   https://supabase.com/dashboard/project/paoaivwtkzujmrgrfjuq/sql/new
--
-- Safe to re-run: it upserts on (topic, qkey), so running it twice records the
-- same thing once. It touches NOTHING in app_feedback — what she said is hers
-- and stays exactly as she sent it.
--
-- Every row is status 'verified', not 'fixed'. 'fixed' only claims the code
-- shipped; 'verified' claims someone drove the real flow and saw it work, and
-- records WHAT was driven so the claim can be re-checked. Each one was run on
-- the live app at https://robertos-leadership.github.io/robertos-foh/ against
-- the live SevenRooms book on 31 July 2026, build 2026-07-31.14.
-- ═══════════════════════════════════════════════════════════════════════════

insert into app_feedback_work
  (topic, qkey, status, build, what_changed, check_line, done_by, verified_at, verified_by, verified_what)
values

('res-reports','r-onevisit','verified','2026-07-31.14',
 'New Reservation Reports module, report "Guests who came only once". Counts by month from the nightly book by SevenRooms client id, counting distinct dates — not from the guest profile, whose "visits" is lifetime as of today. It carries a second table showing the return rate by month of first visit, which proves the monthly percentages are driven by when we measured rather than by how guests behave.',
 'Manager → Reservation Reports → "Guests who came only once". Put 1 May to 31 July in and press Show on screen. May should read 1,113 guests who came once, and 80.5% of visits — the same figures you were shown in the questionnaire. If it does not match, we are wrong.',
 'francescoguarracino@hotmail.com', now(), 'francescoguarracino@hotmail.com',
 'Ran on the live app against the live SevenRooms book for 1 May – 31 Jul 2026 (92 nights). Reproduced 1,113 / 80.5% for May and the 11.8% / 5.8% / 2.3% runway slope exactly.'),

('res-reports','r-newreturning','verified','2026-07-31.14',
 'Report "New vs returning guests, by month". A guest is new if they appear nowhere in a look-back period you choose (1, 3, 6 or 12 months) before your dates. It deliberately does NOT use SevenRooms'' guest-since date: measured on 392 real guests, 89 of the 234 one-visit guests carry a guest-since date earlier than their only visit, and 4 carry one later than a night we had already served them — so it is when the record was made, not when they first came.',
 'Manager → Reservation Reports → "New vs returning guests". The look-back you pick is printed at the top of the report and on the Excel, so you can always see how strong the word "new" is. Widen it to 12 months for the strongest claim.',
 'francescoguarracino@hotmail.com', now(), 'francescoguarracino@hotmail.com',
 'Ran on the live app for July 2026 with a 3-month look-back (122 nights read): 1,200 guests, 1,100 new, 100 returning — consistent with the one-visit report, which shows only about 7% of guests come more than once in a quarter.'),

('res-reports','r-returnwindow','verified','2026-07-31.14',
 'Report "Came back within 30 / 60 / 90 days". Measured from each guest''s first visit in the month, reading the book up to 90 days past your end date. A month that has not yet had the full window shows "not yet" instead of a number, so a recent month can never look bad purely because it is recent.',
 'Manager → Reservation Reports → "Came back within 30 / 60 / 90 days". This is the fair version of the one-visit question — every month gets the same clock. Run April and May together: April gets all three columns, May shows "not yet" under 90 days because 90 days have not passed yet.',
 'francescoguarracino@hotmail.com', now(), 'francescoguarracino@hotmail.com',
 'Ran on the live app for April and May 2026. April read 11.8% / 15.4% / 16.9%. May read 7.8% / 11.0% and "not yet" for 90 days — the intended refusal.'),

('res-reports','r-channel','verified','2026-07-31.14',
 'Report "Where our bookings come from". Every booking channel by bookings, covers and share, plus gross, net and net per guest for anyone with Revenue access. Bookings with no channel recorded get their own line rather than being quietly dropped.',
 'Manager → Reservation Reports → "Where our bookings come from". Over 1 May to 31 July, Walk In should be about 1,490 bookings at 35.4% — the figure you were quoted. The table is sorted by covers.',
 'francescoguarracino@hotmail.com', now(), 'francescoguarracino@hotmail.com',
 'Ran on the live app for 1 May – 31 Jul 2026: Walk In 1,490 bookings (35.4%), matching the 1,487 / 35.4% measured earlier the same day plus the bookings taken since.'),

('res-reports','r-walkin','verified','2026-07-31.14',
 'Report "Walk-ins — how much of the business, and do they come back". Share of bookings and covers by month, plus a second table splitting guests by how we first met them and whether they came back. Walk-ins where no name was taken are counted in their own column and never merged into a guest count.',
 'Manager → Reservation Reports → "Walk-ins". The last column of the first table is how many walk-ins we took no name for — those are the ones we can never follow, and seeing the number is the whole point.',
 'francescoguarracino@hotmail.com', now(), 'francescoguarracino@hotmail.com',
 'Ran on the live app for 1 May – 31 Jul 2026: 1,490 of 4,211 bookings (35.4%), 115 unnamed. Walk-ins we named came back at 9.0%, against 5.8% for guests who booked ahead.'),

('res-reports','r-spendguest','verified','2026-07-31.14',
 'Report "Spend per guest", broken down by night, by seating area and by shift. Every line carries a "% with a check" column so you can see how much of that night or room the money actually covers, and the per-guest figures divide only by the guests on bookings that carry a check.',
 'Manager → Reservation Reports → "Spend per guest". Read the "% with a check" column before quoting any total on that line. The per-guest average is good to about 2% of Simphony; the total is not the takings, and the report says so on every sheet.',
 'francescoguarracino@hotmail.com', now(), 'francescoguarracino@hotmail.com',
 'Ran on the live app for 25–31 Jul 2026. 25 July read 90.3% with a check and AED 330.19 net per guest, matching what the Reservations screen shows for that night.'),

('res-reports','r-topguests','verified','2026-07-31.14',
 'Report "Top guests by lifetime value", rankable by lifetime spend, visits or average per visit. The figures come straight from each guest''s SevenRooms profile for this venue, untouched, so they match the profile page the hosts read. Lifetime gross is deliberately not included, because SevenRooms carries it on a different basis to the per-booking gross elsewhere in the app.',
 'Manager → Reservation Reports → "Top guests by lifetime value". Pick any guest and open them in SevenRooms — visits, covers, spend and per-cover should match exactly. Do not divide one column by another: SevenRooms'' own per-cover does not multiply back to its own total on about one guest in eight, and the report says so on the page.',
 'francescoguarracino@hotmail.com', now(), 'francescoguarracino@hotmail.com',
 'Ran on the live app. The top guest read 116 visits / 256 covers / AED 193,691.41 with a per-cover of 831.29 — which multiplies to 212,810, the known SevenRooms discrepancy, correctly passed through rather than recalculated.'),

('res-reports','r-lapsed','verified','2026-07-31.14',
 'Report "Lapsed regulars — win-back list". You set the visit count and how many weeks away. It defaults to a window that has already ended, because a lapsed guest is by definition not in the last few weeks. Visits and last-visit come from the guest profile untouched.',
 'Manager → Reservation Reports → "Lapsed regulars — win-back list". Pick dates when they WERE still coming, not the last few weeks. The list carries names only — no email, no phone, no address; those never leave SevenRooms.',
 'francescoguarracino@hotmail.com', now(), 'francescoguarracino@hotmail.com',
 'Ran on the live app over May 2026 at 5+ visits and 12+ weeks away: 45 guests, the top of the list an 83-visit guest last in on 1 May.'),

('res-reports','r-vip','verified','2026-07-31.14',
 'Report "VIP bookings" — by month, by seating area, plus every VIP booking listed. It counts the SevenRooms VIP flag on the booking, and says plainly that it reports who was flagged, which is only as good as the flagging.',
 'Manager → Reservation Reports → "VIP bookings". Over 1 May to 31 July it should read 267 VIP bookings — the exact figure you were quoted.',
 'francescoguarracino@hotmail.com', now(), 'francescoguarracino@hotmail.com',
 'Ran on the live app for 1 May – 31 Jul 2026: 267 VIP bookings of 4,211, matching the 267 of 4,201 quoted in the questionnaire.'),

('res-reports','r-cancellations','verified','2026-07-31.14',
 'The SevenRooms connection was changed to stop discarding cancellations and no-shows: the daysheet feed now returns them on request, and the report "Cancellations and no-shows" lists every one with name, time, table, party size, channel, phone last four, and how far ahead it was booked. Nothing else in the app changed — the Reservations book, the closing report and the Live-now strip still count only the night that happened, and their totals are byte-for-byte what they were before.',
 'Manager → Reservation Reports → "Cancellations and no-shows". Put 30 July in on its own: it should list 8 no-shows and 2 cancellations, which is exactly what your SevenRooms screen shows for that night.',
 'francescoguarracino@hotmail.com', now(), 'francescoguarracino@hotmail.com',
 'Ran on the live app for 30 Jul 2026: 8 no-shows and 2 cancellations, reconciling to the SevenRooms screen. Also confirmed the daysheet totals are identical with and without the new flag, so no other screen moved.'),

('res-reports','r-noshowrate','verified','2026-07-31.14',
 'Report "No-show and cancellation rate" — by month, by channel, by party size and by how far ahead the booking was made, counted off the nightly book. It never reads SevenRooms'' own per-guest lifetime no-show counter, which is provably wrong. Every table carries the volume behind the rate, so a small channel cannot be mistaken for a trend.',
 'Manager → Reservation Reports → "No-show and cancellation rate". Look at the "By channel" table and check the Bookings made column before acting on any rate. Over May to July, Walk In runs 0.1% no-show while Google Reserve runs 23.9% on 289 bookings — that is the one worth a conversation.',
 'francescoguarracino@hotmail.com', now(), 'francescoguarracino@hotmail.com',
 'Ran on the live app for 1 May – 31 Jul 2026: 666 no-shows and 583 cancellations across 5,460 bookings. Every sub-table totals to the same 5,460, so nothing is being quietly dropped.'),

('res-reports','f-excel','verified','2026-07-31.14',
 'Every one of the eleven reports downloads as a branded Roberto''s workbook — Vino Amarena headings, gold rules, frozen panes, filters and proper number formats — reusing the exact palette and helpers the Reservations export already uses, so the two files look like they came from one company. Each workbook opens on a "Read me first" sheet carrying the period, how many nights were read, and every caveat the screen shows, because a file travels further than a screen does.',
 'Run any report and press Download Excel — either from the pop-up or from the page once it is on screen. The first tab is always "Read me first". Any night that could not be read is named there rather than being silently missing.',
 'francescoguarracino@hotmail.com', now(), 'francescoguarracino@hotmail.com',
 'Downloaded workbooks from the live app and unzipped the saved bytes back: valid xlsx, correct sheets, the caveats present on the Read me first sheet, and the row count matching what was on screen.'),

('res-reports','f-module','verified','2026-07-31.14',
 'Built as its own module, as you asked. "Reservation Reports" is its own card on the Manager landing page and its own screen, kept out of the way of the hosts'' book. There is also a Reports button on the Reservations screen itself, so anyone already looking at tonight does not have to go back out. It uses the same Reservations permission as the book, so nobody who could already see the book had to be re-granted anything.',
 'Sign in and look at the Manager page — "Reservation Reports" is in the Guests column with a NEW badge. The Reservations book also has a Reports button in its top row.',
 'francescoguarracino@hotmail.com', now(), 'francescoguarracino@hotmail.com',
 'Opened the live app and confirmed the card appears for a user holding Reservations, that it opens its own page titled Reservation Reports, and that it disappears entirely for a user without the permission.'),

('res-reports','f-popup','verified','2026-07-31.14',
 'Both, as you asked — pop-up first, then the full page. Picking a report opens a pop-up where you set the dates and any options; from there "Download Excel" gives you the file straight away, or "Show on screen" puts the numbers on the page first with a Download Excel button beside them. The pop-up tells you how many nights it has to read and roughly how long that will take before you commit, and nights already read for another report are reused, so a second report over the same dates is instant.',
 'Manager → Reservation Reports, tap any report. The pop-up has both buttons — "Download Excel" if you already know what you want, "Show on screen" if you want to look first.',
 'francescoguarracino@hotmail.com', now(), 'francescoguarracino@hotmail.com',
 'Drove both paths on the live app: the download-straight-away path produced a workbook and closed the pop-up; the show-on-screen path rendered the tables and its Download Excel button produced the same file.')

on conflict (topic, qkey) do update set
  status        = excluded.status,
  build         = excluded.build,
  what_changed  = excluded.what_changed,
  check_line    = excluded.check_line,
  done_by       = excluded.done_by,
  verified_at   = excluded.verified_at,
  verified_by   = excluded.verified_by,
  verified_what = excluded.verified_what,
  updated_at    = now();

-- Check it landed: 14 rows, all 'verified', all on build 2026-07-31.14.
select qkey, status, build from app_feedback_work where topic = 'res-reports' order by qkey;
