// ──────────────────────────────────────────────────────────────────────────
// RESERVATIONS module (res*) — tonight's book, straight from SevenRooms.
// Asked for by Francesco 23 Jul 2026: the managers who need to see the night
// shouldn't have to open SevenRooms separately, and shouldn't need a
// SevenRooms seat to do it.
//
// WHAT IT IS — read before "improving" it:
//   A READ-ONLY window on the SevenRooms day view. It never books, moves,
//   cancels or edits anything: the hosts' system stays the single place a
//   reservation is changed, so there is no way for this screen to create a
//   conflicting truth. If a manager needs to change a booking, they call the
//   host — same as before.
//
//   Every field is computed server-side by the Kitchen `sevenrooms-sync` edge
//   function's ?daysheet= mode (the same function the closing report and the
//   Live-now strip already use). ONE call per date, one aggregated payload —
//   the browser never talks to SevenRooms and never holds a page of raw guest
//   records.
//
// PRIVACY (deliberate, don't widen it):
//   The feed returns guest NAME and the LAST 4 DIGITS of the phone only. Email,
//   address and loyalty data are dropped server-side and never reach the app.
//   Access is per-user: 'reservations' in app_users.modules, ticked by
//   Francesco in Admin → Users & Access. Default-deny — a user with no row
//   does NOT get this module (see FOH_DEFAULT_MODULES in foh-core.js).
//   Spend is additionally hidden from anyone without Revenue access, exactly
//   like the Live-now strip.
//
// Loaded as a classic <script> so its functions stay global for the inline
// onclick handlers. Uses the shared globals: state, renderMain, chkToday,
// KITCHEN_URL / KITCHEN_KEY / KITCHEN_PROXY_SECRET, fohBlocked.
// ──────────────────────────────────────────────────────────────────────────

var RES = {
  date: null,        // YYYY-MM-DD being viewed (defaults to the operational night)
  loading: false,
  data: null,        // last good payload — kept on screen while a refresh runs
  err: null,
  loadedAt: null,
  shift: 'all',      // all | the shift_category values present in the data
  q: ''              // search text
};

function resEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
// ── Per-reservation money (added 28 Jul 2026, asked for by Nicole) ────────────
// She needs what a table actually spent, gross AND net, plus the average per
// person. The gross is the SevenRooms check subtotal, which is the menu-price
// total the guest paid; net is that / 1.225, the verified stack (10% service +
// 7% municipality on net, 5% VAT on net+SC).
//
// THE THING TO NOT FORGET: these figures cover only the bookings SevenRooms has
// a linked check for. A walk-in served without a booking has no reservation to
// attach a check to, so the column NEVER sums to the night's revenue. Checked
// against rev_daily (Simphony, the revenue truth) for 20-25 Jul 2026 it came to
// 83-98% of net and the gap moved every night. That is why the footer states the
// coverage instead of quietly printing a total that contradicts the closing
// report. Simphony stays the only source for "what did we take".
//
// LT_GROSS_TO_NET is defined once in foh-core.js -- read it, never re-type 1.225.
function resGrossToNet(){ return (typeof LT_GROSS_TO_NET === 'number' && LT_GROSS_TO_NET > 0) ? LT_GROSS_TO_NET : 1.225; }
function resNet(gross){ return (Number(gross)||0) / resGrossToNet(); }
function resMoney0(n){ return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:0}); }
// The gross on a booking. Prefers the new `gross` field (check SUBTOTAL) and
// falls back to the old `spend` (check TOTAL, i.e. subtotal + tips) only while an
// app build is running against an edge function that predates the split -- a tip
// on top is a far smaller error than showing nothing at all.
function resGrossOf(r){ return Number(r && (r.gross != null ? r.gross : r.spend)) || 0; }
// How many people to divide by. SevenRooms gives both the booked size and the
// number that actually turned up; the average per person means the people who
// actually ate, so arrived wins when the hosts have entered it. A 6-top where 4
// came would otherwise read a third light.
function resHeads(r){ return Number(r && r.arrived) > 0 ? Number(r.arrived) : (Number(r && r.pax) || 0); }
// The night's money, counted the SAME way the rows are.
//
// WHY THIS IS COMPUTED HERE and not read off totals.covers_with_money: the edge
// function counts heads as the BOOKED size, the rows count them as the ARRIVED
// size (resHeads). On 24 Jul that is 178 vs 176 people, which put two different
// "net per guest" figures on one screen -- 317.15 on the tile against 320.75 down
// the column. Small, and exactly the kind of drift that makes someone stop
// trusting the screen. One rule, applied once, used by the tile, the area lines
// and every row.
function resNightMoney(){
  var out = { gross:0, heads:0, bookings:0 };
  var rows = (RES.data && RES.data.reservations) || [];
  rows.forEach(function(r){
    var g = resGrossOf(r);
    if(!g) return;
    out.gross += g; out.heads += resHeads(r); out.bookings++;
  });
  out.net = resNet(out.gross);
  return out;
}
// One booking's money: gross, net, and the average per person.
function resSpendCell(r){
  var g = resGrossOf(r);
  // No linked check is NOT zero spend, and must never look like it. A dim dash
  // that says why beats both a blank cell (reads as "nothing here") and a 0
  // (reads as "they spent nothing").
  if(!g) return '<i class="res-sp-none" title="No check linked to this booking in SevenRooms yet">&mdash;</i>';
  var n = resNet(g), heads = resHeads(r);
  var pp = heads ? '<div class="res-sp-pp">'+resMoney0(g/heads)+' &middot; '+resMoney0(n/heads)+' per guest</div>' : '';
  return '<div class="res-sp" title="Gross AED '+resMoney0(g)+' (menu price, what the guest paid) &#10;Net AED '+resMoney0(n)+' (gross / '+resGrossToNet()+')'
    + (heads?' &#10;Over '+heads+' guest'+(heads===1?'':'s'):'')+'">'
    + '<div class="res-sp-g"><small>AED </small>'+resMoney0(g)+'</div>'
    + '<div class="res-sp-n"><small>AED </small>'+resMoney0(n)+' net</div>'
    + pp + '</div>';
}
function resNum(n){ return Number(n||0).toLocaleString('en-US'); }
function resToday(){ return (typeof chkToday==='function') ? chkToday().iso : new Date().toISOString().slice(0,10); }
function resDateLabel(iso){
  try{ return new Date(iso+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'}); }
  catch(e){ return iso; }
}
// A past visit date, said so nobody can misread it. resDateLabel prints weekday
// + day + month with NO year, which is right for tonight but a lie for an old
// visit: "Friday 8 February" for a guest last in on 2024-02-08 reads as this
// year and is two and a half years out. Verified 28 Jul that tonight's own book
// holds last-visit dates in 2024, 2025 and 2026, so this is real, not theory.
// Same year -> weekday is useful ("Tuesday 3 February"). Any other year -> drop
// the weekday, which means nothing at that distance, and state the year.
function resVisitLabel(iso){
  var s = String(iso||'').slice(0,10);
  if(!s) return '';
  try{
    var d = new Date(s+'T12:00:00');
    if(isNaN(d.getTime())) return s;
    var thisYear = (typeof chkToday==='function' ? chkToday().iso : new Date().toISOString().slice(0,10)).slice(0,4);
    return (s.slice(0,4) === thisYear)
      ? d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})
      : d.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
  }catch(e){ return s; }
}
function resShiftDate(iso, days){
  var d = new Date(iso+'T12:00:00'); d.setDate(d.getDate()+days);
  return d.toISOString().slice(0,10);
}
// "22 Jul" from a SevenRooms created timestamp. Never throws on a bad value —
// a missing created date shows blank, not "Invalid Date".
function resWhen(ts){
  if(!ts) return '';
  try{
    var d = new Date(String(ts).slice(0,19)+(String(ts).indexOf('Z')>-1?'':'Z'));
    if(isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
  }catch(e){ return ''; }
}

// ── LOAD ──────────────────────────────────────────────────────────────────
// One POST to the Kitchen edge function per date. The previous payload stays
// on screen while this runs, so a refresh never blanks the night. Any failure
// leaves a plain sentence and a Try again button — never an error object.
async function resLoad(force){
  if(RES.loading) return;
  var d = RES.date || (RES.date = resToday());
  if(!force && RES.data && RES.data.date === d) return;
  RES.loading = true; RES.err = null;
  if(typeof renderMain==='function' && state.currentTab==='reservations') renderMain();
  try{
    var r = await fetch(KITCHEN_URL + '/functions/v1/sevenrooms-sync?daysheet=' + d, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+KITCHEN_KEY, 'x-proxy-secret':KITCHEN_PROXY_SECRET }
    });
    if(!r.ok) throw new Error('HTTP '+r.status);
    var j = await r.json();
    if(!j || !j.ok) throw new Error((j && j.error) || 'no data');
    // An edge function that predates the ?daysheet= mode ignores the parameter
    // and answers with its normal-mode payload — which is ok:true but carries no
    // reservations. Without this check that reads as "empty night", which is a
    // lie. Treat a payload with no reservations array as not-deployed-yet.
    if(!Array.isArray(j.reservations)) throw new Error('daysheet mode not deployed');
    RES.data = j;
    RES.loadedAt = new Date();
    RES.err = null;
    // Fetch the guests' history alongside, but never block the book on it: the
    // night has to be on screen whether or not SevenRooms answers for the
    // profiles. Only ids not already cached are requested.
    setTimeout(function(){ resEnsureHistory(); }, 0);
  }catch(e){
    console.warn('[reservations] load failed', e);
    RES.err = (String(e && e.message).indexOf('not deployed') > -1)
      ? 'This screen is waiting on the SevenRooms connection being switched on.'
      : 'Could not reach SevenRooms just now.';
  }
  RES.loading = false;
  if(typeof renderMain==='function' && state.currentTab==='reservations') renderMain();
}

function resGo(days){ RES.date = resShiftDate(RES.date || resToday(), days); RES.data = null; resLoad(true); }
function resSetDate(v){ if(!v) return; RES.date = v; RES.data = null; resLoad(true); }
function resToTonight(){ RES.date = resToday(); RES.data = null; resLoad(true); }
function resRefresh(){ resLoad(true); }
function resSetShift(s){ RES.shift = s; renderMain(); }
function resSearch(v){ RES.q = String(v||'').toLowerCase(); renderMain(); }

// Auto-refresh: only while this screen is open AND only for tonight — a past
// date can't change, so polling it would be pure waste. Registered once.
if(!window._resTimer){
  window._resTimer = setInterval(function(){
    if(state && state.currentTab==='reservations' && RES.date===resToday() && !RES.loading) resLoad(true);
  }, 90000);
  // The guest panel lives on <body>, so it would outlive a tab change and
  // hang over an unrelated screen. Sweep it as soon as the tab moves.
  window._resGuestSweep = setInterval(function(){
    if(typeof RESG!=='undefined' && RESG.open && state && state.currentTab!=='reservations') resCloseGuest();
  }, 400);
}

// ── GUEST PANEL ───────────────────────────────────────────────────────────
// Tap a name → their history. Asked for by Francesco 28 Jul 2026: the whole
// point of this screen is that a manager shouldn't need a SevenRooms seat, and
// "who is this guest" is the question the book can't answer on its own.
//
// The numbers come from the SevenRooms CLIENT record via the Kitchen edge
// function's ?guest= mode — NOT from the booking. Verified 28 Jul: reservation
// objects carry no linked check on any date tested, while the client record
// carries the real lifetime figures (of 25 guests on 27 Jul, all 8 repeat
// guests had spend; top AED42,386 / 145 visits). A first-timer legitimately
// reads 0, which is why this screen says "first visit" rather than "AED 0".
//
// The edge function returns counting fields, tags and the guest note only —
// no email, phone, address, birthday or loyalty id ever reaches the browser.
// Spend is additionally hidden from anyone without Revenue access, exactly
// like the Spend column and the Live-now strip.
var RESG = {
  open: false,
  id: null,          // SevenRooms client id being shown
  row: null,         // tonight's booking for that guest (already on screen)
  data: null,
  loading: false,
  err: null,
  cache: {}          // id → payload; a guest's lifetime total doesn't move
                     // during a service, so re-tapping a name is free.
};

function resGuestEl(){
  var el = document.getElementById('res-guest');
  if(!el){
    el = document.createElement('div');
    el.id = 'res-guest';
    document.body.appendChild(el);
    // Close on backdrop tap, but ONLY on the backdrop itself — a tap that
    // lands inside the card must never dismiss it.
    el.addEventListener('click', function(e){ if(e.target === el) resCloseGuest(); });
  }
  return el;
}

function resPaintGuest(){
  var el = resGuestEl();
  el.innerHTML = RESG.open ? resGuestHtml() : '';
  el.className = RESG.open ? 'rg-ov' : '';
}

function resOpenGuest(id, time){
  if(!id) return;
  var list = (RES.data && RES.data.reservations) || [];
  // Match on time as well as id: a guest with two bookings tonight must open
  // the one whose row was actually tapped.
  RESG.row = null;
  for(var i=0;i<list.length;i++){
    if(list[i].client === id && (!time || list[i].time === time)){ RESG.row = list[i]; break; }
  }
  if(!RESG.row){ for(var j=0;j<list.length;j++){ if(list[j].client === id){ RESG.row = list[j]; break; } } }
  RESG.open = true; RESG.id = id; RESG.err = null;
  if(RESG.cache[id]){ RESG.data = RESG.cache[id]; RESG.loading = false; resPaintGuest(); return; }
  RESG.data = null; RESG.loading = true;
  resPaintGuest();
  // The venue comes off the booking, never from a constant here: the guest's
  // figures have to be read for the venue they're sitting in tonight.
  resLoadGuest(id, (RESG.row && RESG.row.venue) || '');
}

function resCloseGuest(){
  RESG.open = false; RESG.data = null; RESG.err = null; RESG.loading = false;
  resPaintGuest();
}

// Esc closes it, the way every other overlay in the app behaves. Registered
// once, and a no-op while the panel is shut.
if(!window._resGuestKey){
  window._resGuestKey = true;
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && RESG.open) resCloseGuest();
  });
}

async function resLoadGuest(id, venue){
  try{
    var r = await fetch(KITCHEN_URL + '/functions/v1/sevenrooms-sync?guest=' + encodeURIComponent(id)
        + (venue ? '&venue=' + encodeURIComponent(venue) : ''), {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+KITCHEN_KEY, 'x-proxy-secret':KITCHEN_PROXY_SECRET }
    });
    if(!r.ok) throw new Error('HTTP '+r.status);
    var j = await r.json();
    if(!j || !j.ok) throw new Error((j && j.error) || 'no data');
    RESG.cache[id] = j;
    if(RESG.id === id){ RESG.data = j; RESG.err = null; }
  }catch(e){
    console.warn('[reservations] guest load failed', e);
    // The booking on screen is still true even when the profile won't load —
    // say what's missing, don't blank the panel.
    if(RESG.id === id) RESG.err = 'Could not read this guest’s history from SevenRooms just now.';
  }
  if(RESG.id === id){ RESG.loading = false; resPaintGuest(); }
}

function resMoney(n){ return '<small>AED </small>' + resNum(Math.round(Number(n)||0)); }

function resGuestHtml(){
  var row = RESG.row || {};
  var g = RESG.data;
  var money = !fohBlocked('revenue');
  var h = ['<div class="rg-card" role="dialog" aria-modal="true" aria-label="Guest history">'];

  h.push('<div class="rg-head">');
  h.push('<div><div class="rg-kicker">Guest history &middot; SevenRooms</div>');
  h.push('<div class="rg-name">'+(row.vip?'<span class="res-vip">VIP</span> ':'')+resEsc(row.name||'Guest')+'</div></div>');
  h.push('<button class="rg-x" onclick="resCloseGuest()" aria-label="Close">&times;</button>');
  h.push('</div>');

  // ── Tonight first: the manager tapped this name because of tonight. ──
  h.push('<div class="rg-tonight">');
  h.push('<b>'+resEsc(row.time||'')+'</b> &middot; '+resNum(row.pax)+' cover'+(row.pax===1?'':'s')
    + (row.area?' &middot; '+resEsc(row.area):'')
    + ((row.tables&&row.tables.length)?' &middot; table '+resEsc(row.tables.join(', ')):''));
  if(row.notes) h.push('<div class="rg-tonight-n">'+resEsc(row.notes)+'</div>');
  h.push('</div>');

  if(RESG.loading){
    h.push('<div class="rg-load">Reading their history…</div>');
  } else if(RESG.err){
    h.push('<div class="rg-err">'+resEsc(RESG.err)+'<div class="rg-err-s">Tonight’s booking above is unaffected.</div></div>');
  } else if(g){
    // Numbers ONLY when they came back scoped to this venue. The group-wide
    // totals are a different measure that disagrees with the profile the hosts
    // read in SevenRooms (verified 28 Jul: 70 visits / AED22,259 group against
    // 47 / AED62,715 on the page), so showing them would put a figure on the
    // floor that contradicts the hosts' own screen. Tags and the note still
    // stand on their own, so the panel is still worth opening.
    var scoped = g.scope === 'venue';
    var firstTime = (Number(g.visits)||0) <= 1;
    if(!scoped){
      h.push('<div class="rg-first">Their history for this venue isn’t available — tags and notes below still apply.</div>');
    } else if(firstTime && !(Number(g.spend)>0)){
      h.push('<div class="rg-first">First visit — no history yet.</div>');
    } else {
      // Only the figures we actually have. Spend disappears entirely without
      // Revenue access rather than showing a blank box that invites a question.
      var stats = [
        ['Visits', resNum(g.visits)],
        ['Covers', resNum(g.covers)]
      ];
      if(money){
        stats.push(['Total spend', resMoney(g.spend)]);
        if(Number(g.per_cover)>0) stats.push(['Avg per cover', resMoney(g.per_cover)]);
      }
      if(Number(g.noshows)>0) stats.push(['No-shows', resNum(g.noshows)]);
      if(Number(g.cancellations)>0) stats.push(['Cancelled', resNum(g.cancellations)]);
      h.push('<div class="rg-stats">');
      stats.forEach(function(s){ h.push('<div class="rg-stat"><b>'+s[1]+'</b><span>'+s[0]+'</span></div>'); });
      h.push('</div>');
      if(g.last_visit){
        h.push('<div class="rg-last">Last visit '+resEsc(resVisitLabel(g.last_visit))+'</div>');
      }
    }
    if(g.note) h.push('<div class="rg-note"><span>Note on file</span>'+resEsc(g.note)+'</div>');
    if(g.tags && g.tags.length){
      h.push('<div class="rg-tags">');
      g.tags.forEach(function(t){ h.push('<span class="rg-tag">'+resEsc(t)+'</span>'); });
      h.push('</div>');
    }
  }

  h.push('<div class="rg-foot">Read-only from SevenRooms'
    + (money?'':' &middot; spend is hidden on your access')
    + '. To change anything about this guest, the hosts do it in SevenRooms.</div>');
  h.push('</div>');
  return h.join('');
}

// ── GUEST HISTORY FOR THE WHOLE BOOK ──────────────────────────────────────
// Asked for by Francesco 28 Jul: last visit and average spend per person on the
// book itself, and a printable version to brief the team before service.
//
// ONE call for the night, not one per booking. A busy Sunday carries 47
// bookings and firing 47 requests off a phone on the floor is exactly the kind
// of thing that makes an app feel broken. The edge function's ?guests= mode
// takes every id at once and answers with a map.
//
// The cache is keyed by GUEST, never by date: a lifetime total doesn't change
// because you looked at a different night, and the 90-second auto-refresh must
// not re-fetch 47 profiles every minute and a half. Only ids we've never seen
// are ever requested. A guest whose record can't be read is remembered as
// failed so the app doesn't retry them on a loop -- their row simply shows no
// history, which is honest.
var RESH = { loading: false, err: null, got: {}, failed: {} };

function resHistVenue(){
  var list = (RES.data && RES.data.reservations) || [];
  for (var i = 0; i < list.length; i++) if (list[i].venue) return list[i].venue;
  return '';
}

async function resEnsureHistory(){
  if (RESH.loading) return;
  var list = (RES.data && RES.data.reservations) || [];
  var want = [];
  for (var i = 0; i < list.length; i++){
    var id = list[i].client;
    if (id && !RESH.got[id] && !RESH.failed[id] && want.indexOf(id) === -1) want.push(id);
  }
  if (!want.length) return;
  RESH.loading = true; RESH.err = null;
  if (typeof renderMain === 'function' && state.currentTab === 'reservations') renderMain();
  try {
    var r = await fetch(KITCHEN_URL + '/functions/v1/sevenrooms-sync?guests=' + encodeURIComponent(want.join(','))
        + '&venue=' + encodeURIComponent(resHistVenue()), {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+KITCHEN_KEY, 'x-proxy-secret':KITCHEN_PROXY_SECRET }
    });
    if(!r.ok) throw new Error('HTTP '+r.status);
    var j = await r.json();
    if(!j || !j.ok) throw new Error((j && j.error) || 'no data');
    var map = j.guests || {};
    want.forEach(function(id){
      if (map[id]) RESH.got[id] = map[id];
      else RESH.failed[id] = 1;      // don't ask again for this one
    });
  } catch(e) {
    console.warn('[reservations] guest history failed', e);
    RESH.err = 'Guest history could not be read just now.';
    // NOT marked failed: a network blip shouldn't permanently blank the column,
    // so the next load of this screen tries again.
  }
  RESH.loading = false;
  if (typeof renderMain === 'function' && state.currentTab === 'reservations') renderMain();
}

// Compact date for a table cell. Same year-trap as the panel: never print a day
// and month alone for a visit in another year.
function resVisitShort(iso){
  var s = String(iso||'').slice(0,10);
  if(!s) return '';
  try{
    var d = new Date(s+'T12:00:00');
    if(isNaN(d.getTime())) return s;
    var thisYear = (typeof chkToday==='function' ? chkToday().iso : new Date().toISOString().slice(0,10)).slice(0,4);
    return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'})
      + (s.slice(0,4) === thisYear ? '' : ' ' + s.slice(0,4));
  }catch(e){ return s; }
}

// The one-line history that sits under a guest's name on the book.
function resHistLine(r, money){
  var g = r && r.client ? RESH.got[r.client] : null;
  if(!g || g.scope !== 'venue') return '';
  var visits = Number(g.visits) || 0;
  if(visits <= 1 && !(Number(g.spend) > 0)) return '<i class="res-hist">first visit</i>';
  var bits = [visits + (visits === 1 ? ' visit' : ' visits')];
  // Say NET. SevenRooms' own per-cover figure is computed on the net basis --
  // checked 28 Jul against three live profiles, spend/covers reproduces it
  // (780.83 and 463.58 to the fils) while gross/covers does not (921.39, 481.50).
  // Unlabelled it was fine on its own, but the Spend column beside it now prints
  // gross AND net on every row, and two money figures on one line with different
  // bases and no labels is how someone ends up comparing the wrong pair.
  if(money && Number(g.per_cover) > 0) bits.push('AED ' + resNum(Math.round(g.per_cover)) + ' net/cover');
  if(g.last_visit) bits.push('last ' + resVisitShort(g.last_visit));
  return '<i class="res-hist">' + resEsc(bits.join(' · ')) + '</i>';
}

// ── PRINT BRIEF ───────────────────────────────────────────────────────────
// A pre-service sheet for the team: the night in order, with who each guest is.
// Follows the roster print pattern already in the app -- a self-contained
// document in a new window -- so nothing about the live screen has to be hidden
// or restyled for print.
//
// SevenRooms' automatic tags are left off the sheet. "Upcoming Reservation in
// 30 Days", "Group All Guests" and the marketing segments are true but tell a
// section waiter nothing, and on a 16-booking night they bury the three tags
// that matter. What a brief needs is the standing preferences and the VIP
// markers. The footer says they were left off, so nobody thinks the guest has
// no tags.
var RES_AUTO_TAG = /^(upcoming reservation|reservation within|group |visits=|custom |copycustomautotag|activation re-engagement|first timer|repeat guest|cancellation|no show)/i;

function resBriefTags(g){
  if(!g || !g.tags) return [];
  return g.tags.filter(function(t){ return !RES_AUTO_TAG.test(String(t).trim()); });
}

// The booking note as a brief should carry it. Two bits of pure noise come off:
//   "Selected: "  — every row says it, so it is a label, not information
//   "DINNER"      — the default service. "JAZZ NIGHT", "APERITIVO · SCALA" and
//                   "Roberto's Restaurant Week" all survive, because those DO
//                   tell the team something about the night.
// What is left is the actual request ("Table away from the Entrance", "Female
// birthday"). Long notes are cut at a sentence-ish length: the sheet has to fit
// an A4 page, and the untrimmed version is one tap away on the screen.
function resBriefNote(s){
  var n = String(s||'').replace(/^\s*Selected:\s*/i, '').replace(/^DINNER\b[\s·-]*/i, '').trim();
  if(n.length > 150) n = n.slice(0, 148).replace(/[\s·,;-]+\S*$/, '') + '…';
  return n;
}

async function resPrintBrief(){
  // Never print a sheet with the history column silently empty.
  await resEnsureHistory();
  var money = !fohBlocked('revenue');
  var rows = resRows();
  if(!rows.length){ alert('Nothing to brief — there are no bookings on this night.'); return; }

  var byArea = {}, order = [];
  rows.forEach(function(r){
    var k = r.area || 'Any Seating Area';
    if(!byArea[k]){ byArea[k] = []; order.push(k); }
    byArea[k].push(r);
  });
  order.sort(function(a,b){
    var ca = byArea[a].reduce(function(s,r){ return s+(r.pax||0); },0);
    var cb = byArea[b].reduce(function(s,r){ return s+(r.pax||0); },0);
    return cb-ca;
  });

  var t = RES.data.totals || {};
  var h = '<div class="hd"><div class="ttl">Service brief</div>'
    + '<div class="dt">' + resEsc(resDateLabel(RES.date)) + '</div>'
    + '<div class="tot">' + resNum(t.reservations) + ' reservations &middot; ' + resNum(t.covers) + ' covers</div></div>';

  order.forEach(function(k){
    var list = byArea[k];
    var cov = list.reduce(function(s,r){ return s+(r.pax||0); },0);
    h += '<div class="area">' + resEsc(k) + ' &mdash; ' + list.length + ' reservation' + (list.length===1?'':'s') + ', ' + cov + ' covers</div>';
    h += '<table><thead><tr>'
      + '<th class="w1">Time</th><th class="w2">Pax</th><th class="w3">Guest</th><th class="w4">Table</th>'
      + '<th class="w5">Last visit</th><th class="w6">Visits</th>'
      + (money ? '<th class="w7">Avg/cover</th>' : '')
      + '<th>Worth knowing</th></tr></thead><tbody>';
    list.forEach(function(r){
      var g = r.client ? RESH.got[r.client] : null;
      var venueScoped = g && g.scope === 'venue';
      var firstTime = venueScoped && (Number(g.visits)||0) <= 1 && !(Number(g.spend) > 0);
      var know = [];
      var bn = resBriefNote(r.notes);
      if(bn) know.push('<b>' + resEsc(bn) + '</b>');
      if(g && g.note) know.push(resEsc(resBriefNote(g.note)));
      // Tags capped so one heavily-tagged regular can't push the row over a
      // page. The count says what was left off rather than hiding it.
      var tg = resBriefTags(g);
      if(tg.length){
        var show = tg.slice(0, 6);
        know.push('<span class="tg">' + show.map(resEsc).join(' &middot; ')
          + (tg.length > show.length ? ' <span class="more">+' + (tg.length - show.length) + ' more</span>' : '') + '</span>');
      }
      h += '<tr>'
        + '<td class="w1">' + resEsc(r.time||'') + '</td>'
        + '<td class="w2">' + resNum(r.pax) + '</td>'
        + '<td class="w3">' + (r.vip ? '<span class="vip">VIP</span> ' : '') + resEsc(r.name||'') + '</td>'
        + '<td class="w4">' + ((r.tables&&r.tables.length) ? resEsc(r.tables.join(', ')) : '') + '</td>'
        + '<td class="w5">' + (firstTime ? '<i>first visit</i>' : (venueScoped && g.last_visit ? resEsc(resVisitShort(g.last_visit)) : '')) + '</td>'
        + '<td class="w6">' + (venueScoped ? resNum(g.visits) : '') + '</td>'
        + (money ? '<td class="w7">' + (venueScoped && Number(g.per_cover)>0 ? resNum(Math.round(g.per_cover)) : '') + '</td>' : '')
        + '<td>' + know.join('<br>') + '</td>'
        + '</tr>';
    });
    h += '</tbody></table>';
  });

  h += '<div class="ft">Read-only from SevenRooms &middot; printed '
    + resEsc(new Date().toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))
    + (money ? '' : ' &middot; spend hidden on this login')
    + '.<br>SevenRooms’ automatic tags (upcoming and recent reservations, group segments, marketing) are left off this sheet. '
    + 'To change a booking, the hosts do it in SevenRooms.</div>';

  var css = '@page{size:A4 landscape;margin:8mm}'
    + 'html,body{margin:0}body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#1c1c1c}'
    + '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    + '.hd{border-bottom:2px solid #6B1F2A;padding-bottom:6px;margin-bottom:10px}'
    + '.ttl{font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#6B1F2A;font-weight:700}'
    + '.dt{font-size:19px;margin-top:2px}.tot{font-size:11px;color:#555;margin-top:2px}'
    + '.area{margin:11px 0 3px;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#6B1F2A;font-weight:700}'
    // table-layout:fixed is the whole fix for the sheet running off the page.
    // Without it the browser widens the table to fit the longest note on the
    // night -- one guest's "Custom question response: We are celebrating 2
    // different people..." pushed the last column past the paper edge and the
    // page would not print. Fixed layout holds every column to its declared
    // width and wraps the text instead.
    + 'table{width:100%;table-layout:fixed;border-collapse:collapse}'
    + 'th{background:#6B1F2A;color:#fff;font-size:8px;letter-spacing:1px;text-transform:uppercase;text-align:left;padding:4px 5px}'
    + 'td{border-bottom:1px solid #ddd;padding:4px 5px;vertical-align:top;line-height:1.3;'
    +   'word-wrap:break-word;overflow-wrap:break-word}'
    + 'tr{page-break-inside:avoid}'
    + '.w1{width:34px}.w2{width:26px;text-align:center}.w3{width:118px;font-weight:700}.w4{width:44px}'
    + '.w5{width:58px}.w6{width:34px;text-align:center}.w7{width:52px;text-align:right}'
    + 'th.w2,th.w6{text-align:center}th.w7{text-align:right}'
    + '.vip{background:#6B1F2A;color:#fff;font-size:7px;font-weight:700;padding:1px 3px;border-radius:2px;vertical-align:1px}'
    + '.tg{color:#6B1F2A}.more{color:#999}'
    + '.ft{margin-top:12px;padding-top:6px;border-top:1px solid #ccc;font-size:8px;color:#666;line-height:1.5}';

  var doc = '<!doctype html><html><head><meta charset="utf-8"><title>Service brief — '
    + resEsc(resDateLabel(RES.date)) + '</title><style>' + css + '</style></head><body>' + h + '</body></html>';

  var w = window.open('', '_blank');
  if(!w){ alert('Pop-up blocked — allow pop-ups for this site and press Print brief again.'); return; }
  w.document.open(); w.document.write(doc); w.document.close();
  w.focus();
  setTimeout(function(){ try{ w.print(); }catch(e){} }, 300);
}

// ── FILTERING ─────────────────────────────────────────────────────────────
function resRows(){
  var rows = (RES.data && RES.data.reservations) ? RES.data.reservations : [];
  if(RES.shift !== 'all') rows = rows.filter(function(r){ return (r.shift||'') === RES.shift; });
  if(RES.q){
    rows = rows.filter(function(r){
      var hay = [r.name, (r.tables||[]).join(' '), r.notes, r.booked_by, r.area, r.status_display, r.phone_last4]
        .join(' ').toLowerCase();
      return hay.indexOf(RES.q) !== -1;
    });
  }
  return rows;
}
function resShifts(){
  var seen = {}, out = [];
  ((RES.data && RES.data.reservations) || []).forEach(function(r){
    if(r.shift && !seen[r.shift]){ seen[r.shift] = 1; out.push(r.shift); }
  });
  return out;
}

// ── RENDER ────────────────────────────────────────────────────────────────
function renderReservations(){
  if(!RES.date) RES.date = resToday();
  if(!RES.data && !RES.loading && !RES.err){ setTimeout(function(){ resLoad(true); }, 0); }

  var money = !fohBlocked('revenue');           // spend hidden without Revenue
  var isTonight = RES.date === resToday();
  // The money column changes the grid, so the flag rides on the wrapper —
  // one class, not a second copy of the column widths.
  var h = ['<div class="res-wrap'+(money?' res-money':'')+'">'];

  // ── Header: which night, and how to move between nights ──
  h.push('<div class="res-head">');
  h.push('<div class="res-head-l">');
  h.push('<div class="res-kicker">SevenRooms &middot; live</div>');
  h.push('<div class="res-title">'+resEsc(resDateLabel(RES.date))+(isTonight?' <span class="res-tonight">tonight</span>':'')+'</div>');
  h.push('</div>');
  h.push('<div class="res-head-r">');
  h.push('<button class="res-nav" onclick="resGo(-1)" title="Previous day">&#8249;</button>');
  h.push('<input class="res-date" type="date" value="'+resEsc(RES.date)+'" onchange="resSetDate(this.value)">');
  h.push('<button class="res-nav" onclick="resGo(1)" title="Next day">&#8250;</button>');
  if(!isTonight) h.push('<button class="res-btn" onclick="resToTonight()">Tonight</button>');
  // Disabled while the history is still arriving, and it says why — a brief
  // printed with an empty history column is worse than waiting three seconds.
  h.push('<button class="res-btn res-btn-go" onclick="resPrintBrief()"'
    + (RESH.loading?' disabled title="Reading guest history…"':' title="Print a pre-service brief for the team"')
    + '>'+(RESH.loading?'Reading guests…':'Print brief')+'</button>');
  h.push('<button class="res-btn" onclick="resRefresh()"'+(RES.loading?' disabled':'')+'>'+(RES.loading?'Refreshing…':'Refresh')+'</button>');
  h.push('</div></div>');

  if(RES.err){
    h.push('<div class="res-problem"><div class="res-problem-t">'+resEsc(RES.err)+'</div>'
      + '<div class="res-problem-s">Nothing is broken in the app — this screen only reads SevenRooms, so it will fill in as soon as the connection is back.</div>'
      + '<button class="res-btn" onclick="resRefresh()">Try again</button></div>');
    h.push('</div>'); return h.join('');
  }
  if(!RES.data){
    h.push('<div class="res-loading">Reading the book from SevenRooms…</div>');
    h.push('</div>'); return h.join('');
  }

  // ── The night in numbers ──
  var t = RES.data.totals || {};
  h.push('<div class="res-tot">'
    + '<div class="res-tot-i"><b>'+resNum(t.reservations)+'</b><span>Reservations</span></div>'
    + '<div class="res-tot-i"><b>'+resNum(t.covers)+'</b><span>Covers</span></div>'
    + '<div class="res-tot-i"><b>'+resNum(t.seated)+'</b><span>In now</span></div>'
    + '<div class="res-tot-i"><b>'+resNum(t.upcoming)+'</b><span>Still to come</span></div>'
    + '<div class="res-tot-i"><b>'+resNum(t.completed)+'</b><span>Finished</span></div>'
    // Two money tiles, only once the night actually has checks. Net per guest is
    // the one Nicole reads, so it gets its own tile rather than being buried in a
    // tooltip. Both are labelled "linked checks" on the tile itself -- the tile
    // sits beside Covers, and without the label it would be read as the night's
    // revenue, which it is not (see resNet's note).
    + (function(){
        if(!money) return '';
        var nm = resNightMoney();
        if(!nm.gross) return '';
        return '<div class="res-tot-i"><b><small>AED </small>'+resMoney0(nm.gross)+'</b><span>Gross &middot; linked checks</span></div>'
          + '<div class="res-tot-i"><b><small>AED </small>'+resMoney0(nm.net)+'</b><span>Net &middot; linked checks</span></div>'
          + (nm.heads
              ? '<div class="res-tot-i"><b><small>AED </small>'+resMoney0(nm.net/nm.heads)+'</b><span>Net per guest</span></div>'
              : '');
      })()
    + '</div>');

  // ── Filters: shift chips (only when the night actually has more than one)
  //    and a search that covers name, table, note and who booked it. ──
  var shifts = resShifts();
  h.push('<div class="res-tools">');
  if(shifts.length > 1){
    h.push('<div class="res-chips">');
    h.push('<button class="res-chip'+(RES.shift==='all'?' on':'')+'" onclick="resSetShift(\'all\')">All day</button>');
    shifts.forEach(function(s){
      h.push('<button class="res-chip'+(RES.shift===s?' on':'')+'" onclick="resSetShift(\''+resEsc(s).replace(/'/g,"\\'")+'\')">'+resEsc(s)+'</button>');
    });
    h.push('</div>');
  }
  h.push('<input class="res-srch" type="search" placeholder="Search guest, table, note or who booked it" value="'+resEsc(RES.q)+'" oninput="resSearch(this.value)">');
  h.push('</div>');

  var rows = resRows();
  if(!rows.length){
    h.push('<div class="res-empty">'
      + (RES.q || RES.shift!=='all'
          ? 'No booking matches that.'
          : 'No reservations in the book for '+resEsc(resDateLabel(RES.date))+'.')
      + '</div>');
  } else {
    // ── Grouped by seating area, biggest room first — the way the hosts read
    //    the day view. Each area header carries its own count. ──
    var byArea = {}, order = [];
    rows.forEach(function(r){
      var k = r.area || 'Any Seating Area';
      if(!byArea[k]){ byArea[k] = []; order.push(k); }
      byArea[k].push(r);
    });
    order.sort(function(a,b){
      var ca = byArea[a].reduce(function(s,r){ return s+(r.pax||0); },0);
      var cb = byArea[b].reduce(function(s,r){ return s+(r.pax||0); },0);
      return cb-ca;
    });
    order.forEach(function(k){
      var list = byArea[k];
      var cov = list.reduce(function(s,r){ return s+(r.pax||0); },0);
      // Area money: only the bookings in THIS area that carry a check, and it says
      // how many that was. "AED 24,436 over 12 of 22 bookings" is a figure a
      // manager can act on; the same number with the coverage hidden is one they
      // would wrongly read as the room's takings.
      var aGross = 0, aHeads = 0, aN = 0;
      if(money) list.forEach(function(r){ var g = resGrossOf(r); if(!g) return; aGross += g; aHeads += resHeads(r); aN++; });
      h.push('<div class="res-area">'+resEsc(k)+' <span>'+list.length+' reservation'+(list.length===1?'':'s')+' &middot; '+cov+' covers'
        + (aGross ? ' &middot; <b>AED '+resMoney0(aGross)+'</b> gross &middot; AED '+resMoney0(resNet(aGross))+' net'
                    + (aHeads?' &middot; AED '+resMoney0(resNet(aGross)/aHeads)+' net per guest':'')
                    + ' <i>(' + aN + ' of ' + list.length + ' with a check)</i>' : '')
        + '</span></div>');
      h.push('<div class="res-tbl">');
      h.push('<div class="res-r res-hdr">'
        + '<div>Time</div><div>Covers</div><div>Guest</div><div>Table</div>'
        + '<div>Status</div><div>Note</div><div>Booked by</div>'
        + (money?'<div class="res-right">Spend<i>gross &middot; net</i></div>':'')
        + '</div>');
      list.forEach(function(r){
        var st = (r.state==='seated') ? 'seated' : (r.state==='completed' ? 'done' : 'due');
        h.push('<div class="res-r res-'+st+'">'
          + '<div class="res-time">'+resEsc(r.time||'')+'</div>'
          + '<div class="res-pax">'+resNum(r.pax)+(r.arrived?'<i> · '+resNum(r.arrived)+' in</i>':'')+'</div>'
          // The name is a button when SevenRooms has a client record for it —
          // tapping opens their history. A booking with no client id (rare, and
          // real: some walk-ins are logged without one) stays plain text rather
          // than offering a tap that would open an empty panel. The id is
          // stripped to id-safe characters before it goes near an onclick.
          + '<div class="res-name">'+(r.vip?'<span class="res-vip" title="VIP">VIP</span> ':'')
              + (r.client
                  ? '<button class="res-guest-btn" onclick="resOpenGuest(\''+String(r.client).replace(/[^A-Za-z0-9_-]/g,'')+'\',\''+resEsc(r.time||'')+'\')" title="See this guest’s history">'+resEsc(r.name)+'</button>'
                  : resEsc(r.name))
              + (r.phone_last4?'<i class="res-phone">••• '+resEsc(r.phone_last4)+'</i>':'')
              // Last visit and average spend per person sit under the name
              // rather than in two more columns: it is the same guest's
              // information, and the grid is already eight columns wide.
              + resHistLine(r, money)+'</div>'
          // Blank, not "not assigned": verified 23 Jul that SevenRooms' API only
          // returns a table once the hosts LOCK it (10 of 13 bookings that night
          // came back empty while the SevenRooms screen showed an auto-suggested
          // table beside a scissors icon). The kitchen floorplan feed counts the
          // same 10 as unassigned, so this is the API, not this screen. Claiming
          // "not assigned" would contradict what the hosts can see.
          + '<div class="res-tbls">'+((r.tables&&r.tables.length)?resEsc(r.tables.join(', ')):'<i>&mdash;</i>')+'</div>'
          + '<div><span class="res-pill res-pill-'+st+'">'+resEsc(r.status_display||r.status||'')+'</span></div>'
          + '<div class="res-note" title="'+resEsc(r.notes||'')+'">'+resEsc(r.notes||'')+'</div>'
          + '<div class="res-by">'+resEsc(r.booked_by||'')+(r.created?'<i>'+resEsc(resWhen(r.created))+'</i>':'')+'</div>'
          + (money?'<div class="res-right">'+resSpendCell(r)+'</div>':'')
          + '</div>');
      });
      h.push('</div>');
    });
  }

  // ── Footer: what this screen is, so nobody expects it to book a table. ──
  h.push('<div class="res-foot">Read-only view of SevenRooms'
    + (RES.loadedAt? ' &middot; updated '+RES.loadedAt.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '')
    + (isTonight ? ' &middot; refreshes on its own every 90 seconds' : '')
    + '. To add, move or cancel a booking, the hosts do it in SevenRooms.</div>');

  // The money caveat, stated where the money is -- not in a tooltip somebody has
  // to go looking for. Two separate cases, and they need different sentences:
  //   * checks exist but cover only part of the night -> say what fraction, and
  //     say plainly that Revenue/the closing report is the real figure. Walk-ins
  //     served without a booking have no reservation to carry a check.
  //   * no checks at all -> almost always the newest night, which SevenRooms
  //     posts on a delay. Saying "no spend" there would be a lie.
  if(money && RES.data){
    var ft = RES.data.totals || {};
    var nm = resNightMoney();
    var totalRes = Number(ft.reservations)||0, withMoney = nm.bookings;
    if(nm.gross){
      h.push('<div class="res-foot res-foot-money">Spend covers the '+resNum(withMoney)+' of '+resNum(totalRes)
        + ' booking'+(totalRes===1?'':'s')+' with a check linked in SevenRooms, so it is <b>not</b> the night&rsquo;s takings &mdash; a walk-in with no booking has nothing to attach a check to. '
        + 'For what the venue actually took, use Revenue or the closing report. Net = gross &divide; '+resGrossToNet()
        + ' (10% service + 7% municipality, then 5% VAT).</div>');
    } else if(totalRes){
      h.push('<div class="res-foot res-foot-money">No checks are linked to this night in SevenRooms yet &mdash; it posts them on a delay, so the newest night usually fills in later. '
        + 'Blank here means <b>not posted yet</b>, not that nobody spent anything.</div>');
    }
  }

  h.push('</div>');
  return h.join('');
}
