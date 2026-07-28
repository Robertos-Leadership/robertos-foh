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
function resNum(n){ return Number(n||0).toLocaleString('en-US'); }
function resToday(){ return (typeof chkToday==='function') ? chkToday().iso : new Date().toISOString().slice(0,10); }
function resDateLabel(iso){
  try{ return new Date(iso+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'}); }
  catch(e){ return iso; }
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
        h.push('<div class="rg-last">Last in on '+resEsc(resDateLabel(String(g.last_visit).slice(0,10)))+'</div>');
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
      h.push('<div class="res-area">'+resEsc(k)+' <span>'+list.length+' reservation'+(list.length===1?'':'s')+' &middot; '+cov+' covers</span></div>');
      h.push('<div class="res-tbl">');
      h.push('<div class="res-r res-hdr">'
        + '<div>Time</div><div>Covers</div><div>Guest</div><div>Table</div>'
        + '<div>Status</div><div>Note</div><div>Booked by</div>'
        + (money?'<div class="res-right">Spend</div>':'')
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
              + (r.phone_last4?'<i class="res-phone">••• '+resEsc(r.phone_last4)+'</i>':'')+'</div>'
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
          + (money?'<div class="res-right">'+(r.spend?('<small>AED </small>'+resNum(Math.round(r.spend))):'')+'</div>':'')
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

  h.push('</div>');
  return h.join('');
}
