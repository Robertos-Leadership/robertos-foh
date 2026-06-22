// ──────────────────────────────────────────────────────────────────────────
// FOH Operations page (ops*) — slice 2 of the index.html split.
// Hosts the Daily Closing Report launcher + the recent-reports history table.
//
// PURE RELOCATION (no renames). Loaded as a classic <script> AFTER the main
// inline script and foh-closing.js, so its functions stay global (inline
// onclick handlers keep working) and it sees the shared globals it needs:
//   sb, state, revInit, revMoney  (main script)
//   clToday, clOpen               (foh-closing.js)
// These functions run only on tab navigation / realtime refresh, never at boot.
// ──────────────────────────────────────────────────────────────────────────
function renderOperations(){
  var today=clToday(), h=[];
  h.push('<div class="ops-wrap">');
  h.push('<div class="ops-hero"><div class="ops-hero-k">Operations</div><div class="ops-hero-t">Daily Closing Report</div>'
    +'<div class="ops-hero-s">Capture the night at close — revenue, tips, comps and shift notes. It flows into Revenue automatically and feeds the Analyst for patterns.</div>'
    +'<div class="ops-hero-actions"><button class="ops-btn-primary" onclick="clOpen()">&#128203; Start today’s report</button>'
    +'<span class="ops-date">Another day <input type="date" id="ops-date" value="'+today+'"><button class="ops-btn-sec" onclick="clOpen(document.getElementById(\'ops-date\').value)">Open</button></span></div></div>');
  h.push('<div class="rev-section-h">Recent closing reports</div><div id="ops-recent">'+opsRecentHTML()+'</div>');
  h.push('</div>');
  if(!revInit().opsRecentLoaded) opsLoadRecent();
  return h.join('');
}
function opsRecentHTML(){
  var R=revInit();
  if(!R.opsRecent) return '<div class="rev-mut" style="padding:12px">Loading…</div>';
  if(!R.opsRecent.length) return '<div class="rev-mut" style="padding:12px">No closing reports yet — start today’s above.</div>';
  function fdate(ds){ return new Date(String(ds).slice(0,10)+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}); }
  var rows=R.opsRecent.map(function(r){
    var net=Number(r.rest_lunch_net||0)+Number(r.rest_dinner_net||0)+Number(r.lounge_lunch_net||0)+Number(r.lounge_dinner_net||0);
    var cov=Number(r.rest_lunch_covers||0)+Number(r.rest_dinner_covers||0)+Number(r.lounge_lunch_covers||0)+Number(r.lounge_dinner_covers||0);
    var nc=((r.comments_good||[]).length)+((r.comments_bad||[]).length);
    return '<tr onclick="clOpen(\''+String(r.service_date).slice(0,10)+'\')"><td class="rev-day">'+fdate(r.service_date)+'</td><td>'+revMoney(net)+'</td><td>'+cov+'</td><td>'+(r.manager_pm||r.manager_am||'—')+'</td><td>'+(nc?nc+' note'+(nc>1?'s':''):'—')+'</td></tr>';
  }).join('');
  return '<div class="rev-grid-wrap"><table class="rev-grid"><thead><tr><th>Date</th><th>Net</th><th>Covers</th><th>Manager</th><th>Notes</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
async function opsLoadRecent(){
  var R=revInit(); R.opsRecentLoaded=true;
  try{
    var res=await sb.from('closing_reports').select('service_date,rest_lunch_net,rest_dinner_net,lounge_lunch_net,lounge_dinner_net,rest_lunch_covers,rest_dinner_covers,lounge_lunch_covers,lounge_dinner_covers,manager_am,manager_pm,comments_good,comments_bad').order('service_date',{ascending:false}).limit(30);
    R.opsRecent = res.error ? [] : (res.data||[]);
  }catch(e){ R.opsRecent=[]; }
  if(state.currentTab==='operations'){ var box=document.getElementById('ops-recent'); if(box) box.innerHTML=opsRecentHTML(); }
}
