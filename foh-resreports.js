// ──────────────────────────────────────────────────────────────────────────
// RESERVATION REPORTS module (rr*) — the eleven reports Nicole asked for.
//
// WHERE THIS CAME FROM. Round `res-reports` ("Reservations — which reports do
// you want?"). Nicole Dragan answered "Build it" on eleven reports and on three
// questions about the shape of the thing:
//
//   f-module  "Keep them in a separate Reports module."   -> this file is a
//             module of its own, reached from its own card on the Manager
//             landing and from a button on the Reservations book. The hosts'
//             book is untouched.
//   f-popup   "start with the pop-up, but then build the full page too."
//             -> BOTH. Picking a report opens a pop-up you fill in; from there
//             you either download straight away or show it on the page first.
//   f-excel   "Build it" -> every report downloads as a branded Roberto's
//             workbook, using the SAME palette and the same helpers as the
//             Reservations export (RES_XL / resXlBorder in foh-reservations.js)
//             so the two files cannot drift into looking like two companies.
//
// WHERE THE NUMBERS COME FROM. Exactly one place: the nightly book, one call
// per night to the Kitchen `sevenrooms-sync` edge function — the same call the
// Reservations screen and the date-range export already make. There is no
// second source and no stored copy, so a report can never disagree with the
// book it came from.
//
// THE ONE THING THAT MAKES ALL OF THIS POSSIBLE — and the trap that had to be
// avoided. A guest profile's `visits` is LIFETIME AS OF RIGHT NOW, not as of a
// date, and there is no per-visit history anywhere in the API. So "guests who
// came once in the last three months" CANNOT be answered by filtering on
// visits == 1. Measured 31 Jul 2026 over 1 May - 31 Jul: 3,358 guests came
// exactly once in that window and only 2,347 of them carry visits == 1 — the
// other 1,007 (30%) are regulars who happened to come once that quarter.
// Reading it off the profile would have been wrong by nearly a third.
//
// So every "how many guests" answer here is rebuilt from the nightly book:
// group every booking by its SevenRooms client id, count DISTINCT DATES. That
// is a real visit ledger, which the guest API does not give us. rrLedger()
// below is that, and nothing else in this file counts guests any other way.
//
// WHAT IS DELIBERATELY NOT USED:
//   * the guest profile's `visits` for a windowed count      (see above)
//   * the guest profile's lifetime `noshows`                 (provably wrong:
//     of 440 guests carrying no-shows, 9 have more no-shows than visits, worst
//     31 against 17. Every no-show figure here is counted off the nightly book,
//     which is checkable against the SevenRooms screen.)
//   * the guest profile's `first_seen` as "first visit"      (measured 31 Jul
//     2026 on 392 real guests: it is the date the RECORD was made, not the
//     first visit. 89 of 234 one-visit guests carry a first_seen EARLIER than
//     their only visit, and 4 of 392 carry one LATER than a night we served
//     them, which a first-visit date cannot do. "New vs returning" uses a
//     stated look-back over the book instead — see rrRepNewReturning.)
//
// Loaded as a classic <script> so its functions stay global for the inline
// onclick handlers, exactly like foh-reservations.js. It depends on that file
// being loaded first and reuses its helpers rather than re-typing them:
//   resEsc resNum resMoney0 resNet resGrossToNet resGrossOf resHeads
//   resDateLabel resWeekday resVisitShort resLoadExcelJS RES_XL resXlBorder
// ──────────────────────────────────────────────────────────────────────────

// ── WHAT A "VISIT" AND A "BOOKING" MEAN HERE ──────────────────────────────
// Probed against the live book 31 Jul 2026 across six nights spread over the
// quarter (30/25/18 Jul, 20 Jun, 15/2 May): every single row came back as
// COMPLETE, NO_SHOW or CANCELED — 400 / 76 / 55. A finished night carries no
// half-states, so on any past date these two definitions are exact:
//
//   a BOOKING  = a row that is not CANCELED and not NO_SHOW. The same
//                population the Reservations book counts, so a report and the
//                book can never print two different "bookings" for a night.
//   a VISIT    = a distinct DATE on which a guest had a booking. Two bookings
//                on one night is one visit; that is what "came" means.
//
// A night still in progress also carries upcoming/seated rows. Those count as
// bookings, which is right — they are in the book — and the reports are meant
// for finished periods anyway. The date pickers default to whole past months.
function rrIsGone(r){ return r && (r.state === 'cancelled' || r.state === 'noshow'); }
function rrIsBooking(r){ return !rrIsGone(r); }

// ── FETCH ─────────────────────────────────────────────────────────────────
// One POST per night, &include=all so the cancellations and no-shows arrive
// too. Cached per date for the life of the page: running a second report over
// the same period is then instant, which matters because she will run several.
var RRN = { nights: {}, ok: null };   // date -> rows ; ok = did the feed honour include=all

// The echo check. An older deployment of sevenrooms-sync ignores an unknown
// query parameter and answers 200 with a perfectly normal payload — so a
// no-show report built against it would quietly print "0 no-shows" and read as
// good news. The function now echoes `includes_cancelled`; if that is not true
// the two cancellation reports refuse to draw rather than print a zero.
// See the &include=all note in sevenrooms-sync/index.ts.
async function rrFetchNight(d){
  if(RRN.nights[d]) return RRN.nights[d];
  var r = await fetch(KITCHEN_URL + '/functions/v1/sevenrooms-sync?daysheet=' + d + '&include=all', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+KITCHEN_KEY, 'x-proxy-secret':KITCHEN_PROXY_SECRET }
  });
  if(!r.ok) throw new Error('HTTP '+r.status);
  var j = await r.json();
  if(!j || !j.ok) throw new Error((j && j.error) || 'no data');
  if(!Array.isArray(j.reservations)) throw new Error('daysheet mode not deployed');
  RRN.ok = (RRN.ok === false) ? false : (j.includes_cancelled === true);
  RRN.nights[d] = j.reservations;
  return j.reservations;
}

// Every date between two ISO dates, inclusive.
function rrDates(from, to){
  var out = [], d = from;
  if(!from || !to || from > to) return out;
  while(d <= to && out.length < 800){ out.push(d); d = resShiftDate(d, 1); }
  return out;
}
function rrMonth(iso){ return String(iso||'').slice(0,7); }
function rrMonthLabel(ym){
  try{ return new Date(ym+'-01T12:00:00').toLocaleDateString('en-GB',{month:'long',year:'numeric'}); }
  catch(e){ return ym; }
}
function rrDaysBetween(a, b){
  return Math.round((new Date(b+'T12:00:00') - new Date(a+'T12:00:00')) / 86400000);
}
function rrAddDays(iso, n){ return resShiftDate(iso, n); }
function rrToday(){ return (typeof chkToday==='function') ? chkToday().iso : new Date().toISOString().slice(0,10); }
function rrPct(n, d){ return d ? Math.round(n/d*1000)/10 : null; }

// Pull a list of nights with a small amount of parallelism.
//
// FIVE AT A TIME, and that number is measured rather than guessed: five
// parallel daysheet calls read a 92-night quarter in about three minutes on
// 31 Jul 2026, where one at a time takes nearer ten. Going wider starts
// getting refused by SevenRooms half way through, which is how you end up with
// a file that is quietly missing four days.
//
// A NIGHT THAT FAILS IS NEVER DROPPED IN SILENCE. It is collected and named on
// the report and on the Excel — the same rule the date-range export follows,
// for the same reason: a missing night in a report someone takes upstairs is
// worse than no report.
var RR_PARALLEL = 5;
async function rrPull(dates, onProgress){
  var got = {}, failed = [], done = 0;
  var queue = dates.slice();
  async function worker(){
    while(queue.length){
      var d = queue.shift();
      try{ got[d] = await rrFetchNight(d); }
      catch(e){
        console.warn('[resreports] night failed', d, e);
        failed.push({ date: d, why: (e && e.message) ? String(e.message) : 'could not be read' });
      }
      done++;
      if(onProgress) onProgress(done, dates.length, d);
    }
  }
  var crew = [];
  for(var i=0; i<Math.min(RR_PARALLEL, dates.length); i++) crew.push(worker());
  await Promise.all(crew);
  return { nights: got, failed: failed };
}

// ── THE VISIT LEDGER ──────────────────────────────────────────────────────
// The one place guests are counted. Built from the nights themselves — see the
// header for why the guest profile cannot answer this.
//
// A booking with no client id is real and rare (some walk-ins are logged
// without one). It counts as a BOOKING everywhere, and simply cannot count as
// a guest, because there is nothing to join it on. Every report that counts
// guests says how many bookings had no id rather than pretending they were not
// there.
//
// The anonymous placeholder is separate and worse. Where a host takes no name,
// SevenRooms writes a throwaway record literally called "Guest", each with its
// own unique client id. In 2024 there were 12,340 of them and not one ever
// appears on a second date. They are counted and reported as their own line —
// never silently merged into "guests who came once", which would claim we
// served 12,336 people who all failed to return when the truth is we never
// knew who they were.
function rrIsPlaceholder(name){ return String(name||'').trim().toLowerCase() === 'guest'; }

function rrLedger(nights){
  var guests = {};        // client id -> record
  var dates = Object.keys(nights).sort();
  var noId = 0, bookings = 0, placeholderBookings = 0;
  dates.forEach(function(d){
    (nights[d] || []).forEach(function(r){
      if(!rrIsBooking(r)) return;
      bookings++;
      if(rrIsPlaceholder(r.name)) placeholderBookings++;
      var id = r.client;
      if(!id){ noId++; return; }
      var g = guests[id] || (guests[id] = {
        id: id, name: r.name || 'Guest', dates: [], seen: {},
        placeholder: rrIsPlaceholder(r.name),
        firstBookedBy: r.booked_by || '', bookings: 0, covers: 0
      });
      g.bookings++;
      g.covers += Number(r.pax) || 0;
      if(!g.seen[d]){ g.seen[d] = 1; g.dates.push(d); }
      // Keep the earliest night's channel: "did a walk-in come back" asks about
      // how we first met them, not about their most recent booking.
      if(!g.firstDate || d < g.firstDate){ g.firstDate = d; g.firstBookedBy = r.booked_by || ''; }
      if(!g.lastDate || d > g.lastDate) g.lastDate = d;
    });
  });
  Object.keys(guests).forEach(function(k){ guests[k].dates.sort(); });
  return { guests: guests, dates: dates, bookings: bookings,
           bookingsNoId: noId, placeholderBookings: placeholderBookings };
}

// Every booking across the pulled nights, flattened, each carrying its date.
function rrAllRows(nights, includeGone){
  var out = [];
  Object.keys(nights).sort().forEach(function(d){
    (nights[d] || []).forEach(function(r){
      if(!includeGone && !rrIsBooking(r)) return;
      // A shallow copy, not Object.create: a prototype-linked row looks empty to
      // anything that walks its own keys, and this array gets handed around.
      var c = {}; for(var k in r) if(Object.prototype.hasOwnProperty.call(r,k)) c[k] = r[k];
      c.date = d;
      out.push(c);
    });
  });
  return out;
}

// ── GUEST PROFILES ────────────────────────────────────────────────────────
// Only three reports need these — one-visit (the "only ever once" column), top
// guests, and lapsed regulars. Batched 60 at a time, which measured at about
// two seconds per twenty guests on 31 Jul. Shares foh-reservations.js's RESH
// cache, so a guest already read for tonight's book is never fetched twice.
//
// A guest whose profile will not read is remembered as failed and reported as
// such — never counted as a zero.
async function rrProfiles(ids, venue, onProgress){
  var want = ids.filter(function(id){ return id && !RESH.got[id] && !RESH.failed[id]; });
  var uniq = [], seen = {};
  want.forEach(function(id){ if(!seen[id]){ seen[id]=1; uniq.push(id); } });
  for(var i=0; i<uniq.length; i+=60){
    var slice = uniq.slice(i, i+60);
    try{
      var r = await fetch(KITCHEN_URL + '/functions/v1/sevenrooms-sync?guests=' + encodeURIComponent(slice.join(','))
          + '&venue=' + encodeURIComponent(venue||''), {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+KITCHEN_KEY, 'x-proxy-secret':KITCHEN_PROXY_SECRET }
      });
      if(!r.ok) throw new Error('HTTP '+r.status);
      var j = await r.json();
      if(!j || !j.ok) throw new Error((j && j.error) || 'no data');
      var map = j.guests || {};
      slice.forEach(function(id){ if(map[id]) RESH.got[id] = map[id]; else RESH.failed[id] = 1; });
    }catch(e){
      console.warn('[resreports] profiles failed', e);
      // NOT marked failed — a network blip must not permanently blank a column.
    }
    if(onProgress) onProgress(Math.min(i+60, uniq.length), uniq.length);
  }
}
// The venue to read a guest's figures for. Off a booking, never hardcoded — the
// lifetime figures MUST be read per venue or they contradict the profile page
// the hosts read (see the ?guest= note in sevenrooms-sync).
function rrVenueOf(nights){
  var ds = Object.keys(nights);
  for(var i=0;i<ds.length;i++){
    var rows = nights[ds[i]] || [];
    for(var j=0;j<rows.length;j++) if(rows[j].venue) return rows[j].venue;
  }
  return '';
}
// A profile, only when it came back scoped to the venue. The group-wide totals
// are a different measure that disagrees with the hosts' own screen (70 visits
// / AED22,259 group against 47 / AED62,715 on the page, verified 28 Jul), so a
// group-scoped answer is treated as no answer rather than shown.
function rrProf(id){
  var g = id && RESH.got[id];
  return (g && g.scope === 'venue') ? g : null;
}

// ══════════════════════════════════════════════════════════════════════════
// THE REPORTS
//
// Every one returns the same shape, so the screen and the Excel writer each
// need to understand exactly one thing:
//   { title, sub, tables:[ {name, head, rows, widths, money:[], num:[], note} ],
//     notes:[ 'plain sentences that must travel with the numbers' ] }
// A cell is a string, a number, or null. null prints blank, never 0 — a blank
// means "we have nothing here" and a 0 means "we measured nothing", and mixing
// those up is how a report gets misread.
// ══════════════════════════════════════════════════════════════════════════

// The sentence every money figure in this module has to carry. Written once so
// eleven reports cannot end up saying it eight different ways.
var RR_MONEY_NOTE = [
  'Money here is the SevenRooms check on a booking. Gross is the menu-price total the guest paid; net is gross ÷ ' + (typeof resGrossToNet==='function'?resGrossToNet():1.225) + ' (10% service + 7% municipality on net, then 5% VAT).',
  'The AVERAGE PER GUEST is reliable — within about 2% of Simphony. The TOTAL is not, and must never be quoted as takings: it only covers bookings with a check linked, which runs 83–98% of the real figure and moves night to night. A walk-in served without a booking has nothing to attach a check to.',
  'For what the venue actually took, use the Revenue module or the closing report.'
];
var RR_WALKIN_NOTE = 'Blind spot, stated every time: where a host takes no name, SevenRooms writes a throwaway record called "Guest" with its own id that can never appear twice. Those are counted and shown on their own line here, never merged into a guest count.';

// ── 1. r-onevisit — One-visit guests, by month ────────────────────────────
function rrRepOneVisit(pull, opt){
  var L = rrLedger(pull.nights);
  var months = {}, order = [];
  var M = function(ym){
    if(!months[ym]){ months[ym] = { ym:ym, guests:{}, visits:0, once:0, onceEver:0, everKnown:0 }; order.push(ym); }
    return months[ym];
  };
  Object.keys(L.guests).forEach(function(id){
    var g = L.guests[id];
    if(g.placeholder) return;                       // named guests only — see rrIsPlaceholder
    var onceInWindow = g.dates.length === 1;
    var monthsSeen = {};
    // Two different things get counted, and conflating them is exactly how the
    // percentage below gets misread — see the note on the table.
    //   guests — how many DIFFERENT people came that month
    //   visits — how many NIGHTS they came between them
    g.dates.forEach(function(d){
      var ym = rrMonth(d);
      monthsSeen[ym] = 1;
      M(ym).visits++;
    });
    Object.keys(monthsSeen).forEach(function(ym){
      var m = M(ym);
      m.guests[id] = 1;
      if(onceInWindow){
        m.once++;
        var p = rrProf(id);
        if(p){ m.everKnown++; if((Number(p.visits)||0) <= 1) m.onceEver++; }
      }
    });
  });
  order.sort();

  var rows = [], totEver = 0, totKnown = 0, totVisits = 0;
  order.forEach(function(ym){
    var m = months[ym], n = Object.keys(m.guests).length;
    totEver += m.onceEver; totKnown += m.everKnown; totVisits += m.visits;
    rows.push([rrMonthLabel(ym), n, m.visits, m.once, rrPct(m.once, n), rrPct(m.once, m.visits),
               m.everKnown ? m.onceEver : null,
               m.everKnown ? rrPct(m.onceEver, m.everKnown) : null]);
  });
  // Window total counts each guest ONCE even if they appear in two months —
  // the monthly lines cannot be added up, and a TOTAL row that looked like a
  // sum of them would invite exactly that.
  var distinct = 0, distinctOnce = 0;
  Object.keys(L.guests).forEach(function(id){
    if(L.guests[id].placeholder) return;
    distinct++;
    if(L.guests[id].dates.length === 1) distinctOnce++;
  });
  rows.push(['WHOLE WINDOW (each guest once)', distinct, totVisits, distinctOnce,
             rrPct(distinctOnce, distinct), rrPct(distinctOnce, totVisits),
             totKnown ? totEver : null, null]);

  // The runway table. This is the honest half of the answer and it is not
  // optional: it shows, in her own book, that the monthly one-visit percentages
  // above are driven by WHEN we measured and not by guest behaviour.
  var runway = [];
  order.forEach(function(ym){
    var first = 0, back = 0;
    Object.keys(L.guests).forEach(function(id){
      var g = L.guests[id];
      if(g.placeholder || !g.dates.length) return;
      if(rrMonth(g.dates[0]) !== ym) return;
      first++;
      if(g.dates.length > 1) back++;
    });
    var monthEnd = rrMonthEnd(ym);
    var runDays = Math.max(0, rrDaysBetween(monthEnd > pull.to ? pull.to : monthEnd, pull.to));
    runway.push([rrMonthLabel(ym), first, back, rrPct(back, first), runDays]);
  });

  return {
    title: 'Guests who came only once',
    sub: 'A visit is a distinct date. Counted from the nightly book, never from the guest profile.',
    tables: [
      { name: 'By month',
        head: ['Month','Guests who came','Visits','Came once in this window','% of guests','% of visits','Of those, only ever once','%'],
        widths: [22,14,10,20,12,12,20,8], num:[1,2,3,6], pct:[4,5,7],
        rows: rows,
        note: 'TWO PERCENTAGES, because there are two honest ways to ask this and they give different answers. "% of guests" divides by the different people who came that month — it is like for like and the one to use. "% of visits" divides by the number of nights they came between them, which is the figure quoted in the questionnaire you answered. Both are here so you can check either.' },
      { name: 'Why the months are not comparable',
        head: ['Month they were first seen','Guests','Came back later in the window','%','Days of runway they had'],
        widths: [24,12,24,8,20], num:[1,2,4], pct:[3],
        rows: runway,
        note: 'Read this before quoting the percentages above.' }
    ],
    notes: [
      'THE ONE THING TO KNOW: the monthly percentages above are NOT comparable to each other. A guest who came in the first month has had the whole window to come back; a guest who came in the last month has had days. The second table shows that in your own book — the return rate falls month by month purely because the runway shortens.',
      'If you want months compared fairly, run "Came back within 30 / 60 / 90 days" instead. Every month there is judged on the same clock, and a month too recent to have a full clock is named as such rather than given a misleadingly low number.',
      'Counted from the nightly book, by SevenRooms client id, counting distinct dates. It is NOT read off the guest profile: profile "visits" is lifetime as of today, not as of a date. Measured 31 Jul 2026 over May–Jul, 3,358 guests came exactly once but only 2,347 carried visits == 1 — the other 1,007 are regulars who happened to come once that quarter.',
      RR_WALKIN_NOTE
    ]
  };
}
// The month LABELS present in a set of rows, in date order. Used where a table
// is keyed by the printed month name — sorting those alphabetically gives
// "April, August, December" and sorting by volume hides the trend entirely.
function rrMonthsIn(rows){
  var seen = {};
  (rows||[]).forEach(function(r){ if(r.date) seen[rrMonth(r.date)] = 1; });
  return Object.keys(seen).sort().map(rrMonthLabel);
}
function rrMonthEnd(ym){
  var d = new Date(ym+'-01T12:00:00');
  d.setMonth(d.getMonth()+1); d.setDate(0);
  return d.toISOString().slice(0,10);
}

// ── 2. r-newreturning — New vs returning, by month ────────────────────────
// "New" needs a definition that can be checked, and the obvious candidate does
// not survive contact with the data. SevenRooms' guest-since date (`first_seen`)
// is when the RECORD was made, not when they first came: measured 31 Jul 2026
// on 392 real guests across six nights, 89 of the 234 guests SevenRooms says
// have visited exactly once carry a guest-since date EARLIER than that single
// visit, and 4 of 392 carry one LATER than a night we had already served them.
// A first-visit date cannot be later than a visit. So it is not one.
//
// What is left is honest and checkable: look back a stated number of months
// before the report period, and call a guest NEW if they do not appear in it.
// She chooses the look-back, the report prints it in its own title, and every
// sheet says it. A three-month look-back means "new as far back as we looked",
// which is a smaller claim than "new ever" and is the true one.
function rrRepNewReturning(pull, opt){
  var back = Number(opt.lookback) || 3;
  var L = rrLedger(pull.nights);
  var rows = [], order = [];
  var seenBefore = {};       // guest id -> earliest date anywhere in the pull
  Object.keys(L.guests).forEach(function(id){
    if(L.guests[id].placeholder) return;
    seenBefore[id] = L.guests[id].dates[0];
  });
  // Report months are the ones inside the window she asked for, not the
  // look-back months we only pulled to answer the question.
  var ym = rrMonth(opt.from), endYm = rrMonth(opt.to);
  while(ym <= endYm){ order.push(ym); ym = rrMonth(rrAddDays(rrMonthEnd(ym), 1)); }

  order.forEach(function(ym){
    var nw = 0, ret = 0, n = 0;
    Object.keys(L.guests).forEach(function(id){
      var g = L.guests[id];
      if(g.placeholder) return;
      var inMonth = false;
      for(var i=0;i<g.dates.length;i++) if(rrMonth(g.dates[i]) === ym){ inMonth = true; break; }
      if(!inMonth) return;
      n++;
      // NEW if the earliest night we have them on ANYWHERE in what we read —
      // the look-back months included — falls inside this month. Otherwise we
      // had already seen them, so they are returning.
      if(rrMonth(seenBefore[id]) === ym) nw++; else ret++;
    });
    rows.push([rrMonthLabel(ym), n, nw, rrPct(nw, n), ret, rrPct(ret, n)]);
  });

  return {
    title: 'New vs returning guests, by month',
    sub: 'NEW means we have no record of them in the ' + back + ' month' + (back===1?'':'s') + ' before this period. That is the claim, and it is the whole claim.',
    tables: [
      { name: 'By month',
        head: ['Month','Guests who came','New to us','%','Returning','%'],
        widths: [22,15,13,8,13,8], num:[1,2,4], pct:[3,5],
        rows: rows,
        note: 'The monthly lines cannot be added up — a guest who came in two months appears in both.' }
    ],
    notes: [
      'HOW "NEW" IS DECIDED: we read the book for ' + back + ' month' + (back===1?'':'s') + ' before your start date as well as the period itself, and a guest is NEW in a month if they appear nowhere earlier in any of it. So this says "new as far back as we looked", not "new ever". Widen the look-back in the pop-up if you need a stronger claim — it costs about 3 minutes per extra quarter.',
      'WHY WE DO NOT USE SEVENROOMS\' "GUEST SINCE" DATE, which would have been quicker: it is when the guest RECORD was created, not when they first came. Measured 31 Jul 2026 on 392 guests, 89 of the 234 who have visited exactly once carry a guest-since date earlier than that one visit, and 4 carry one later than a night we had already served them. A first-visit date cannot come after the visit, so we do not treat it as one.',
      RR_WALKIN_NOTE
    ]
  };
}

// ── 3. r-returnwindow — Came back within 30 / 60 / 90 days ────────────────
// The report we would push her towards, because every month is judged on the
// same clock. Which means a month that has not HAD 90 days yet cannot be given
// a 90-day figure — it gets "not yet" instead of a number that would look like
// bad news and would only be an artefact of the calendar.
function rrRepReturnWindow(pull, opt){
  var L = rrLedger(pull.nights);
  var today = rrToday();
  var order = [], ym = rrMonth(opt.from), endYm = rrMonth(opt.to);
  while(ym <= endYm){ order.push(ym); ym = rrMonth(rrAddDays(rrMonthEnd(ym), 1)); }
  var WINDOWS = [30, 60, 90];
  var rows = [];
  order.forEach(function(ym){
    var base = [], mEnd = rrMonthEnd(ym);
    Object.keys(L.guests).forEach(function(id){
      var g = L.guests[id];
      if(g.placeholder) return;
      // Their FIRST visit inside this month is the clock's start, so every
      // guest in the month is measured from a point inside it.
      var f = null;
      for(var i=0;i<g.dates.length;i++){ if(rrMonth(g.dates[i]) === ym){ f = g.dates[i]; break; } }
      if(f) base.push({ g:g, from:f });
    });
    var line = [rrMonthLabel(ym), base.length];
    WINDOWS.forEach(function(w){
      // Enough clock? The last guest of the month needs w days after the month
      // ends before this figure means anything.
      var need = rrAddDays(mEnd, w);
      if(need > today || need > pull.to){
        line.push(null); line.push('not yet');
        return;
      }
      var back = 0;
      base.forEach(function(b){
        var limit = rrAddDays(b.from, w);
        for(var i=0;i<b.g.dates.length;i++){
          var d = b.g.dates[i];
          if(d > b.from && d <= limit){ back++; return; }
        }
      });
      line.push(back); line.push(rrPct(back, base.length));
    });
    rows.push(line);
  });
  return {
    title: 'Came back within 30 / 60 / 90 days',
    sub: 'Every month judged on the same clock. Measured from each guest\'s first visit in that month.',
    tables: [
      { name: 'By month',
        head: ['Month','Guests who came','Back within 30 days','%','Back within 60 days','%','Back within 90 days','%'],
        widths: [22,15,17,9,17,9,17,9], num:[1,2,4,6], pct:[3,5,7],
        rows: rows,
        note: '"not yet" means that month is too recent to have had the full window. It is not a zero — a zero would read as bad news and would only be the calendar.' }
    ],
    notes: [
      'THIS IS THE HONEST VERSION of "how many guests came only once". Because every month is given the same number of days to come back, the months can be compared with each other — which the one-visit report explicitly cannot.',
      'A month only gets a figure once the whole month has had the full window. Otherwise it says "not yet". The book was read up to ' + resDateLabel(pull.to) + ' for this run.',
      'Counted from the nightly book by SevenRooms client id, counting distinct dates. A second booking on the same night is not a return visit.',
      RR_WALKIN_NOTE
    ]
  };
}

// ── 4. r-channel — Where bookings come from ───────────────────────────────
function rrRepChannel(pull, opt, money){
  var rows = rrAllRows(pull.nights, false);
  var ch = {}, order = [];
  var totB = 0, totC = 0, totG = 0, totWith = 0;
  rows.forEach(function(r){
    var k = String(r.booked_by || '').trim() || 'Not recorded';
    var c = ch[k] || (ch[k] = { k:k, bookings:0, covers:0, gross:0, heads:0, withCheck:0 });
    if(!c.bookings) order.push(k);
    c.bookings++; totB++;
    var pax = Number(r.pax)||0;
    c.covers += pax; totC += pax;
    var g = resGrossOf(r);
    if(g){ c.gross += g; c.heads += resHeads(r); c.withCheck++; totG += g; totWith++; }
  });
  order.sort(function(a,b){ return ch[b].covers - ch[a].covers; });
  var out = order.map(function(k){
    var c = ch[k];
    var line = [k, c.bookings, rrPct(c.bookings, totB), c.covers, rrPct(c.covers, totC)];
    if(money) line = line.concat([
      c.withCheck,
      c.gross ? Math.round(c.gross*100)/100 : null,
      c.gross ? Math.round(resNet(c.gross)*100)/100 : null,
      (c.gross && c.heads) ? Math.round(resNet(c.gross)/c.heads*100)/100 : null
    ]);
    return line;
  });
  var tot = ['TOTAL', totB, 100, totC, 100];
  if(money) tot = tot.concat([totWith, Math.round(totG*100)/100, Math.round(resNet(totG)*100)/100, null]);
  out.push(tot);
  var head = ['Channel','Bookings','% of bookings','Covers','% of covers'];
  var widths = [30,11,13,10,12];
  if(money){ head = head.concat(['Bookings with a check','Gross (AED)','Net (AED)','Net per guest (AED)']);
             widths = widths.concat([18,14,14,17]); }
  return {
    title: 'Where our bookings come from',
    sub: 'The channel SevenRooms recorded on each booking, exactly as it recorded it.',
    tables: [ { name:'By channel', head:head, widths:widths,
                num:[1,3].concat(money?[5]:[]), pct:[2,4], money: money?[6,7,8]:[], rows: out,
                note:'Sorted by covers. "Not recorded" is shown as its own line rather than dropped.' } ],
    notes: ['Exact — this is one clean field on the booking, nothing is interpreted or parsed.',
            'Cancellations and no-shows are NOT in these counts; this is the book that happened. For those, run the cancellation reports.'
           ].concat(money ? RR_MONEY_NOTE : [])
  };
}

// ── 5. r-walkin — Walk-in share, and whether walk-ins return ──────────────
function rrRepWalkin(pull, opt){
  var rows = rrAllRows(pull.nights, false);
  var isW = function(r){ return String(r.booked_by||'').trim().toLowerCase() === 'walk in'; };
  var months = {}, order = [];
  rows.forEach(function(r){
    var ym = rrMonth(r.date);
    if(!months[ym]){ months[ym] = { b:0, c:0, wb:0, wc:0, ph:0 }; order.push(ym); }
    var m = months[ym];
    var pax = Number(r.pax)||0;
    m.b++; m.c += pax;
    if(isW(r)){ m.wb++; m.wc += pax; if(rrIsPlaceholder(r.name)) m.ph++; }
  });
  order.sort();
  var share = order.map(function(ym){
    var m = months[ym];
    return [rrMonthLabel(ym), m.b, m.wb, rrPct(m.wb, m.b), m.c, m.wc, rrPct(m.wc, m.c), m.ph];
  });
  var T = { b:0,c:0,wb:0,wc:0,ph:0 };
  order.forEach(function(ym){ var m=months[ym]; T.b+=m.b; T.c+=m.c; T.wb+=m.wb; T.wc+=m.wc; T.ph+=m.ph; });
  share.push(['TOTAL', T.b, T.wb, rrPct(T.wb,T.b), T.c, T.wc, rrPct(T.wc,T.c), T.ph]);

  // Do they come back? Only guests we could NAME can be followed at all.
  var L = rrLedger(pull.nights);
  var wNamed = 0, wBack = 0, oNamed = 0, oBack = 0;
  Object.keys(L.guests).forEach(function(id){
    var g = L.guests[id];
    if(g.placeholder) return;
    var w = String(g.firstBookedBy||'').trim().toLowerCase() === 'walk in';
    if(w){ wNamed++; if(g.dates.length > 1) wBack++; }
    else  { oNamed++; if(g.dates.length > 1) oBack++; }
  });
  var ret = [
    ['We first met them as a walk-in', wNamed, wBack, rrPct(wBack, wNamed)],
    ['They booked ahead', oNamed, oBack, rrPct(oBack, oNamed)]
  ];
  return {
    title: 'Walk-ins — how much of the business, and do they come back',
    sub: 'A walk-in is a booking SevenRooms recorded as "Walk In".',
    tables: [
      { name:'Share of the business',
        head:['Month','Bookings','Walk-in bookings','%','Covers','Walk-in covers','%','Walk-ins with no name taken'],
        widths:[22,11,16,8,10,15,8,24], num:[1,2,4,5,7], pct:[3,6], rows: share },
      { name:'Do they come back',
        head:['How we first met them','Guests we could name','Came back at least once','%'],
        widths:[28,20,22,8], num:[1,2], pct:[3], rows: ret,
        note:'Within the dates you picked. A guest who came back after the window closed is not counted — widen the dates to catch them.' }
    ],
    notes: [
      'The SHARE is exact: it is one field on the booking.',
      'The COMING-BACK half only covers walk-ins whose name was taken. Where no name was captured SevenRooms writes a throwaway record called "Guest" with its own unique id that can never appear on a second date — the last column of the first table counts exactly those, so you can see how much of the walk-in trade is invisible.',
      '"Came back" means a second distinct date inside the dates you picked, not a second booking on the same night.'
    ]
  };
}

// ── 6. r-spendguest — Spend per guest by night, area or shift ─────────────
function rrRepSpendGuest(pull, opt, money){
  if(!money){
    return { title:'Spend per guest', sub:'', tables:[],
             notes:['This report is money, and your access does not include Revenue. Ask Francesco to tick Revenue in Admin → Users & Access if you need it.'] };
  }
  var rows = rrAllRows(pull.nights, false);
  function group(keyOf, label, widths){
    var g = {}, order = [];
    rows.forEach(function(r){
      var k = keyOf(r);
      if(k == null) return;
      var b = g[k] || (g[k] = { k:k, bookings:0, covers:0, withCheck:0, heads:0, gross:0 });
      if(b.bookings === 0) order.push(k);
      b.bookings++; b.covers += Number(r.pax)||0;
      var gr = resGrossOf(r);
      if(gr){ b.withCheck++; b.heads += resHeads(r); b.gross += gr; }
    });
    order.sort();
    var T = { bookings:0, covers:0, withCheck:0, heads:0, gross:0 };
    var out = order.map(function(k){
      var b = g[k];
      T.bookings+=b.bookings; T.covers+=b.covers; T.withCheck+=b.withCheck; T.heads+=b.heads; T.gross+=b.gross;
      return [b.k, b.bookings, b.covers, b.withCheck, rrPct(b.withCheck, b.bookings),
              b.gross ? Math.round(b.gross*100)/100 : null,
              b.gross ? Math.round(resNet(b.gross)*100)/100 : null,
              (b.gross && b.heads) ? Math.round(b.gross/b.heads*100)/100 : null,
              (b.gross && b.heads) ? Math.round(resNet(b.gross)/b.heads*100)/100 : null];
    });
    out.push(['TOTAL', T.bookings, T.covers, T.withCheck, rrPct(T.withCheck, T.bookings),
              Math.round(T.gross*100)/100, Math.round(resNet(T.gross)*100)/100,
              T.heads ? Math.round(T.gross/T.heads*100)/100 : null,
              T.heads ? Math.round(resNet(T.gross)/T.heads*100)/100 : null]);
    return { name: label,
      head: [label.replace(/^By /,'').replace(/^./,function(c){return c.toUpperCase();}),
             'Bookings','Covers','With a check','% with a check','Gross (AED)','Net (AED)','Gross per guest (AED)','Net per guest (AED)'],
      widths: widths, num:[1,2,3], pct:[4], money:[5,6,7,8], rows: out,
      note:'Per-guest figures divide by the guests on the bookings that carry a check — not by all covers, which would drag the average down by the tables we have no check for.' };
  }
  return {
    title: 'Spend per guest',
    sub: 'By night, by seating area and by shift. The per-guest average is the figure to use.',
    tables: [
      group(function(r){ return r.date; }, 'By night', [13,11,10,13,15,14,14,19,19]),
      group(function(r){ return r.area || 'No area set'; }, 'By area', [22,11,10,13,15,14,14,19,19]),
      group(function(r){ return r.shift || 'No shift set'; }, 'By shift', [18,11,10,13,15,14,14,19,19])
    ],
    notes: RR_MONEY_NOTE.concat([
      'The "% with a check" column is the one to read before quoting any total on that line. It is how much of that night, room or shift the money actually covers.',
      'We are closed Sundays. A "per day" average has to divide by trading days, not calendar days.'
    ])
  };
}

// ── 7. r-topguests — Top guests by lifetime value ─────────────────────────
function rrRepTopGuests(pull, opt, money){
  if(!money){
    return { title:'Top guests by lifetime value', sub:'', tables:[],
             notes:['This report is money, and your access does not include Revenue. Ask Francesco to tick Revenue in Admin → Users & Access if you need it.'] };
  }
  var L = rrLedger(pull.nights);
  var sortBy = opt.sortBy || 'spend';
  var limit = Number(opt.limit) || 100;
  var list = [], noProfile = 0;
  Object.keys(L.guests).forEach(function(id){
    var g = L.guests[id];
    if(g.placeholder) return;
    var p = rrProf(id);
    if(!p){ noProfile++; return; }
    list.push({ name:g.name, p:p, seen:g.dates.length });
  });
  list.sort(function(a,b){
    var k = sortBy==='visits' ? 'visits' : (sortBy==='per_visit' ? 'per_visit' : 'spend');
    return (Number(b.p[k])||0) - (Number(a.p[k])||0);
  });
  var rows = list.slice(0, limit).map(function(x, i){
    return [i+1, x.name,
      Number(x.p.visits)||null, Number(x.p.covers)||null,
      Number(x.p.spend)>0 ? Math.round(x.p.spend*100)/100 : null,
      Number(x.p.per_cover)>0 ? Math.round(x.p.per_cover*100)/100 : null,
      Number(x.p.per_visit)>0 ? Math.round(x.p.per_visit*100)/100 : null,
      x.p.last_visit ? String(x.p.last_visit).slice(0,10) : '',
      x.seen];
  });
  return {
    title: 'Top guests by lifetime value',
    sub: 'Ranked by ' + (sortBy==='visits' ? 'visits' : sortBy==='per_visit' ? 'average per visit' : 'lifetime spend')
       + '. SevenRooms\' own figures for this venue, passed through untouched.',
    tables: [ { name:'Top guests',
      head:['#','Guest','Lifetime visits','Lifetime covers','Lifetime spend (AED, net)','Net per cover (AED)','Net per visit (AED)','Last visit','Nights in this window'],
      widths:[5,28,13,14,20,17,17,12,18], num:[0,2,3,8], money:[4,5,6], rows: rows,
      note:'Everyone on this list is a guest who came at least once in the dates you picked. The lifetime figures beside them are their WHOLE history, not this window.' } ],
    notes: [
      'These are SevenRooms\' own numbers for this venue, exactly as its profile page shows them, so they match what the hosts see. They are NET.',
      'DO NOT DIVIDE ONE BY ANOTHER. SevenRooms works its per-cover and per-visit figures out on its own basis and they do not reconcile to its own total — measured across 3,463 guests, 438 of them (12.6%) fail to multiply back. Read each column as given.',
      'Lifetime GROSS is deliberately not here: SevenRooms\' lifetime gross-to-net ratio wanders between 1.00 and 1.28 across guests, so it is a different basis to the per-booking gross elsewhere in this app, and two columns both called "gross" in one report is how a number gets quoted wrongly.',
      noProfile ? (noProfile + ' guest' + (noProfile===1?'':'s') + ' in this window could not be read from SevenRooms and are not on the list.') : 'Every guest in this window was read from SevenRooms.'
    ]
  };
}

// ── 8. r-lapsed — Lapsed regulars, win-back list ──────────────────────────
function rrRepLapsed(pull, opt, money){
  var minVisits = Number(opt.minVisits) || 5;
  var weeks = Number(opt.weeks) || 12;
  var today = rrToday();
  var cutoff = rrAddDays(today, -weeks*7);
  var L = rrLedger(pull.nights);
  var list = [], noProfile = 0;
  Object.keys(L.guests).forEach(function(id){
    var g = L.guests[id];
    if(g.placeholder) return;
    var p = rrProf(id);
    if(!p){ noProfile++; return; }
    if((Number(p.visits)||0) < minVisits) return;
    var lv = p.last_visit ? String(p.last_visit).slice(0,10) : '';
    if(!lv || lv >= cutoff) return;
    list.push({ name:g.name, p:p, lv:lv });
  });
  list.sort(function(a,b){ return (Number(b.p.visits)||0) - (Number(a.p.visits)||0); });
  var rows = list.map(function(x, i){
    var line = [i+1, x.name, Number(x.p.visits)||null, Number(x.p.covers)||null,
                x.lv, Math.round(rrDaysBetween(x.lv, today)/7)];
    if(money) line = line.concat([
      Number(x.p.spend)>0 ? Math.round(x.p.spend*100)/100 : null,
      Number(x.p.per_visit)>0 ? Math.round(x.p.per_visit*100)/100 : null
    ]);
    return line;
  });
  var head = ['#','Guest','Lifetime visits','Lifetime covers','Last visit','Weeks since'];
  var widths = [5,28,13,14,12,12];
  if(money){ head = head.concat(['Lifetime spend (AED, net)','Net per visit (AED)']); widths = widths.concat([20,17]); }
  return {
    title: 'Lapsed regulars',
    sub: 'At least ' + minVisits + ' visits, and not in for more than ' + weeks + ' weeks.',
    tables: [ { name:'Win-back list', head:head, widths:widths, num:[0,2,3,5], money: money?[6,7]:[], rows: rows,
      note:'Ordered by how much of a regular they were. This is the list you would run a campaign from.' } ],
    notes: [
      'HOW THE LIST IS FOUND: we read the book for the dates you picked, take every named guest who appears, then keep the ones SevenRooms says have at least ' + minVisits + ' lifetime visits and have not been in since ' + resDateLabel(cutoff) + '.',
      'That means the dates you pick should be a period they WERE coming — a historic window. Pick the last few months and you will mostly find people who are not lapsed at all. The pop-up defaults to a window that already ended.',
      'Visits and last-visit both come from the guest profile untouched, so they match the SevenRooms page the hosts read.',
      noProfile ? (noProfile + ' guest' + (noProfile===1?'':'s') + ' in this window could not be read from SevenRooms and could not be tested.') : 'Every guest in this window was read from SevenRooms.',
      'This report holds guest names. It carries no email, no address and no phone number — those never leave SevenRooms.'
    ]
  };
}

// ── 9. r-vip — VIP bookings ───────────────────────────────────────────────
function rrRepVip(pull, opt){
  var rows = rrAllRows(pull.nights, false);
  var months = {}, order = [], areas = {}, aOrder = [];
  var tB=0, tV=0, tC=0, tVC=0;
  rows.forEach(function(r){
    var ym = rrMonth(r.date), pax = Number(r.pax)||0;
    var m = months[ym] || (months[ym] = { b:0, v:0, c:0, vc:0 });
    if(order.indexOf(ym)===-1) order.push(ym);
    m.b++; m.c += pax; tB++; tC += pax;
    var ak = r.area || 'No area set';
    var a = areas[ak] || (areas[ak] = { b:0, v:0, c:0, vc:0 });
    if(aOrder.indexOf(ak)===-1) aOrder.push(ak);
    a.b++; a.c += pax;
    if(r.vip){ m.v++; m.vc += pax; a.v++; a.vc += pax; tV++; tVC += pax; }
  });
  order.sort(); aOrder.sort();
  var byMonth = order.map(function(ym){
    var m = months[ym];
    return [rrMonthLabel(ym), m.b, m.v, rrPct(m.v, m.b), m.c, m.vc, rrPct(m.vc, m.c)];
  });
  byMonth.push(['TOTAL', tB, tV, rrPct(tV, tB), tC, tVC, rrPct(tVC, tC)]);
  var byArea = aOrder.map(function(k){
    var a = areas[k];
    return [k, a.b, a.v, rrPct(a.v, a.b), a.c, a.vc];
  });
  var list = rows.filter(function(r){ return r.vip; })
    .map(function(r){
      return [r.date, resWeekday(r.date), r.time||'', r.name||'', Number(r.pax)||0,
              r.area||'', (r.tables||[]).join(', '), r.booked_by||'', r.status_display||r.status||''];
    });
  return {
    title: 'VIP bookings',
    sub: 'The VIP flag as SevenRooms carries it on the booking.',
    tables: [
      { name:'By month', head:['Month','Bookings','VIP bookings','%','Covers','VIP covers','%'],
        widths:[22,11,14,8,10,12,8], num:[1,2,4,5], pct:[3,6], rows: byMonth },
      { name:'By area', head:['Seating area','Bookings','VIP bookings','%','Covers','VIP covers'],
        widths:[24,11,14,8,10,12], num:[1,2,4,5], pct:[3], rows: byArea },
      { name:'Every VIP booking', head:['Date','Day','Time','Guest','Covers','Seating area','Table','Booked by','Status'],
        widths:[13,12,8,26,9,20,14,22,16], num:[4], rows: list }
    ],
    notes: [
      'Exact AS A COUNT OF THE FLAG. What it reports is who was FLAGGED in SevenRooms, which is only as good as the flagging — a VIP nobody ticked does not appear here.',
      'This is the SevenRooms flag only. It is not the "possible public figure" name match on the Reservations screen, which is a different thing and deliberately never says "VIP" on its own.'
    ]
  };
}

// ── 10. r-cancellations — the list ────────────────────────────────────────
function rrRepCancellations(pull, opt){
  var rows = rrAllRows(pull.nights, true).filter(rrIsGone);
  var out = rows.map(function(r){
    var lead = r.created ? rrDaysBetween(String(r.created).slice(0,10), r.date) : null;
    return [r.date, resWeekday(r.date), r.time||'',
            r.state==='noshow' ? 'No show' : 'Cancelled',
            r.name||'', Number(r.pax)||0, r.area||'', (r.tables||[]).join(', '),
            r.booked_by||'', r.phone_last4 ? '••• '+r.phone_last4 : '',
            String(r.created||'').slice(0,10), lead];
  });
  var ns = rows.filter(function(r){ return r.state==='noshow'; }).length;
  var cx = rows.length - ns;
  var nn = Object.keys(pull.nights).length;
  return {
    title: 'Cancellations and no-shows',
    sub: ns + ' no-show' + (ns===1?'':'s') + ' and ' + cx + ' cancellation' + (cx===1?'':'s')
       + ' over ' + nn + ' night' + (nn===1?'':'s') + '.',
    tables: [ { name:'The list',
      head:['Date','Day','Time','What happened','Guest','Covers','Seating area','Table','Booked by','Phone','Booked on','Days ahead'],
      widths:[13,12,8,15,26,9,20,14,22,12,12,11], num:[5,11], rows: out,
      note:'Sorted by night, then by the time the table was due.' } ],
    notes: [
      'This is the same list SevenRooms shows you. Reconciled against its own screen on 30 July 2026: the feed sent 55 bookings for that night — 45 completed, 8 no-shows and 2 cancellations — which is exactly what the SevenRooms screen showed.',
      'Until 31 July 2026 the app threw these rows away before they reached any screen, because the Reservations book was built to show tonight\'s service. Nothing was ever missing from SevenRooms. That filter is now optional and this report asks for them.',
      'Phone is the last four digits only. The full number, the email and the address are never sent to this app at all.',
      '"Days ahead" is how long before the night the booking was made. It is on every booking — checked on all 4,201 bookings in a quarter, none missing.'
    ]
  };
}

// ── 11. r-noshowrate — the rate, and whether one channel is worse ─────────
function rrRepNoShowRate(pull, opt){
  var all = rrAllRows(pull.nights, true);
  // `fixedOrder` is for the bands that have a natural reading order — party size
  // and lead time. Sorting those by volume would print "8-30 days, same day,
  // 2-7 days" and make a trend impossible to see. Everything else sorts by
  // volume, biggest first, because that is the one you act on.
  function bucket(keyOf, label, fixedOrder){
    var g = {}, order = [];
    all.forEach(function(r){
      var k = keyOf(r);
      if(k == null) return;
      if(!g[k]){ g[k] = { k:k, total:0, ns:0, cx:0 }; order.push(k); }
      var b = g[k];
      b.total++;
      if(r.state==='noshow') b.ns++;
      else if(r.state==='cancelled') b.cx++;
    });
    if(fixedOrder) order.sort(function(a,b){ return fixedOrder.indexOf(a) - fixedOrder.indexOf(b); });
    else order.sort(function(a,b){ return g[b].total - g[a].total; });
    var T = { total:0, ns:0, cx:0 };
    var rows = order.map(function(k){
      var b = g[k];
      T.total+=b.total; T.ns+=b.ns; T.cx+=b.cx;
      return [b.k, b.total, b.ns, rrPct(b.ns, b.total), b.cx, rrPct(b.cx, b.total),
              rrPct(b.ns+b.cx, b.total)];
    });
    rows.push(['TOTAL', T.total, T.ns, rrPct(T.ns,T.total), T.cx, rrPct(T.cx,T.total), rrPct(T.ns+T.cx,T.total)]);
    return { name:label,
      head:[label.replace(/^By /,'').replace(/^./,function(c){return c.toUpperCase();}),
            'Bookings made','No-shows','No-show %','Cancelled','Cancelled %','Both %'],
      widths:[28,14,11,11,11,12,10], num:[1,2,4], pct:[3,5,6], rows: rows,
      note:'"Bookings made" is everything SevenRooms holds for that line — the tables that came, the ones that cancelled and the ones that did not turn up. That is the only denominator a rate can honestly use.' };
  }
  // A party size of 0 is real — SevenRooms carries it on some walk-in and bar
  // rows. It gets its OWN band rather than being dropped: 113 of the 5,460
  // bookings in the May–July quarter are like this, and silently binning them
  // made the party-size table total 113 short of every other table on the same
  // report, which is exactly how someone stops trusting a page.
  function paxBand(n){
    n = Number(n)||0;
    if(n<=0) return 'Not recorded';
    if(n<=2) return '1–2';
    if(n<=4) return '3–4';
    if(n<=6) return '5–6';
    if(n<=10) return '7–10';
    return '11+';
  }
  function leadBand(r){
    if(!r.created) return 'Not recorded';
    var d = rrDaysBetween(String(r.created).slice(0,10), r.date);
    if(d <= 0) return 'Same day';
    if(d === 1) return 'Day before';
    if(d <= 7) return '2–7 days';
    if(d <= 30) return '8–30 days';
    return 'Over a month';
  }
  return {
    title: 'No-show and cancellation rate',
    sub: 'Counted off the nightly book, by month, channel, party size and how far ahead the booking was made.',
    tables: [
      // Months read in date order or a trend is invisible. Everything else
      // sorts biggest-first, which is what you act on.
      bucket(function(r){ return rrMonthLabel(rrMonth(r.date)); }, 'By month', rrMonthsIn(all)),
      bucket(function(r){ return String(r.booked_by||'').trim() || 'Not recorded'; }, 'By channel'),
      bucket(function(r){ return paxBand(r.pax); }, 'By party size',
             ['1–2','3–4','5–6','7–10','11+','Not recorded']),
      bucket(leadBand, 'By how far ahead it was booked',
             ['Same day','Day before','2–7 days','8–30 days','Over a month','Not recorded'])
    ],
    notes: [
      'Exact, because we count the nights ourselves. Every figure here can be checked against the SevenRooms screen for any single night.',
      'WHAT WE WILL NOT USE, and you should know why: SevenRooms keeps its own lifetime no-show counter on each guest record, and it is provably wrong. Of 440 guests carrying no-shows, 9 have MORE no-shows than they have visits — one shows 31 against 17 visits. So this report never reads that field. It counts the nights, which is checkable.',
      'BEFORE TAKING A CHANNEL NUMBER TO A PARTNER: look at the "Bookings made" column first. A channel with 12 bookings and 3 no-shows is 25%, and it is also noise. A rate is worth acting on when the volume behind it is.',
      'A booking can be cancelled for reasons that are nothing to do with the channel, so the two columns are kept apart rather than added into one "did not happen" number.'
    ]
  };
}

// ══════════════════════════════════════════════════════════════════════════
// THE CATALOGUE
// One entry per report Nicole ticked. `needs` says what has to be pulled, so
// the runner never fetches 90 nights of guest profiles for a report that does
// not use them.
//   days      how the pull window is worked out from her dates
//   profiles  true if the report reads the SevenRooms guest record
//   gone      true if the report needs the cancellations and no-shows
//   money     true if the whole report is money and is hidden without Revenue
// ══════════════════════════════════════════════════════════════════════════
var RR_REPORTS = [
  { id:'onevisit', qkey:'r-onevisit', name:'Guests who came only once',
    blurb:'By month, with the honest warning about why the months are not comparable.',
    profiles:true, run:rrRepOneVisit },
  { id:'newreturning', qkey:'r-newreturning', name:'New vs returning guests',
    blurb:'Per month, split into first-time and returning, over a look-back you choose.',
    lookback:true, run:rrRepNewReturning },
  { id:'returnwindow', qkey:'r-returnwindow', name:'Came back within 30 / 60 / 90 days',
    blurb:'The one to use when you want months compared fairly. Every month on the same clock.',
    followUp:90, run:rrRepReturnWindow },
  { id:'channel', qkey:'r-channel', name:'Where bookings come from',
    blurb:'Every booking channel, by bookings and covers.',
    money:'optional', run:rrRepChannel },
  { id:'walkin', qkey:'r-walkin', name:'Walk-ins — share, and do they come back',
    blurb:'How much of the business walks in, and whether the ones we named return.',
    run:rrRepWalkin },
  { id:'spendguest', qkey:'r-spendguest', name:'Spend per guest',
    blurb:'By night, area and shift. The per-guest average is the reliable figure.',
    money:true, run:rrRepSpendGuest },
  { id:'topguests', qkey:'r-topguests', name:'Top guests by lifetime value',
    blurb:'Ranked by lifetime spend, visits or average per visit.',
    profiles:true, money:true, sortable:true, run:rrRepTopGuests },
  { id:'lapsed', qkey:'r-lapsed', name:'Lapsed regulars — win-back list',
    blurb:'Regulars above a visit count you set who have not been in for weeks.',
    profiles:true, lapsed:true, money:'optional', run:rrRepLapsed },
  { id:'vip', qkey:'r-vip', name:'VIP bookings',
    blurb:'How many VIPs we hosted, by month and by room, plus every booking.',
    run:rrRepVip },
  { id:'cancellations', qkey:'r-cancellations', name:'Cancellations and no-shows',
    blurb:'The full list — who, when, how many, and which channel they came from.',
    gone:true, run:rrRepCancellations },
  { id:'noshowrate', qkey:'r-noshowrate', name:'No-show and cancellation rate',
    blurb:'By month, channel, party size and lead time. Is one channel worse than the others?',
    gone:true, run:rrRepNoShowRate }
];
function rrReport(id){
  for(var i=0;i<RR_REPORTS.length;i++) if(RR_REPORTS[i].id === id) return RR_REPORTS[i];
  return null;
}

// ══════════════════════════════════════════════════════════════════════════
// STATE + THE RUNNER
// ══════════════════════════════════════════════════════════════════════════
var RR = {
  pick: null,          // which report the pop-up is configuring
  from: '', to: '',
  lookback: 3, minVisits: 5, weeks: 12, sortBy: 'spend', limit: 100,
  open: false,         // pop-up showing
  busy: false, done: 0, total: 0, note: '',
  result: null,        // { report, built, from, to, out, failed }
  err: ''
};

// Whole calendar months, which is what every one of these reports is actually
// about, and the commonest mistake in any report is an off-by-one date range.
// `n` whole months ending `skip` months before this one. skip=0 ends with last
// month; skip=3 ends three months further back, which is what the lapsed list
// needs — a window people were still coming in.
function rrIsoOf(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function rrLastFullMonths(n, skip){
  var t = new Date(rrToday()+'T12:00:00');
  var end = new Date(t.getFullYear(), t.getMonth() - (Number(skip)||0), 0);   // last day of that month
  var start = new Date(end.getFullYear(), end.getMonth()-(n-1), 1);
  return { from: rrIsoOf(start), to: rrIsoOf(end) };
}

function rrOpen(id){
  var r = rrReport(id);
  if(!r) return;
  RR.pick = id; RR.open = true; RR.err = ''; RR.busy = false; RR.done = 0; RR.total = 0;
  // Lapsed regulars looks for people who have STOPPED coming, so the window has
  // to be a period they were still coming in. Defaulting it to the last three
  // months would hand her a list of people who are not lapsed at all — most of
  // them were in last week. Three months, ending three months ago.
  var d = r.lapsed ? rrLastFullMonths(3, 3) : rrLastFullMonths(3);
  RR.from = d.from; RR.to = d.to;
  rrPaint();
}
function rrClose(){ if(RR.busy) return; RR.open = false; rrPaint(); }
function rrSet(k, v){ RR[k] = v; RR.err = ''; rrPaint(); }

// The nights a report actually has to read, from the dates she picked.
function rrPullWindow(rep, from, to){
  var f = from, t = to;
  if(rep.lookback){
    var d = new Date(from+'T12:00:00');
    d.setMonth(d.getMonth() - (Number(RR.lookback)||3));
    f = d.toISOString().slice(0,10);
  }
  if(rep.followUp){
    // Read past the end so "did they come back within 90 days" has something to
    // find. Never past today: there is no book for a night that hasn't happened.
    var t2 = rrAddDays(to, rep.followUp), today = rrToday();
    t = t2 > today ? today : t2;
  }
  return { from: f, to: t };
}

async function rrRun(show){
  if(RR.busy) return;
  var rep = rrReport(RR.pick);
  if(!rep) return;
  if(!RR.from || !RR.to || RR.from > RR.to){ RR.err = 'The "from" date is after the "to" date.'; rrPaint(); return; }
  var money = !fohBlocked('revenue');
  var win = rrPullWindow(rep, RR.from, RR.to);
  var dates = rrDates(win.from, win.to);
  if(!dates.length){ RR.err = 'Pick a from and a to date.'; rrPaint(); return; }

  RR.busy = true; RR.err = ''; RR.done = 0; RR.total = dates.length;
  RR.note = 'Reading the book…';
  rrPaint();
  try{
    var pulled = await rrPull(dates, function(done, total, d){
      RR.done = done; RR.note = 'Reading ' + resDateLabel(d);
      rrPaint();
    });
    if(!Object.keys(pulled.nights).length){
      RR.err = 'None of those nights could be read from SevenRooms. Nothing was built.';
      return;
    }
    // The echo check — see rrFetchNight. A report about cancellations built on a
    // feed that is still filtering them would print zeros and read as good news.
    if(rep.gone && RRN.ok !== true){
      RR.err = 'The SevenRooms connection is not sending us the cancellations and no-shows yet, so this report would show zero and that would be a lie. Nothing was built. Tell Francesco: the sevenrooms-sync function needs its 31 July version.';
      return;
    }
    if(rep.profiles){
      RR.note = 'Reading guest histories…';
      rrPaint();
      var L = rrLedger(pulled.nights);
      var ids = Object.keys(L.guests).filter(function(id){ return !L.guests[id].placeholder; });
      await rrProfiles(ids, rrVenueOf(pulled.nights), function(done, total){
        RR.note = 'Reading guest histories… ' + done + ' of ' + total;
        rrPaint();
      });
    }
    RR.note = 'Working it out…';
    rrPaint();
    var pull = { nights: pulled.nights, failed: pulled.failed, from: win.from, to: win.to };
    var out = rep.run(pull, {
      from: RR.from, to: RR.to, lookback: RR.lookback,
      minVisits: RR.minVisits, weeks: RR.weeks, sortBy: RR.sortBy, limit: RR.limit
    }, money);
    RR.result = {
      rep: rep, out: out, money: money,
      from: RR.from, to: RR.to, pullFrom: win.from, pullTo: win.to,
      nights: Object.keys(pulled.nights).length,
      failed: pulled.failed, built: new Date()
    };
    if(show){ RR.open = false; }
    else { await rrExcel(); RR.open = false; }
  }catch(e){
    console.warn('[resreports] run failed', e);
    RR.err = 'Could not build that: ' + ((e && e.message) ? e.message : e) + '. Nothing on screen has changed.';
  }finally{
    RR.busy = false;
    rrPaint();
    if(typeof renderMain === 'function' && state.currentTab === 'resreports') renderMain();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// EXCEL — branded, and using the SAME palette and helpers as the Reservations
// export so the two files look like they came from one company (f-excel).
// ══════════════════════════════════════════════════════════════════════════
function rrXlSheet(wb, C, name, t, subText){
  // Excel refuses a tab name over 31 characters or carrying : \ / ? * [ ]
  var tab = String(name).replace(/[:\\\/\?\*\[\]]/g,' ').slice(0,31);
  var ws = wb.addWorksheet(tab, {
    views: [{ state:'frozen', ySplit:4 }],
    pageSetup: { orientation:'landscape', fitToPage:true, fitToWidth:1 }
  });
  var head = t.head, n = head.length;
  ws.columns = head.map(function(h, i){ return { width: (t.widths && t.widths[i]) || 14 }; });

  var title = ws.addRow(["ROBERTO'S DIFC  —  " + (t.reportTitle || name)]);
  title.height = 34; ws.mergeCells(title.number, 1, title.number, n);
  title.getCell(1).style = {
    font:{bold:true, size:16, color:{argb:'FF'+C.SABBIA}, name:'Calibri'},
    fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C.VINO}},
    alignment:{horizontal:'center', vertical:'middle'}
  };
  var sub = ws.addRow([subText]);
  sub.height = 18; ws.mergeCells(sub.number, 1, sub.number, n);
  sub.getCell(1).style = {
    font:{size:9, italic:true, color:{argb:'FF'+C.VINO}, name:'Calibri'},
    fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C.SABBIA}},
    alignment:{horizontal:'center', vertical:'middle'}
  };
  ws.addRow([]);

  var hdr = ws.addRow(head);
  hdr.height = 30;
  hdr.eachCell(function(cell){
    cell.style = {
      font:{bold:true, size:9, color:{argb:'FF'+C.SABBIA}, name:'Calibri'},
      fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C.VINO}},
      alignment:{horizontal:'center', vertical:'middle', wrapText:true},
      border: resXlBorder(C.GOLD)
    };
  });
  var headerRowNo = hdr.number;
  var isMoney = {}, isPct = {}, isNum = {};
  (t.money||[]).forEach(function(i){ isMoney[i] = 1; });
  (t.pct||[]).forEach(function(i){ isPct[i] = 1; });
  (t.num||[]).forEach(function(i){ isNum[i] = 1; });
  // A header that says (AED) is money whether or not the report remembered to
  // list it — one rule, so a new column can't silently print 127.35000000001.
  head.forEach(function(h, i){ if(/\(AED/.test(h)) isMoney[i] = 1; if(/^%|%$/.test(h)) isPct[i] = 1; });

  (t.rows||[]).forEach(function(r, i){
    var isTotal = String(r[0]||'').indexOf('TOTAL') === 0 || String(r[0]||'').indexOf('WHOLE WINDOW') === 0;
    var row = ws.addRow(r);
    row.height = 15;
    row.eachCell({includeEmpty:true}, function(cell, ci){
      var c = ci - 1;
      cell.style = isTotal ? {
        font:{bold:true, size:9.5, color:{argb:'FF'+C.SABBIA}, name:'Calibri'},
        fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C.VINO}},
        border: resXlBorder(C.GOLD),
        alignment:{horizontal: (isMoney[c]||isPct[c]||isNum[c]) ? 'right' : 'left', vertical:'middle'}
      } : {
        font:{size:9, name:'Calibri', color:{argb:'FF'+C.DARK}},
        fill: (i % 2 === 1) ? {type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C.LIGHT}} : undefined,
        border: resXlBorder('E2D9C9', 'hair'),
        alignment:{ vertical:'top', horizontal: isMoney[c] ? 'right' : (isPct[c]||isNum[c] ? 'center' : 'left') }
      };
      if(isMoney[c]) cell.numFmt = '#,##0.00';
      else if(isPct[c]) cell.numFmt = '0.0';
      else if(isNum[c]) cell.numFmt = '0';
    });
  });
  if((t.rows||[]).length){
    ws.autoFilter = { from:{row:headerRowNo, column:1}, to:{row:headerRowNo + t.rows.length, column:n} };
  }
  if(t.note){
    ws.addRow([]);
    var nr = ws.addRow(['', t.note]);
    ws.mergeCells(nr.number, 2, nr.number, Math.max(2, n));
    nr.getCell(2).style = { font:{size:9, italic:true, name:'Calibri', color:{argb:'FF'+C.DARK}},
                            alignment:{vertical:'top', wrapText:true} };
    nr.height = 26;
  }
  return ws;
}

// The Read-me sheet. It is FIRST in the workbook and it is not decoration: a
// file travels. It gets mailed on, pasted into a deck and read by somebody who
// never saw the screen and has no idea which figures can be added up. Every
// caveat the screen shows goes in here, in the same words.
function rrXlReadme(wb, C, R){
  var ws = wb.addWorksheet('Read me first', { pageSetup:{orientation:'portrait', fitToPage:true, fitToWidth:1} });
  ws.columns = [{width:30},{width:96}];
  var t = ws.addRow(["ROBERTO'S DIFC  —  " + R.out.title]);
  t.height = 30; ws.mergeCells(t.number,1,t.number,2);
  t.getCell(1).style = {
    font:{bold:true, size:14, color:{argb:'FF'+C.SABBIA}, name:'Calibri'},
    fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C.VINO}},
    alignment:{horizontal:'center', vertical:'middle'}
  };
  ws.addRow([]);
  var facts = [
    ['Report', R.out.title],
    ['Period', resDateLabel(R.from) + '  to  ' + resDateLabel(R.to)],
    ['Nights read', R.nights],
    ['Book read', resDateLabel(R.pullFrom) + '  to  ' + resDateLabel(R.pullTo)],
    ['Built', R.built.toLocaleString('en-GB')],
    ['Source', 'The SevenRooms nightly book, one call per night. There is no other source and no stored copy.']
  ];
  if(!R.money) facts.push(['Money columns', 'Hidden — your access does not include Revenue.']);
  facts.forEach(function(f){
    var r = ws.addRow(f);
    r.getCell(1).style = { font:{bold:true, size:9.5, color:{argb:'FF'+C.VINO}, name:'Calibri'}, alignment:{vertical:'top'} };
    r.getCell(2).style = { font:{size:9.5, name:'Calibri', color:{argb:'FF'+C.DARK}}, alignment:{vertical:'top', wrapText:true} };
  });
  ws.addRow([]);
  var b = ws.addRow(['READ THIS BEFORE USING THE NUMBERS']);
  b.height = 22; ws.mergeCells(b.number, 1, b.number, 2);
  b.getCell(1).style = {
    font:{bold:true, size:10, color:{argb:'FF'+C.SABBIA}, name:'Calibri'},
    fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF8C2F1E'}},
    alignment:{horizontal:'left', vertical:'middle', indent:1}
  };
  (R.out.notes||[]).forEach(function(n){
    var r = ws.addRow(['', n]);
    ws.mergeCells(r.number, 2, r.number, 2);
    r.getCell(2).style = { font:{size:9.5, italic:true, name:'Calibri', color:{argb:'FF'+C.DARK}},
                           alignment:{vertical:'top', wrapText:true} };
    r.height = Math.min(60, 14 + Math.floor(String(n).length / 90) * 13);
  });
  // Nights that could not be read are NAMED. Never silent — a missing night in
  // a report that goes upstairs is worse than no report.
  if(R.failed && R.failed.length){
    ws.addRow([]);
    var p = ws.addRow(['NIGHTS THAT COULD NOT BE READ — they are NOT in this file']);
    p.height = 22; ws.mergeCells(p.number, 1, p.number, 2);
    p.getCell(1).style = {
      font:{bold:true, size:10, color:{argb:'FF'+C.SABBIA}, name:'Calibri'},
      fill:{type:'pattern', pattern:'solid', fgColor:{argb:'FF8C2F1E'}},
      alignment:{horizontal:'left', vertical:'middle', indent:1}
    };
    R.failed.forEach(function(f){
      var r = ws.addRow([f.date, f.why]);
      r.getCell(1).style = { font:{bold:true, size:9.5, color:{argb:'FF'+C.VINO}, name:'Calibri'} };
      r.getCell(2).style = { font:{size:9.5, italic:true, name:'Calibri', color:{argb:'FF'+C.DARK}} };
    });
  }
  return ws;
}

async function rrExcel(){
  var R = RR.result;
  if(!R || !R.out || !R.out.tables.length){ toast('Nothing to download yet — run the report first.', true); return; }
  try{
    await resLoadExcelJS();
    var C = RES_XL;
    var wb = new ExcelJS.Workbook();
    wb.creator = "Roberto's DIFC"; wb.created = new Date();
    rrXlReadme(wb, C, R);
    var sub = resDateLabel(R.from) + '  to  ' + resDateLabel(R.to)
      + '   |   ' + R.nights + ' night' + (R.nights===1?'':'s') + ' read'
      + '   |   built ' + R.built.toLocaleString('en-GB');
    R.out.tables.forEach(function(t){
      t.reportTitle = R.out.title;
      rrXlSheet(wb, C, t.name, t, sub);
    });
    var buf = await wb.xlsx.writeBuffer();
    var blob = new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = "Roberto's " + R.out.title + ' ' + R.from + ' to ' + R.to + '.xlsx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
  }catch(e){
    console.warn('[resreports] excel failed', e);
    toast('Could not build the Excel file: ' + ((e && e.message) ? e.message : e), true);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// THE POP-UP (f-popup, first half of her answer)
// Reuses the .rg-ov / .rg-card overlay shell the guest panel and the date-range
// dialog already use, so it looks like part of the app rather than a bolt-on.
// ══════════════════════════════════════════════════════════════════════════
function rrEl(){
  var el = document.getElementById('rr-pop');
  if(!el){
    el = document.createElement('div');
    el.id = 'rr-pop';
    document.body.appendChild(el);
    // Backdrop closes it, but never mid-run — a half-read quarter thrown away
    // by a stray tap is exactly the small cruelty that stops people using a
    // feature.
    el.addEventListener('click', function(e){ if(e.target === el && !RR.busy) rrClose(); });
  }
  return el;
}
function rrPaint(){
  var el = rrEl();
  el.innerHTML = RR.open ? rrPopHtml() : '';
  el.className = RR.open ? 'rg-ov' : '';
}
if(!window._rrKey){
  window._rrKey = true;
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && RR.open && !RR.busy) rrClose();
  });
  // The pop-up lives on <body>, so it would outlive a tab change and hang over
  // an unrelated screen. Same sweep the guest panel uses.
  window._rrSweep = setInterval(function(){
    if(RR.open && !RR.busy && state && state.currentTab !== 'resreports') rrClose();
  }, 400);
}

function rrPopHtml(){
  var rep = rrReport(RR.pick);
  if(!rep) return '';
  var win = rrPullWindow(rep, RR.from, RR.to);
  var nights = rrDates(win.from, win.to).length;
  var mins = Math.max(1, Math.round(nights * 7 / RR_PARALLEL / 60 * 10) / 10);
  var bad = (RR.from && RR.to && RR.from > RR.to) ? 'The "from" date is after the "to" date.' : '';

  var h = ['<div class="rg-card rr-card" role="dialog" aria-modal="true" aria-label="Run a report">'];
  h.push('<div class="rg-head"><div>');
  h.push('<div class="rg-kicker">Reservation reports</div>');
  h.push('<div class="rg-name">'+resEsc(rep.name)+'</div></div>');
  if(!RR.busy) h.push('<button class="rg-x" onclick="rrClose()" aria-label="Close">&times;</button>');
  h.push('</div>');
  h.push('<div class="rvp-sub">'+resEsc(rep.blurb)+'</div>');

  h.push('<div class="resr-row"><label>From<input class="res-date" type="date" value="'+resEsc(RR.from)+'" '
    + (RR.busy?'disabled ':'') + 'onchange="rrSet(\'from\', this.value)"></label>');
  h.push('<label>To<input class="res-date" type="date" value="'+resEsc(RR.to)+'" '
    + (RR.busy?'disabled ':'') + 'onchange="rrSet(\'to\', this.value)"></label></div>');

  // Per-report options. Each one says what it does to the answer, because a
  // number on a report is only as good as the setting that produced it.
  if(rep.lookback){
    h.push('<div class="rr-opt"><label>Look back<select class="rr-sel" '+(RR.busy?'disabled ':'')
      + 'onchange="rrSet(\'lookback\', this.value)">');
    [1,3,6,12].forEach(function(n){
      h.push('<option value="'+n+'"'+(Number(RR.lookback)===n?' selected':'')+'>'+n+' month'+(n===1?'':'s')+'</option>');
    });
    h.push('</select></label><i>A guest is “new” if they appear nowhere in the look-back. A longer look-back is a stronger claim and takes longer to read.</i></div>');
  }
  if(rep.lapsed){
    h.push('<div class="rr-opt"><label>At least<select class="rr-sel" '+(RR.busy?'disabled ':'')
      + 'onchange="rrSet(\'minVisits\', this.value)">');
    [3,5,8,10,15,20].forEach(function(n){
      h.push('<option value="'+n+'"'+(Number(RR.minVisits)===n?' selected':'')+'>'+n+' visits</option>');
    });
    h.push('</select></label><label>Away over<select class="rr-sel" '+(RR.busy?'disabled ':'')
      + 'onchange="rrSet(\'weeks\', this.value)">');
    [4,8,12,26,52].forEach(function(n){
      h.push('<option value="'+n+'"'+(Number(RR.weeks)===n?' selected':'')+'>'+n+' weeks</option>');
    });
    h.push('</select></label><i>Pick dates when they WERE still coming — a lapsed guest is by definition not in the last few weeks.</i></div>');
  }
  if(rep.sortable){
    h.push('<div class="rr-opt"><label>Rank by<select class="rr-sel" '+(RR.busy?'disabled ':'')
      + 'onchange="rrSet(\'sortBy\', this.value)">');
    [['spend','Lifetime spend'],['visits','Visits'],['per_visit','Average per visit']].forEach(function(o){
      h.push('<option value="'+o[0]+'"'+(RR.sortBy===o[0]?' selected':'')+'>'+o[1]+'</option>');
    });
    h.push('</select></label><label>Show top<select class="rr-sel" '+(RR.busy?'disabled ':'')
      + 'onchange="rrSet(\'limit\', this.value)">');
    [50,100,250,1000].forEach(function(n){
      h.push('<option value="'+n+'"'+(Number(RR.limit)===n?' selected':'')+'>'+n+'</option>');
    });
    h.push('</select></label></div>');
  }

  if(bad){
    h.push('<div class="resr-bad">'+resEsc(bad)+'</div>');
  } else if(nights){
    h.push('<div class="resr-note">'+nights+' night'+(nights===1?'':'s')+' to read &middot; about '+mins+' min'
      + (rep.profiles ? ' &middot; plus the guest histories' : '')
      + (win.from !== RR.from || win.to !== RR.to
          ? '<br><i>Reads '+resEsc(resDateLabel(win.from))+' to '+resEsc(resDateLabel(win.to))
            + (rep.lookback ? ' — the extra months are the look-back' : ' — the extra days are so “did they come back” has something to find') + '.</i>'
          : '')
      + '</div>');
  }
  h.push('<div class="resr-note resr-quiet">Nights already read for another report are reused, so a second report over the same dates is instant.</div>');

  if(RR.busy){
    h.push('<div class="resr-prog"><b>'+resEsc(RR.note||'Working…')+'</b>'
      + '<div class="resr-bar"><i style="width:'+(RR.total?Math.round(RR.done/RR.total*100):0)+'%"></i></div>'
      + '<span>'+RR.done+' of '+RR.total+' nights read</span></div>');
    h.push('<div class="resr-note resr-quiet">Keep this window open until it finishes.</div>');
  }
  if(RR.err) h.push('<div class="resr-bad">'+resEsc(RR.err)+'</div>');

  h.push('<div class="rvp-acts">');
  h.push('<button class="res-btn" onclick="rrClose()"'+(RR.busy?' disabled':'')+'>Close</button>');
  h.push('<button class="res-btn" onclick="rrRun(true)"'+((RR.busy||bad)?' disabled':'')
    + ' title="Work it out and show it on this page first">'+(RR.busy?'Working…':'Show on screen')+'</button>');
  h.push('<button class="res-btn res-btn-go" onclick="rrRun(false)"'+((RR.busy||bad)?' disabled':'')
    + ' title="Work it out and download the Excel straight away">'+(RR.busy?'Working…':'Download Excel')+'</button>');
  h.push('</div></div>');
  return h.join('');
}

// ══════════════════════════════════════════════════════════════════════════
// THE FULL PAGE (f-popup, second half — "but then build the full page too")
// ══════════════════════════════════════════════════════════════════════════
function rrCell(v, kind){
  if(v == null || v === '') return '<i class="rr-none">&mdash;</i>';
  if(typeof v === 'number'){
    if(kind === 'money') return resNum(Math.round(v));
    if(kind === 'pct') return (Math.round(v*10)/10) + '<small>%</small>';
    return resNum(v);
  }
  return resEsc(v);
}
function rrTableHtml(t){
  var kinds = {};
  (t.money||[]).forEach(function(i){ kinds[i] = 'money'; });
  (t.pct||[]).forEach(function(i){ kinds[i] = 'pct'; });
  (t.num||[]).forEach(function(i){ kinds[i] = 'num'; });
  t.head.forEach(function(h, i){ if(/\(AED/.test(h)) kinds[i] = 'money'; if(/^%|%$/.test(h)) kinds[i] = 'pct'; });
  var h = ['<div class="rr-tblwrap"><div class="rr-tblname">'+resEsc(t.name)+'</div>'];
  h.push('<div class="rr-scroll"><table class="rr-tbl"><thead><tr>');
  t.head.forEach(function(c, i){
    h.push('<th class="'+(kinds[i]?'rr-r':'')+'">'+resEsc(c)+'</th>');
  });
  h.push('</tr></thead><tbody>');
  (t.rows||[]).forEach(function(r){
    var isTotal = String(r[0]||'').indexOf('TOTAL') === 0 || String(r[0]||'').indexOf('WHOLE WINDOW') === 0;
    h.push('<tr'+(isTotal?' class="rr-total"':'')+'>');
    t.head.forEach(function(_, i){
      h.push('<td class="'+(kinds[i]?'rr-r':'')+'">'+rrCell(r[i], kinds[i])+'</td>');
    });
    h.push('</tr>');
  });
  h.push('</tbody></table></div>');
  if(!(t.rows||[]).length) h.push('<div class="rr-empty">Nothing in this table for the dates you picked.</div>');
  if(t.note) h.push('<div class="rr-note">'+resEsc(t.note)+'</div>');
  h.push('</div>');
  return h.join('');
}

function renderResReports(){
  var money = !fohBlocked('revenue');
  var h = ['<div class="res-wrap rr-wrap">'];

  h.push('<div class="res-head"><div class="res-head-l">');
  h.push('<div class="res-kicker">Reservations &middot; reports</div>');
  h.push('<div class="res-title">Reports</div>');
  h.push('</div><div class="res-head-r">');
  h.push('<button class="res-btn" onclick="enterApp(\'reservations\')" title="Back to tonight’s book">Tonight&rsquo;s book</button>');
  if(RR.result) h.push('<button class="res-btn res-btn-go" onclick="rrExcel()" title="Download what is on screen as a branded Excel file">Download Excel</button>');
  h.push('</div></div>');

  // ── The catalogue. Pick one, the pop-up opens. ──
  h.push('<div class="rr-pick">');
  RR_REPORTS.forEach(function(r){
    var blocked = (r.money === true) && !money;
    var on = RR.result && RR.result.rep.id === r.id;
    h.push('<button class="rr-card'+(on?' on':'')+(blocked?' rr-card-off':'')+'"'
      + (blocked ? ' disabled title="This report is money, and your access does not include Revenue."'
                 : ' onclick="rrOpen(\''+r.id+'\')"')
      + '><b>'+resEsc(r.name)+'</b><span>'+resEsc(r.blurb)+'</span></button>');
  });
  h.push('</div>');

  var R = RR.result;
  if(!R){
    h.push('<div class="rr-idle">Pick a report above. You choose the dates, then either look at it here or download the Excel straight away.'
      + '<div class="rr-idle-s">Every report is worked out from the SevenRooms nightly book, one night at a time — the same book the Reservations screen shows. Nothing is stored, so a report can never disagree with the book it came from.</div></div>');
    h.push('</div>'); return h.join('');
  }

  h.push('<div class="rr-res">');
  h.push('<div class="rr-res-h"><div><div class="rr-res-t">'+resEsc(R.out.title)+'</div>');
  h.push('<div class="rr-res-s">'+resEsc(R.out.sub)+'</div></div>');
  h.push('<div class="rr-res-m">'+resEsc(resDateLabel(R.from))+' &ndash; '+resEsc(resDateLabel(R.to))
    + '<i>'+R.nights+' night'+(R.nights===1?'':'s')+' read &middot; built '+R.built.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})+'</i></div>');
  h.push('</div>');

  if(R.failed && R.failed.length){
    h.push('<div class="rr-bad"><b>'+R.failed.length+' night'+(R.failed.length===1?'':'s')
      + ' could not be read and '+(R.failed.length===1?'is':'are')+' NOT in these figures:</b> '
      + R.failed.map(function(f){ return resEsc(f.date); }).join(', ')
      + '. Run it again to try them.</div>');
  }

  (R.out.tables||[]).forEach(function(t){ h.push(rrTableHtml(t)); });

  if((R.out.notes||[]).length){
    h.push('<div class="rr-notes"><div class="rr-notes-h">Read this before using the numbers</div>');
    (R.out.notes||[]).forEach(function(n){ h.push('<p>'+resEsc(n)+'</p>'); });
    h.push('</div>');
  }
  h.push('</div>');

  h.push('<div class="res-foot">Read-only from SevenRooms'
    + (money?'':' &middot; money columns are hidden on your access')
    + '. Every figure is counted from the nightly book at the moment you pressed the button.</div>');
  h.push('</div>');
  return h.join('');
}
