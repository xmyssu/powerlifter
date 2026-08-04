/* ==========================================================================
   engine.test.mjs — simulates training against the progression engine.
   Run: node js/engine.test.mjs
   No framework; exits non-zero on failure.
   ========================================================================== */

// --- minimal localStorage shim so store.js can run under node -----------
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
globalThis.document = { dispatchEvent() {}, addEventListener() {} };
// node 24 defines navigator as a getter-only global; only shim it if absent
if (!globalThis.navigator) globalThis.navigator = {};
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o); } };

const store = await import('./store.js');
const { buildProgram, resolveDay, startSession, completeSession, resolveAssessment,
        repsForWeek, pctForWeek, loadingWeeks, graduationCheck, volumeAudit,
        slotE1RM, cyclePlan, convertUnits, slotHistory, templateOf } = await import('./program.js');
const { pctOf1RM, e1RM, loadFor, plateBreakdown, roundToLoadable, plateLabel, minIncrement, convertLoad } = await import('./rpe.js');
const { assessDeload, INTERMEDIATE_PL } = await import('./templates.js');
const { strengthTrend, trendSummary } = await import('./coach.js');

let pass = 0, fail = 0;
const problems = [];
function ok(cond, label, extra) {
  if (cond) { pass++; }
  else { fail++; problems.push(label + (extra ? `  [${extra}]` : '')); }
}
function eq(a, b, label) { ok(a === b, label, `got ${a}, want ${b}`); }
function near(a, b, label, tol = 0.01) { ok(Math.abs(a - b) <= tol, label, `got ${a}, want ~${b}`); }

const hr = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);

/* ======================================================================
   1. RPE / %1RM table
   ====================================================================== */
hr('1. RPE table (against the standard printed chart)');
near(pctOf1RM(1, 10), 100, '1 rep @ RPE 10 = 100%');
near(pctOf1RM(2, 10), 95.5, '2 @ 10 = 95.5%');
near(pctOf1RM(5, 10), 86.3, '5 @ 10 = 86.3%');
near(pctOf1RM(1, 9), 95.5, '1 @ 9 = 95.5% (same as 2 @ 10)');
near(pctOf1RM(4, 8), 83.7, '4 @ 8 = 83.7%');
near(pctOf1RM(8, 8), 73.9, '8 @ 8 = 73.9%');
near(pctOf1RM(12, 10), 68.0, '12 @ 10 = 68%');
near(pctOf1RM(3, 7.5), 85.0, '3 @ 7.5 = 85%');
near(pctOf1RM(12, 6), 57.2, '12 @ 6 = 57.2%');
ok(pctOf1RM(20, 6) > 20 && pctOf1RM(20, 6) < 50, 'extrapolates past the table without blowing up');

// the book's own derived identities (p. 116): these should be the same load
near(pctOf1RM(1, 7), pctOf1RM(4, 10), 'a single @ RPE 7 is the same load as a 4RM');
near(pctOf1RM(2, 9), pctOf1RM(3, 10), '2 reps @ RPE 9 is the same load as a 3RM');
near(pctOf1RM(2, 8), pctOf1RM(4, 10), '2 reps @ RPE 8 is the same load as a 4RM');

// round trip
const rt = loadFor(200, 5, 8);
near(e1RM(rt, 5, 8), 200, 'loadFor and e1RM round-trip');

/* ======================================================================
   2. Plate math
   ====================================================================== */
hr('2. Plate math');
const kgOpts = { barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] };
let b = plateBreakdown(140, kgOpts);
ok(b.ok, '140 kg is loadable');
eq(b.perSide.map((p) => `${p.plate}x${p.count}`).join(','), '25x2,10x1', '140 kg = 25,25,10 per side');
b = plateBreakdown(100, kgOpts);
eq(b.perSide.map((p) => `${p.plate}x${p.count}`).join(','), '25x1,15x1', '100 kg = 25,15 per side');
b = plateBreakdown(20, kgOpts);
eq(b.perSide.length, 0, 'bare bar has no plates');
b = plateBreakdown(21, kgOpts);
ok(!b.ok, '21 kg is not loadable with 1.25 as the smallest pair');
near(minIncrement(kgOpts.plates), 2.5, 'smallest jump is 2.5 kg (a pair of 1.25s)');
eq(roundToLoadable(101, kgOpts), 100, '101 rounds down to 100');
eq(roundToLoadable(101.5, kgOpts), 102.5, '101.5 rounds up to 102.5');
eq(roundToLoadable(10, kgOpts), 20, 'below-bar rounds up to the bar');
b = plateBreakdown(142.5, kgOpts);
ok(b.ok && b.perSide.some((p) => p.plate === 1.25), '142.5 uses the 1.25s');

/* ======================================================================
   3. Program construction and week-1 prescriptions
   ====================================================================== */
hr('3. Program construction');
store.resetAll();
store.update((s) => {
  s.profile.units = 'kg';
  s.profile.barWeight = 20;
  s.profile.plates = [25, 20, 15, 10, 5, 2.5, 1.25];
  s.maxes.squat = { value: 180, date: '2026-08-01', source: 'tested', reps: 3 };
  s.maxes.bench = { value: 120, date: '2026-08-01', source: 'tested', reps: 3 };
  s.maxes.deadlift = { value: 220, date: '2026-08-01', source: 'tested', reps: 3 };
  s.program = buildProgram({ templateId: INTERMEDIATE_PL.id, startDate: '2026-08-03' });
  s.onboarded = true;
});

let st = store.getState();
eq(loadingWeeks(st.program), 3, 'a 3-wide rep range gives a 3-week wave');

// Day 3 (strength) week 1: squat 3x5 @ 82.5%
let d3 = resolveDay(st, { cycle: 1, week: 1, day: 3, phase: 'load' });
const sq = d3.slots.find((s) => s.slotKey === 'd3_squat');
eq(sq.sets, 3, 'D3 squat is 3 sets');
eq(sq.reps, 5, 'D3 squat week 1 is 5 reps (top of 3-5)');
near(sq.pct, 82.5, 'D3 squat week 1 references 82.5%');
eq(sq.targetRPE, 8, 'D3 squat targets first-set RPE 8');
eq(sq.plannedLoad, 147.5, '82.5% of 180 = 148.5 -> 147.5 loadable');
eq(sq.loadSource, 'pct', 'load comes from the %1RM reference on the first ever session');

// Day 2 (technique) week 1: RPE 5, 3 reps, 80%
let d2 = resolveDay(st, { cycle: 1, week: 1, day: 2, phase: 'load' });
const d2sq = d2.slots.find((s) => s.slotKey === 'd2_squat');
eq(d2sq.reps, 3, 'D2 squat week 1 is 3 reps (top of 1-3)');
eq(d2sq.targetRPE, 5, 'D2 targets RPE 5 — deliberately easy');
near(d2sq.pct, 80, 'D2 week 1 references 80%');

// Day 1 bench: the book's worked example is 9 reps @ ~67.5%
let d1 = resolveDay(st, { cycle: 1, week: 1, day: 1, phase: 'load' });
const d1b = d1.slots.find((s) => s.slotKey === 'd1_bench');
eq(d1b.reps, 9, 'D1 bench week 1 is 9 reps (top of 7-9)');
near(d1b.pct, 67.5, 'D1 bench week 1 references 67.5% (book example)');
eq(d1b.targetRPE, 7, 'D1 targets first-set RPE 7');

// and week 3 should be the top of the band at the bottom of the rep range
const d1bW3 = resolveDay(st, { cycle: 1, week: 3, day: 1 }).slots.find((s) => s.slotKey === 'd1_bench');
eq(d1bW3.reps, 7, 'D1 bench week 3 is 7 reps');
near(d1bW3.pct, 72.5, 'D1 bench week 3 references 72.5% — highest % on the lowest-rep week');

// leg curl waves 12/10/8
eq(resolveDay(st, { week: 1, day: 3 }).slots.find((s) => s.slotKey === 'd3_legcurl').reps, 12, 'leg curl week 1 = 12');
eq(resolveDay(st, { week: 2, day: 3 }).slots.find((s) => s.slotKey === 'd3_legcurl').reps, 10, 'leg curl week 2 = 10');
eq(resolveDay(st, { week: 3, day: 3 }).slots.find((s) => s.slotKey === 'd3_legcurl').reps, 8, 'leg curl week 3 = 8');

/* ======================================================================
   4. Volume audit against the book's own table (39 sets, 15/15/15)
   ====================================================================== */
hr('4. Volume audit vs the book\'s printed breakdown');
const va = volumeAudit(st);
eq(va.total, 39, 'total weekly sets = 39 (book p. 229)');
eq(va.main, 27, 'main-lift sets = 27');
eq(va.accessory, 12, 'accessory sets = 12');
eq(va.cats['UB Push'], 15, 'upper-body push = 15 sets');
eq(va.cats['UB Pull'], 15, 'upper-body pull = 15 sets');
eq(va.cats.Lower, 15, 'lower body = 15 sets');

/* ======================================================================
   5. Simulate a clean 3-week cycle, then the next cycle
   ====================================================================== */
hr('5. A clean cycle, then cycle 2');

/** Train a session exactly as prescribed, logging the target RPE. */
function trainAsPrescribed(overrides = {}) {
  const s0 = store.getState();
  const pos = { ...s0.program.cursor };
  const ses = startSession(s0, pos);
  for (const entry of ses.entries) {
    const o = overrides[entry.slotKey] || {};
    entry.sets = entry.sets.map((set, i) => ({
      load: o.load ?? entry.plannedLoad ?? 60,
      reps: o.reps ?? entry.targetReps,
      rpe: o.rpe ?? entry.targetRPE ?? 8,
      done: true,
      ts: new Date().toISOString(),
    }));
  }
  store.update((s) => { s.sessions.push(ses); s.activeSessionId = ses.id; });
  let notes = [];
  store.update((s) => { notes = completeSession(s, ses.id).notes; s.activeSessionId = null; });
  return { session: ses, notes, pos };
}

// week 1
const w1 = [1, 2, 3, 4].map(() => trainAsPrescribed());
st = store.getState();
eq(st.program.cursor.week, 2, 'after four days we are in week 2');
eq(st.program.slots.d3_squat.week1Load, 147.5, 'week-1 squat load recorded as the wave anchor');

// week 2 — squat should be one 5 kg increment up, bench one 2.5 kg increment up
let w2d3 = resolveDay(store.getState(), {});
w2d3 = resolveDay(store.getState(), { week: 2, day: 3 });
const w2sq = w2d3.slots.find((s) => s.slotKey === 'd3_squat');
eq(w2sq.reps, 4, 'week 2 squat drops to 4 reps');
eq(w2sq.plannedLoad, 152.5, 'week 2 squat = 147.5 + 5 kg');
eq(w2sq.loadSource, 'wave', 'load now comes from the wave anchor');
const w2bn = w2d3.slots.find((s) => s.slotKey === 'd3_bench');
eq(w2bn.plannedLoad, 100 + 2.5, 'week 2 bench = week 1 + 2.5 kg');

[1, 2, 3, 4].forEach(() => trainAsPrescribed());   // week 2
[1, 2, 3, 4].forEach(() => trainAsPrescribed());   // week 3
st = store.getState();
eq(st.program.cursor.week, 3, 'cursor stays on week 3 while the assessment is pending');
ok(st.program.pendingAssessment, 'end of the wave raises the deload checklist');

const w3sq = resolveDay(st, { week: 3, day: 3 }).slots.find((s) => s.slotKey === 'd3_squat');
eq(w3sq.reps, 3, 'week 3 squat is 3 reps');
eq(w3sq.plannedLoad, 157.5, 'week 3 squat = 147.5 + 2 x 5 kg');

// no flags -> straight into cycle 2
let res = null;
store.update((s) => { res = resolveAssessment(s, {}); });
eq(res.action, 'proceed', 'a clean checklist proceeds without a deload');
st = store.getState();
eq(st.program.cursor.cycle, 2, 'we are in cycle 2');
eq(st.program.cursor.week, 1, 'back to week 1');
eq(st.program.slots.d3_squat.week1Load, 152.5, 'cycle 2 week 1 starts one increment above cycle 1 week 1');
const c2sq = resolveDay(st, { cycle: 2, week: 1, day: 3 }).slots.find((s) => s.slotKey === 'd3_squat');
eq(c2sq.reps, 5, 'cycle 2 restarts at the top of the rep range');
eq(c2sq.plannedLoad, 152.5, 'cycle 2 week 1 squat = 152.5');
// net progress at matched reps: 5 kg on a 5RM across one cycle
eq(c2sq.plannedLoad - sq.plannedLoad, 5, 'one cycle = +5 kg at the same rep target');

/* ======================================================================
   6. Deload prescription
   ====================================================================== */
hr('6. Deload');
// run cycle 2's three weeks, then flag two checklist items
for (let w = 0; w < 3; w++) [1, 2, 3, 4].forEach(() => trainAsPrescribed());
st = store.getState();
ok(st.program.pendingAssessment, 'assessment pending again at the end of cycle 2');

const a = assessDeload({ dread: true, sleep: true });
eq(a.verdict, 'deload', 'two yes answers = deload');
const aPain = assessDeload({ pain: true });
eq(aPain.verdict, 'painWeek', 'aches and pains alone = high-rep week, not a deload');
eq(assessDeload({ sleep: true }).verdict, 'proceed', 'one non-pain flag = proceed');

store.update((s) => { res = resolveAssessment(s, { dread: true, sleep: true }); });
eq(res.action, 'deload', 'checklist routes us into the deload week');
st = store.getState();
eq(st.program.cursor.phase, 'deload', 'phase is deload');

const dl = resolveDay(st, {});
const dlsq = dl.slots.find((s) => s.slotKey === 'd3_squat');
ok(dl.isDeload, 'resolved day knows it is a deload');
// deload is on day 1 of the week; check the squat on day 3
const dlsq3 = resolveDay(st, { day: 3 }).slots.find((s) => s.slotKey === 'd3_squat');
eq(dlsq3.sets, 2, 'deload cuts 3 sets to 2 (two-thirds)');
eq(dlsq3.reps, 3, 'deload uses the lowest reps of the wave');
eq(dlsq3.plannedLoad, st.program.slots.d3_squat.week1Load, 'deload uses the lightest load of the wave');

// finishing the deload week rolls into the next cycle and resets the counter
[1, 2, 3, 4].forEach(() => trainAsPrescribed());
st = store.getState();
eq(st.program.cursor.cycle, 3, 'deload week completes into cycle 3');
eq(st.program.cursor.phase, 'load', 'back to loading');
eq(st.program.cyclesSinceDeload, 0, 'deload resets the without-a-deload counter');

/* ======================================================================
   7. Stall handling
   ====================================================================== */
hr('7. Stall protocol');
st = store.getState();
const preStallAnchor = st.program.slots.d3_squat.week1Load;

// week 1 of cycle 3: miss reps on the day-3 squat
trainAsPrescribed();                                        // day 1
trainAsPrescribed();                                        // day 2
const stall = trainAsPrescribed({ d3_squat: { reps: 3 } });  // day 3, target was 5
ok(stall.notes.some((n) => n.kind === 'stall'), 'missing reps on a strength day is flagged as a stall');
st = store.getState();
ok(st.program.slots.d3_squat.stalledThisCycle, 'slot marked as stalled this cycle');
eq(st.program.slots.d3_squat.stalls, 1, 'stall counted');
ok(st.program.forcedDeload, 'a stall forces the week-4 deload');

trainAsPrescribed();                                        // day 4
// day 2 is meant to stay submaximal — a short day-2 session must NOT count
const beforeD2 = store.getState().program.slots.d2_squat.stalls;
for (let w = 0; w < 2; w++) {
  trainAsPrescribed();                                      // day 1
  trainAsPrescribed({ d2_squat: { reps: 1 } });             // day 2, deliberately short
  trainAsPrescribed();                                      // day 3
  trainAsPrescribed();                                      // day 4
}
st = store.getState();
eq(st.program.slots.d2_squat.stalls, beforeD2, 'a short day-2 (technique) session is not a stall');

// even a clean checklist must give us the deload, because we stalled
store.update((s) => { res = resolveAssessment(s, {}); });
eq(res.action, 'deload', 'a stall overrides a clean checklist');
st = store.getState();
[1, 2, 3, 4].forEach(() => trainAsPrescribed());
st = store.getState();
const postAnchor = st.program.slots.d3_squat.week1Load;
near(postAnchor / (st.program.slots.d3_squat.stalledAtLoad ?? preStallAnchor), 1, 'anchor was reset', 1);
ok(postAnchor < preStallAnchor + 5, 'after a stall the next cycle starts lighter, not heavier', `${preStallAnchor} -> ${postAnchor}`);
ok(st.program.slots.d3_squat.smallIncrement, 'weekly increment is halved after a stall');
const smallInc = resolveDay(st, { day: 3 }).slots.find((s) => s.slotKey === 'd3_squat');
eq(smallInc.increment, 2.5, 'squat increment drops from 5 kg to 2.5 kg');

/* ======================================================================
   8. Graduation signal
   ====================================================================== */
hr('8. Graduation to the advanced program');
let g = graduationCheck(store.getState());
ok(!g.ready, 'one stalled lift is not enough to graduate');
store.update((s) => {
  for (const k of ['d3_squat', 'd3_bench', 'd4_dead', 'd4_bevar']) {
    s.program.slots[k].smallIncrement = true;
    s.program.slots[k].stalls = 2;
  }
});
g = graduationCheck(store.getState());
ok(g.ready, 'stalling again on most strength-day lifts after halving increments = graduate');
ok(/advanced/i.test(g.text || ''), 'graduation message points at the advanced approach');

/* ======================================================================
   9. e1RM tracking reflects real progress
   ====================================================================== */
hr('9. Estimated max tracking');
const est = slotE1RM(store.getState(), 'd3_squat');
ok(est > 150 && est < 220, 'squat e1RM lands in a sane range', `got ${est}`);

/* ======================================================================
   10. Advanced templates resolve
   ====================================================================== */
hr('10. Advanced blocks');
store.update((s) => {
  s.program = buildProgram({ templateId: 'advanced-pl-accumulation' });
});
st = store.getState();
const accD5 = resolveDay(st, { cycle: 1, week: 1, day: 5 });
const accSq = accD5.slots.find((s) => s.slotKey === 'a5_squat');
eq(accSq.reps, 5, 'accumulation D5 squat week 1 = 5 reps');
near(accSq.pct, 82.5, 'accumulation D5 squat week 1 = 82.5%');
eq(String(accSq.rpeRange), '7,9', 'accumulation D5 uses an RPE range of 7-9');
const accSqW3 = resolveDay(st, { week: 3, day: 5 }).slots.find((s) => s.slotKey === 'a5_squat');
eq(accSqW3.reps, 3, 'week 3 drops to 3 reps');
near(accSqW3.pct, 87.5, 'week 3 rises to 87.5%');

store.update((s) => { s.program = buildProgram({ templateId: 'advanced-pl-intensification' }); });
const intD5 = resolveDay(store.getState(), { week: 3, day: 5 });
eq(intD5.slots.length, 3, 'intensification D5 is a full big-3 day');
near(intD5.slots[0].pct, 90, 'intensification D5 week 3 = 90%');
const intD3 = resolveDay(store.getState(), { week: 1, day: 3 });
eq(intD3.slots.find((s) => s.slotKey === 'i3_bench').sets, 4, 'intensification D3 bench is 4 sets');

// advanced deload: two-thirds sets, RPE -1, %1RM -5
store.update((s) => { s.program.cursor.phase = 'deload'; s.program.cursor.week = 4; });
const advDl = resolveDay(store.getState(), { day: 5, phase: 'deload' });
const advDlSq = advDl.slots.find((s) => s.slotKey === 'i5_squat');
eq(advDlSq.sets, 2, 'advanced deload = two-thirds of the sets');
eq(String(advDlSq.rpeRange), '6,8', 'advanced deload drops the RPE range by a point');
near(advDlSq.pct, 85, 'advanced deload drops %1RM by 5 points (90 -> 85)');

/* ======================================================================
   11. Trend stats: what the Progress card is allowed to headline
   ====================================================================== */
hr('11. Trend stats');

// Points are fed in directly: this is about which ones trendSummary trusts,
// not about how the series is built.
const pt = (date, value, extra = {}) => ({ date, value, cycle: 1, week: 1, day: 1, deload: false, estimatedFromHighReps: false, ...extra });

// A high-rep estimate must not become the headline "best" while the card's own
// fine print tells the lifter to distrust it.
const loose = trendSummary([
  pt('2026-06-01', 100),
  pt('2026-06-08', 140, { estimatedFromHighReps: true }),   // inflated, distrusted
  pt('2026-06-15', 105),
]);
eq(loose.best.value, 105, 'best ignores an inflated high-rep estimate');
eq(loose.n, 2, 'high-rep points are excluded from the stats');
eq(loose.delta, 5, 'change is measured between trustworthy points');

// Same for deload weeks, which are light by design.
const deloaded = trendSummary([
  pt('2026-06-01', 200),
  pt('2026-06-08', 180, { deload: true }),
  pt('2026-06-15', 205),
]);
eq(deloaded.best.value, 205, 'best ignores deload weeks');
eq(deloaded.n, 2, 'deload points are excluded from the stats');

// With nothing trustworthy left, fall back rather than showing nothing.
const allLoose = trendSummary([
  pt('2026-06-01', 100, { estimatedFromHighReps: true }),
  pt('2026-06-08', 110, { estimatedFromHighReps: true }),
]);
ok(allLoose !== null && allLoose.best.value === 110, 'falls back to loose points when there are no others');

// The trend is a slope in units per week, not a difference between endpoints.
const steady = trendSummary([
  pt('2026-06-01', 100), pt('2026-06-08', 102), pt('2026-06-15', 104), pt('2026-06-22', 106),
]);
near(steady.perWeek, 2, 'a clean +2/week series reports +2/week');

// A noisy endpoint must not set the whole figure, which is what the old
// last-minus-sixth-back version did.
const noisy = trendSummary([
  pt('2026-06-01', 100), pt('2026-06-08', 102), pt('2026-06-15', 104),
  pt('2026-06-22', 106), pt('2026-06-29', 108), pt('2026-07-06', 101),  // one bad day
]);
ok(noisy.perWeek > 0, 'one bad session does not flip the trend negative', `got ${noisy.perWeek}`);
ok(noisy.perWeek < 2, 'but it does drag the slope down', `got ${noisy.perWeek}`);

// Readings all on one day must not divide by zero.
const sameDay = trendSummary([pt('2026-06-01', 100), pt('2026-06-01', 110)]);
eq(sameDay.perWeek, 0, 'two readings on the same date give a flat trend, not Infinity');
ok(Number.isFinite(sameDay.perWeek), 'same-date trend is finite');

// A deload dip inside the window must not read as progress on the way out.
const recovering = [
  pt('2026-06-01', 200), pt('2026-06-08', 202), pt('2026-06-15', 204),
  pt('2026-06-22', 170, { deload: true }),
  pt('2026-06-29', 206), pt('2026-07-06', 208),
];
const withDeload = trendSummary(recovering).perWeek;
ok(withDeload < 3, 'climbing out of a deload is not reported as a huge weekly gain', `got ${withDeload}`);
near(withDeload, 1.6, 'the slope reflects the loading weeks only', 0.5);

eq(trendSummary([pt('2026-06-01', 100)]), null, 'a single point has no trend');

// Same-date points must not be reordered by an inconsistent comparator.
store.update((s) => { s.program = buildProgram({ templateId: INTERMEDIATE_PL.id }); });
{
  const st2 = store.getState();
  const series = strengthTrend(st2, 'squat');
  const dates = series.map((p) => p.date);
  ok(dates.every((d, i) => i === 0 || dates[i - 1] <= d), 'strengthTrend returns points in date order');
}

/* ======================================================================
   12. Switching units must never prescribe a load you cannot load
   ====================================================================== */
hr('12. Unit conversion');

/** Every load makeable from a bar plus pairs of the given plates. */
function loadableSet({ barWeight, plates }, ceiling = 1000) {
  const set = new Set([barWeight]);
  (function grow(w, i) {
    if (i >= plates.length) return;
    for (let n = 0; n <= 12; n++) {
      const v = +(w + n * 2 * plates[i]).toFixed(3);
      if (v > ceiling) break;
      set.add(v);
      grow(v, i + 1);
    }
  })(barWeight, 0);
  return set;
}

function anchorsOffGrid(s) {
  const grid = loadableSet(s.profile);
  return Object.entries(s.program.slots)
    .flatMap(([k, sl]) => [[k, 'week1Load', sl.week1Load], [k, 'stalledAtLoad', sl.stalledAtLoad]])
    .filter(([, , v]) => v != null && v > 0 && !grid.has(+v.toFixed(3)));
}

store.resetAll();
store.update((s) => {
  s.profile.units = 'kg';
  s.profile.barWeight = 20;
  s.profile.plates = [25, 20, 15, 10, 5, 2.5, 1.25];
  s.maxes.squat = { value: 168.2, fromLoad: 150, reps: 3, fromRPE: 9, source: 'estimated' };
  s.maxes.bench = { value: 117.7, fromLoad: 105, reps: 3, fromRPE: 9, source: 'estimated' };
  s.maxes.deadlift = { value: 213, fromLoad: 190, reps: 3, fromRPE: 9, source: 'estimated' };
  s.program = buildProgram({ templateId: INTERMEDIATE_PL.id });
  s.onboarded = true;
});
// give every slot an anchor and a couple a stall record, so there is something to convert
store.update((s) => {
  let i = 0;
  for (const key of Object.keys(s.program.slots)) {
    s.program.slots[key].week1Load = roundToLoadable(60 + (i * 7.5), s.profile);
    if (i % 4 === 0) s.program.slots[key].stalledAtLoad = s.program.slots[key].week1Load;
    i++;
  }
});

eq(anchorsOffGrid(store.getState()).length, 0, 'anchors start on the kg grid');
const kgAnchors = { ...store.getState().program.slots };
const kgSnapshot = Object.fromEntries(Object.entries(kgAnchors).map(([k, v]) => [k, v.week1Load]));

// kg -> lb
store.update((s) => { convertUnits(s, 'lb'); });
{
  const s = store.getState();
  eq(s.profile.units, 'lb', 'units switched to lb');
  eq(s.profile.barWeight, 45, 'bar became a 45 lb bar');
  const off = anchorsOffGrid(s);
  eq(off.length, 0, 'every anchor is loadable in lb', off.map((o) => o.join(':')).join(', '));
  // and the conversion is roughly right, not merely loadable
  for (const [key, kg] of Object.entries(kgSnapshot)) {
    const lb = s.program.slots[key].week1Load;
    ok(Math.abs(lb - kg / 0.45359237) <= 2.5, `${key} converted to about the right load`, `${kg}kg -> ${lb}lb`);
  }
  ok(loadableSet(s.profile).has(s.maxes.squat.fromLoad), 'a tested-max load stays loadable too', `got ${s.maxes.squat.fromLoad}`);
  near(s.maxes.squat.value, 370.8, 'the max itself converts', 0.5);
}

// lb -> kg, back where we started
store.update((s) => { convertUnits(s, 'kg'); });
{
  const s = store.getState();
  eq(s.profile.units, 'kg', 'units switched back to kg');
  eq(s.profile.barWeight, 20, 'bar became a 20 kg bar again');
  const off = anchorsOffGrid(s);
  eq(off.length, 0, 'every anchor is loadable back in kg', off.map((o) => o.join(':')).join(', '));
  // a round trip cannot be exact once it has been snapped to two plate grids,
  // but it must not drift by more than one increment
  let worst = 0;
  for (const [key, kg] of Object.entries(kgSnapshot)) worst = Math.max(worst, Math.abs(s.program.slots[key].week1Load - kg));
  ok(worst <= 2.5, 'a kg -> lb -> kg round trip drifts at most one increment', `worst drift ${worst}`);
}

// no-ops and bad input
{
  const before = JSON.stringify(store.getState().program.slots);
  store.update((s) => { convertUnits(s, 'kg'); });
  eq(JSON.stringify(store.getState().program.slots), before, 'converting to the unit already in use changes nothing');
  store.update((s) => { convertUnits(s, 'stone'); });
  eq(store.getState().profile.units, 'kg', 'an unknown unit is ignored');
}

// logged sets are deliberately left as recorded
store.update((s) => {
  s.sessions.push({ id: 'x', status: 'done', date: '2026-06-01', cycle: 1, week: 1, day: 1, phase: 'load',
    entries: [{ slotKey: 'd1_bench', targetReps: 5, sets: [{ load: 100, reps: 5, rpe: 8, done: true }] }] });
});
store.update((s) => { convertUnits(s, 'lb'); });
eq(store.getState().sessions.at(-1).entries[0].sets[0].load, 100, 'a logged set keeps the number it was recorded with');

/* ======================================================================
   13. History logged in one unit, read in another
   ====================================================================== */
hr('13. Cross-unit history');

/** The slot keys strengthTrend actually tracks for a lift. */
function mainSlotsFor(state, lift) {
  const tpl = templateOf(state.program);
  return tpl.days.flatMap((d) => d.slots.filter((s) => s.lift === lift).map((s) => s.key));
}

/** Log one session containing a tracked squat slot, at `load`, in kg. */
function seedOneLoggedSession(load) {
  store.resetAll();
  store.update((s) => {
    s.profile.units = 'kg';
    s.profile.barWeight = 20;
    s.profile.plates = [25, 20, 15, 10, 5, 2.5, 1.25];
    s.maxes.squat = { value: 200, fromLoad: 180, reps: 3, fromRPE: 9, source: 'estimated' };
    s.program = buildProgram({ templateId: INTERMEDIATE_PL.id });
    s.onboarded = true;
  });
  const st0 = store.getState();
  const wanted = mainSlotsFor(st0, 'squat');
  // find the day that carries a tracked squat slot
  let ses = null;
  for (let day = 1; day <= 4 && !ses; day++) {
    const cand = startSession(st0, { ...st0.program.cursor, day });
    if (cand.entries.some((e) => wanted.includes(e.slotKey))) ses = cand;
  }
  const squatEntry = ses.entries.find((e) => wanted.includes(e.slotKey));
  squatEntry.plannedLoad = load;
  squatEntry.sets = squatEntry.sets.map(() => ({ load, reps: 3, rpe: 8, done: true }));
  store.update((s) => { s.sessions.push(ses); s.activeSessionId = ses.id; });
  store.update((s) => { completeSession(s, ses.id); s.activeSessionId = null; });
  return squatEntry.slotKey;
}

const slotKey = seedOneLoggedSession(150);
ok(mainSlotsFor(store.getState(), 'squat').includes(slotKey), 'seeded a slot the squat chart tracks', slotKey);
eq(store.getState().sessions[0].units, 'kg', 'a new session records the unit it was logged in');

const kgHist = slotHistory(store.getState(), slotKey);
near(kgHist.at(-1).topSet.load, 150, 'in kg, history reads back as logged');
const kgE1RM = kgHist.at(-1).best1RM;

store.update((s) => { convertUnits(s, 'lb'); });
{
  const s = store.getState();
  eq(s.profile.units, 'lb', 'switched to lb');
  eq(s.sessions[0].units, 'kg', 'the logged session still says it was written in kg');
  eq(s.sessions[0].entries.find((e) => e.slotKey === slotKey).sets[0].load, 150,
     'the stored number is untouched — history is not rewritten');

  // the read path is what converts
  const hist = slotHistory(s, slotKey);
  near(hist.at(-1).topSet.load, 150 / 0.45359237, 'slotHistory brings a kg session into lb', 0.1);
  near(hist.at(-1).best1RM, kgE1RM / 0.45359237, 'and its 1RM estimate scales with it', 0.5);
  eq(hist.at(-1).units, 'lb', 'history reports which unit it handed back');

  // the chart has to agree with the card's other numbers
  const pts = strengthTrend(s, 'squat');
  ok(pts.length > 0, 'the squat series still has points after a switch');
  near(pts.at(-1).value, kgE1RM / 0.45359237, 'the chart plots the estimate in lb', 0.5);
  const sum = trendSummary([...pts, { ...pts.at(-1), date: '2026-12-31' }]);
  ok(sum.best.value > 200, 'the headline best is now an lb-scale number, not a stale kg one', `got ${sum.best.value}`);
}

// and back again
store.update((s) => { convertUnits(s, 'kg'); });
near(slotHistory(store.getState(), slotKey).at(-1).topSet.load, 150, 'switching back reads as 150 kg again', 0.1);

// a session logged AFTER the switch carries the new unit, and the two coexist
store.update((s) => { convertUnits(s, 'lb'); });
{
  const st1 = store.getState();
  const wanted = mainSlotsFor(st1, 'squat');
  let ses2 = null;
  for (let day = 1; day <= 4 && !ses2; day++) {
    const cand = startSession(st1, { ...st1.program.cursor, day });
    if (cand.entries.some((e) => wanted.includes(e.slotKey))) ses2 = cand;
  }
  eq(ses2.units, 'lb', 'a session started after the switch records lb');
  const e2 = ses2.entries.find((e) => wanted.includes(e.slotKey));
  e2.sets = e2.sets.map(() => ({ load: 340, reps: 3, rpe: 8, done: true }));
  store.update((s) => { s.sessions.push(ses2); s.activeSessionId = ses2.id; });
  store.update((s) => { completeSession(s, ses2.id); s.activeSessionId = null; });

  const s = store.getState();
  const loads = slotHistory(s, e2.slotKey).map((h) => h.topSet.load);
  ok(loads.every((l) => l > 300), 'a mixed-unit history reads out on one scale', loads.join(', '));
  const units = new Set(s.sessions.map((x) => x.units));
  eq(units.size, 2, 'the two sessions kept different recorded units');
}

// an older backup with no recorded units gets stamped on restore
{
  const legacy = {
    v: 1,
    profile: { units: 'lb', barWeight: 45, plates: [45, 35, 25, 10, 5, 2.5, 1.25], microplates: true },
    program: buildProgram({ templateId: INTERMEDIATE_PL.id }),
    onboarded: true,
    sessions: [{ id: 'old', status: 'done', date: '2026-01-01', cycle: 1, week: 1, day: 1, phase: 'load',
      entries: [{ slotKey: 'd1_bench', targetReps: 5, sets: [{ load: 225, reps: 5, rpe: 8, done: true }] }] }],
  };
  const res = store.importJSON(JSON.stringify(legacy));
  ok(res.ok, 'a v1 backup still restores');
  eq(store.getState().sessions[0].units, 'lb', 'a session with no recorded unit is stamped from the profile');
  eq(store.getState().v, store.SCHEMA_VERSION, 'and the state is migrated forward');
}

// convertLoad itself
near(convertLoad(100, 'kg', 'lb'), 220.462, 'convertLoad kg -> lb', 0.01);
near(convertLoad(220.462, 'lb', 'kg'), 100, 'convertLoad lb -> kg', 0.01);
eq(convertLoad(100, 'kg', 'kg'), 100, 'convertLoad is identity within a unit');
eq(convertLoad(null, 'kg', 'lb'), null, 'convertLoad passes null through');
eq(convertLoad(100, undefined, 'lb'), 100, 'convertLoad with an unknown source unit does not guess');

/* ======================================================================
   done
   ====================================================================== */
console.log(`\n\x1b[1m${fail ? '\x1b[31mFAILED' : '\x1b[32mPASSED'}\x1b[0m  ${pass} passed, ${fail} failed`);
if (problems.length) {
  console.log('\nFailures:');
  for (const p of problems) console.log('  ✗ ' + p);
}
process.exit(fail ? 1 : 0);
