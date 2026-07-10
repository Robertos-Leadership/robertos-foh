#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
// FOH safety-net tests for the small, bug-prone pure functions the app relies
// on: Dubai date math (the source of the "wrong night" bugs — Live Now strip,
// covers, spend, closing report, checklist) and hours-worked (overnight shifts).
// Run with:  node tests.js
//
// These test the REAL shared file (common.js) that the app loads — not a copy —
// so if you change common.js, run `node tests.js`. This mirrors kitchen-ref/tests.js;
// keep the two in step since common.js is byte-identical across both apps.
// ──────────────────────────────────────────────────────────────────────────

const RC = require('./common.js');
const { localDateISO, dubaiBusinessDate, calcHours } = RC;

// --- tiny test harness ---
let pass=0, fail=0;
function eq(got, want, name){
  const ok = got === want;
  if(ok) pass++; else { fail++; console.log(`  ✗ ${name}\n      got:  ${got}\n      want: ${want}`); }
}

// Build a real Date for a given Dubai wall-clock time, regardless of the machine
// timezone, so these tests pass on any developer's laptop.
function dubaiTime(y,mo,d,h,mi){
  const asUTC = Date.UTC(y, mo-1, d, h, mi);   // treat the wall clock as UTC…
  return new Date(asUTC - 4*3600000);          // …then subtract 4h so it IS Dubai (+4)
}

console.log('Operational day / Dubai business date (6h rollback):');
// The three boundary cases the "wrong night" bug hinges on:
eq(dubaiBusinessDate(dubaiTime(2026,6,21, 2, 0)), '2026-06-20', '02:00 Dubai -> previous calendar day (night just finished)');
eq(dubaiBusinessDate(dubaiTime(2026,6,20,15, 0)), '2026-06-20', '15:00 Dubai -> same calendar day');
eq(dubaiBusinessDate(dubaiTime(2026,6,21, 6, 0)), '2026-06-21', '06:00 Dubai -> flips to current day');
// Tight edges around the 06:00 flip, for safety:
eq(dubaiBusinessDate(dubaiTime(2026,6,21, 5,59)), '2026-06-20', '05:59 Dubai -> still previous night');
eq(dubaiBusinessDate(dubaiTime(2026,6,21, 6, 1)), '2026-06-21', '06:01 Dubai -> new day begins');
eq(dubaiBusinessDate(dubaiTime(2026,6,20,23,30)), '2026-06-20', '23:30 Dubai (pre-midnight) -> same day');

console.log('Local date (no UTC shift):');
eq(localDateISO(dubaiTime(2026,1,1,0,30)), '2026-01-01', 'midnight-ish stays on the day');

console.log('Hours worked:');
eq(calcHours('14:00','23:00'), 9,  'normal evening shift');
eq(calcHours('14:00','00:00'), 10, 'finish at midnight');
eq(calcHours('22:00','02:00'), 4,  'overnight wrap past midnight');
eq(calcHours('18:00','18:30'), 0.5,'half hour');

console.log(`\n${fail? '❌' : '✅'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
