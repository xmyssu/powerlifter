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
        slotE1RM, slotE1RMDetail, cyclePlan, convertUnits, slotHistory, lastComparable,
        templateOf, PAIN_WEEK_REPS, RELIABLE_E1RM_REPS, resolveTestDay, attemptsFor,
        bestMaxFor } = await import('./program.js');
const { pctOf1RM, e1RM, loadFor, plateBreakdown, roundToLoadable, plateLabel, minIncrement, convertLoad,
        loadBand, RPE_TOLERANCE } = await import('./rpe.js');
const { assessDeload, INTERMEDIATE_PL, INTERMEDIATE_PL_3DAY } = await import('./templates.js');
const { strengthTrend, trendSummary, sessionBriefing, trainingAgeReport, TRAINING_AGE_BANDS, milestones } = await import('./coach.js');

let pass = 0, fail = 0;
const problems = [];
function ok(cond, label, extra) {
  if (cond) { pass++; }
  else { fail++; problems.push(label + (extra ? `  [${extra}]` : '')); }
}
function eq(a, b, label) { ok(a === b, label, `got ${a}, want ${b}`); }
function near(a, b, label, tol = 0.01) { ok(Math.abs(a - b) <= tol, label, `got ${a}, want ~${b}`); }

const hr = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);

/** Find a slot definition by key in the currently-programmed template. */
function findTplSlot(key) {
  const tpl = templateOf(store.getState().program);
  for (const d of tpl.days) { const f = d.slots.find((x) => x.key === key); if (f) return f; }
  return null;
}

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

// Week 1's load was set so that week 1's reps hit RPE 8. Doing that same load
// for two fewer reps leaves two more reps in the tank, so the deload target is
// RPE 6 — printing 8 here is what talked a lifter into re-loading the bar.
eq(dlsq3.targetRPE, 6, 'deload drops the RPE by the reps the wave walked off (8 -> 6)');
const dlLegCurl = resolveDay(st, { day: 3 }).slots.find((s) => s.slotKey === 'd3_legcurl');
eq(dlLegCurl.targetRPE, 5, 'a two-rep-step slot floors at RPE 5 rather than printing an unloggable number');
const dlTech = resolveDay(st, { day: 2 }).slots.find((s) => s.slotKey === 'd2_squat');
eq(dlTech.targetRPE, 5, 'technique work is already submaximal and is left at RPE 5');

// The load window has to agree with the RPE printed above it.
const dlBand = dlsq3.loadRange;
ok(dlBand.low <= dlsq3.plannedLoad && dlsq3.plannedLoad <= dlBand.high, 'deload load sits inside its own band');

// The "worth a look" suggestion is drawn from loading weeks, so on a deload it
// can only ever argue for more weight. It must not be offered at all.
eq(dlsq3.rpeCheckLoad, null, 'no RPE-check suggestion is offered during a deload');
ok(resolveDay(st, { week: 3, day: 3, phase: 'load' }).slots
  .find((s) => s.slotKey === 'd3_squat').rpeCheckLoad != null, 'the RPE check still works on a loading week');

// finishing the deload week rolls into the next cycle and resets the counter
[1, 2, 3, 4].forEach(() => trainAsPrescribed());
st = store.getState();
eq(st.program.cursor.cycle, 3, 'deload week completes into cycle 3');
eq(st.program.cursor.phase, 'load', 'back to loading');
eq(st.program.cyclesSinceDeload, 0, 'deload resets the without-a-deload counter');

// A deload logged at its (light) prescription must not drag the estimate that
// picks the next cycle's loads, nor may it be what "last time" compares against.
const estAfterDeload = slotE1RM(st, 'd3_squat');
const loadingOnly = slotHistory(st, 'd3_squat').filter((h) => h.phase !== 'deload');
near(estAfterDeload, Math.max(...loadingOnly.slice(-3).map((h) => h.best1RM)),
  'the e1RM estimate ignores deload weeks', 0.1);
const cmp = lastComparable(st, 'd3_squat', { reps: 5 });
ok(cmp.phase !== 'deload', '"last time" skips the deload week');
eq(cmp.targetReps, 5, '"last time" matches the rep target being prescribed');

// A deload that still felt like work is a recovery reading worth surfacing.
// This runs as a probe off to the side: it logs an extra session, so the store
// is put back exactly as it was before the stall section starts from here.
const beforeProbe = JSON.stringify(store.getState());
const hotDeload = (() => {
  const s0 = store.getState();
  const ses = startSession(s0, { cycle: 3, week: 4, day: 3, phase: 'deload' });
  for (const entry of ses.entries) {
    entry.sets = entry.sets.map(() => ({
      load: entry.plannedLoad ?? 60, reps: entry.targetReps,
      rpe: (entry.targetRPE ?? 6) + 2, done: true, ts: new Date().toISOString(),
    }));
  }
  store.update((s) => { s.sessions.push(ses); s.activeSessionId = ses.id; });
  let out = [];
  store.update((s) => { out = completeSession(s, ses.id).notes; s.activeSessionId = null; });
  return out;
})();
ok(hotDeload.some((n) => n.kind === 'deloadHard'), 'a deload logged two RPE points hot raises a fatigue note');
store.update((s) => { const r = JSON.parse(beforeProbe); s.sessions = r.sessions; s.program = r.program; s.activeSessionId = null; });

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

// The squat works in 3-5s, so there is always a set short enough to estimate from.
const sqDetail = slotE1RMDetail(store.getState(), 'd3_squat');
ok(sqDetail.reliable, 'a 3-5 rep slot yields a reliable estimate');
ok(sqDetail.fromReps <= RELIABLE_E1RM_REPS, 'and it came off a set short enough to trust');

// The leg curl never goes below eight, so there is no reliable reading to be had.
// What matters is which unreliable one gets picked: high reps estimate high, so
// taking the biggest would mean a lifter adding weight every week watches the
// estimate fall as their reps come down. The shortest set is the honest choice.
const lcDetail = slotE1RMDetail(store.getState(), 'd3_legcurl');
ok(!lcDetail.reliable, 'an 8-12 rep slot is marked as an unreliable estimate');
const lcHist = slotHistory(store.getState(), 'd3_legcurl').filter((h) => h.phase !== 'deload').slice(-3);
eq(lcDetail.fromReps, Math.min(...lcHist.map((h) => h.estimatedFromReps)),
  'the unreliable estimate comes off the shortest set available, not the biggest number');
ok(lcDetail.value < Math.max(...lcHist.map((h) => h.best1RM)),
  'which is a smaller figure than the naive best-of would have produced');

/* ======================================================================
   9b. The high-rep (pain) week
   ====================================================================== */
hr('9b. High-rep week');

// Set up a clean cycle of its own so the checklist can be answered with pain only.
const painStore = JSON.stringify(store.getState());
store.update((s) => {
  s.profile = { ...s.profile, units: 'kg', barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25], microplates: true };
  s.maxes = { squat: { value: 170 }, bench: { value: 120 }, deadlift: { value: 200 } };
  s.program = buildProgram({ templateId: INTERMEDIATE_PL.id });
  s.sessions = [];
  s.activeSessionId = null;
});
for (let w = 0; w < 3; w++) [1, 2, 3, 4].forEach(() => trainAsPrescribed());

st = store.getState();
const beforePain = resolveDay(st, { week: 3, day: 3 }).slots.find((x) => x.slotKey === 'd3_squat');
let painRes = null;
store.update((s) => { painRes = resolveAssessment(s, { pain: true }); });
eq(painRes.action, 'painWeek', 'pain as the only flag routes to a high-rep week, not a deload');
st = store.getState();

const pw = resolveDay(st, { day: 3 });
ok(pw.isPainWeek, 'the resolved day knows it is a high-rep week');
eq(pw.label, 'High-rep week · Day 3', 'and is labelled as one rather than as week 4');

const pwSq = pw.slots.find((x) => x.slotKey === 'd3_squat');
eq(pwSq.reps, PAIN_WEEK_REPS, 'reps are raised to the high-rep target');
eq(pwSq.sets, 3, 'volume is unchanged — this is not a deload');
eq(pwSq.targetRPE, 8, 'RPE is unchanged — this is not a deload');
// The whole point is less load on the joint. Before this existed, week 4 fell off
// the end of the wave and prescribed a fourth increment: the heaviest session in
// the program, handed out as the remedy for joint pain.
ok(pwSq.plannedLoad < beforePain.plannedLoad,
  'the bar load drops rather than rising', `${pwSq.plannedLoad} vs ${beforePain.plannedLoad}`);
ok(pwSq.plannedLoad < st.program.slots.d3_squat.week1Load,
  'and lands below even the week-1 anchor, since the reps more than doubled');

// A slot that already lives at these reps is simply at its week 1.
const pwCurl = pw.slots.find((x) => x.slotKey === 'd3_legcurl');
eq(pwCurl.reps, PAIN_WEEK_REPS, 'an 8-12 slot tops out at the high-rep target');
eq(pwCurl.plannedLoad, st.program.slots.d3_legcurl.week1Load,
  'and runs at its week-1 load, because for it this simply is week 1');

// Technique work is 1-3 reps of skill practice at RPE 5 and is left alone — but
// it must still resolve against a real week rather than off the end of the wave.
const pwTech = resolveDay(st, { day: 2 }).slots.find((x) => x.slotKey === 'd2_squat');
eq(pwTech.reps, repsForWeek(findTplSlot('d2_squat'), st.program, 3), 'technique reps are the last loading week\'s');
eq(pwTech.targetRPE, 5, 'technique work stays at RPE 5');
eq(pwTech.plannedLoad, resolveDay(st, { week: 3, day: 2, phase: 'load' })
  .slots.find((x) => x.slotKey === 'd2_squat').plannedLoad,
  'and at the last loading week\'s load, not a fourth increment above it');

// It has to end. Before this, the cursor stayed on the pain week for ever.
const anchorBefore = st.program.slots.d3_squat.week1Load;
[1, 2, 3, 4].forEach(() => trainAsPrescribed());
st = store.getState();
eq(st.program.cursor.phase, 'load', 'the high-rep week rolls into the next cycle');
eq(st.program.cursor.cycle, 2, 'and the cycle counter moves');
eq(st.program.cursor.week, 1, 'back to week 1');
ok(!st.program.pendingAssessment, 'without re-raising the checklist it just answered');
eq(st.program.slots.d3_squat.week1Load, anchorBefore + 5, 'anchors roll forward as after any normal week');
eq(st.program.cyclesSinceDeload, 1, 'a high-rep week is not a deload, so the every-third-cycle backstop still counts');

store.update((s) => { const r = JSON.parse(painStore); s.profile = r.profile; s.maxes = r.maxes; s.sessions = r.sessions; s.program = r.program; s.activeSessionId = null; });

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
   14. Load range ("aim for") — the objective alternative to calling an RPE
   ====================================================================== */
hr('14. Load range');

// The band is scale-free: it is the ratio of table percentages, so it brackets
// whatever load is passed in regardless of where that load came from.
{
  eq(RPE_TOLERANCE, 0.5, 'the default window is half an RPE point either side');
  const b = loadBand(100, 5, 8);
  ok(b.low < 100 && b.high > 100, 'the band brackets the prescribed load');
  near(b.low, (100 * pctOf1RM(5, 7.5)) / pctOf1RM(5, 8), 'low end is the RPE 7.5 load');
  near(b.high, (100 * pctOf1RM(5, 8.5)) / pctOf1RM(5, 8), 'high end is the RPE 8.5 load');

  // ±0.5 RPE is roughly ±3% of the load, so the window stays tight.
  ok(b.high - b.low < 100 * 0.09, 'a ±0.5 RPE window is under 9% wide', `${(b.high - b.low).toFixed(2)}`);

  const wide = loadBand(100, 5, 8, { tolerance: 1 });
  ok(wide.high - wide.low > b.high - b.low, '±1 RPE is wider than ±0.5');

  // An explicit RPE window is honoured rather than replaced by the tolerance.
  const explicit = loadBand(100, 5, 7.5, { low: 7, high: 8 });
  near(explicit.low, (100 * pctOf1RM(5, 7)) / pctOf1RM(5, 7.5), 'explicit low end respected');
  near(explicit.high, (100 * pctOf1RM(5, 8)) / pctOf1RM(5, 7.5), 'explicit high end respected');

  // Scaling the input load scales the window with it.
  const doubled = loadBand(200, 5, 8);
  near(doubled.low / b.low, 2, 'the band scales linearly with load');

  eq(loadBand(null, 5, 8), null, 'no load, no band');
  eq(loadBand(100, 5, null), null, 'no RPE, no band');
  eq(loadBand(0, 5, 8), null, 'a zero load has no meaningful band');

  // At the top of the scale there is no headroom above RPE 10.
  const capped = loadBand(100, 5, 10);
  near(capped.high, 100, 'RPE 10 has nothing above it, so the band tops out at the load');
}

// End to end: every range in a resolved day sits on the real plate grid and
// contains the prescribed load.
{
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

  const step = minIncrement([25, 20, 15, 10, 5, 2.5, 1.25]);
  let checked = 0, offGrid = 0, notBracketing = 0, inverted = 0;

  for (let week = 1; week <= 3; week++) {
    for (let day = 1; day <= 4; day++) {
      const d = resolveDay(store.getState(), { cycle: 1, week, day, phase: 'load' });
      for (const slot of d.slots) {
        if (!slot.loadRange) continue;
        checked++;
        const { low, high } = slot.loadRange;
        // Prescribed loads must be loadable — estimates are exempt, ranges are not.
        for (const v of [low, high]) {
          if (roundToLoadable(v, { barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] }) !== v) offGrid++;
        }
        if (low > high) inverted++;
        if (slot.plannedLoad != null && (slot.plannedLoad < low || slot.plannedLoad > high)) notBracketing++;
      }
    }
  }

  ok(checked > 20, 'resolved a useful number of ranges across the wave', `${checked}`);
  eq(offGrid, 0, 'every range endpoint is a loadable weight');
  eq(inverted, 0, 'no range comes out backwards');
  eq(notBracketing, 0, 'the prescribed load always falls inside its range');
  ok(step === 2.5, 'plate grid step is as expected for this profile', `${step}`);
}

// A range narrower than the plate resolution collapses to a single weight
// rather than printing a bogus "30 – 30".
{
  store.update((s) => {
    s.profile.plates = [25, 20, 15, 10];   // coarsest grid: 20kg jumps
    s.profile.microplates = false;
  });
  const d = resolveDay(store.getState(), { cycle: 1, week: 1, day: 1, phase: 'load' });
  const collapsed = d.slots.filter((s) => s.loadRange?.exact);
  ok(collapsed.every((s) => s.loadRange.low === s.loadRange.high),
     'an exact range really has equal ends');
  ok(d.slots.filter((s) => s.loadRange).length > 0, 'coarse plates still produce ranges');
}

// Timed and rep-less slots have nothing to compute a range from.
{
  store.resetAll();
  store.update((s) => {
    s.program = buildProgram({ templateId: INTERMEDIATE_PL.id, startDate: '2026-08-03' });
    s.onboarded = true;
  });
  const d = resolveDay(store.getState(), { cycle: 1, week: 1, day: 1, phase: 'load' });
  const bad = d.slots.filter((s) => s.loadRange && (!s.reps || s.plannedLoad == null));
  eq(bad.length, 0, 'no range is invented for timed or load-less slots');
}

/* ======================================================================
   15. Three-day schedule (an adaptation, not a printed template)
   ====================================================================== */
hr('15. Three-day schedule');

// Structure: same work, three days.
{
  const four = INTERMEDIATE_PL, three = INTERMEDIATE_PL_3DAY;
  eq(three.days.length, 3, 'three training days');
  eq(three.daysPerWeek, 3, 'daysPerWeek says so too');
  eq(three.cycleWeeks, four.cycleWeeks, 'same 3-week wave as the four-day');
  eq(three.model, four.model, 'same wave model');
  ok(three.adapted === true, 'flagged as an adaptation');
  ok(!/p\. 263'$/.test(three.source || '') && /Adapted|Not a printed/.test(three.source),
     'source does not claim to be a printed template');

  const keysOf = (t) => t.days.flatMap((d) => d.slots.map((s) => s.key)).sort();
  const fk = keysOf(four), tk = keysOf(three);
  eq(tk.length, fk.length, 'no slot was dropped or invented');
  eq(tk.join(','), fk.join(','), 'slot keys match the four-day exactly, so switching carries state');
  eq(new Set(tk).size, tk.length, 'slot keys are unique within the template');

  // Every slot's prescription is carried across untouched.
  const flat = (t) => Object.fromEntries(t.days.flatMap((d) => d.slots.map((s) => [s.key, s])));
  const f = flat(four), t3 = flat(three);
  let drift = 0;
  for (const k of fk) {
    const a = f[k], b = t3[k];
    if (a.sets !== b.sets || a.rpe !== b.rpe || a.repStep !== b.repStep || a.inc !== b.inc
        || a.slotType !== b.slotType || a.role !== b.role || a.lift !== b.lift
        || JSON.stringify(a.repRange) !== JSON.stringify(b.repRange)
        || JSON.stringify(a.pctBand) !== JSON.stringify(b.pctBand)
        || !!a.excludeFromTotals !== !!b.excludeFromTotals) drift++;
  }
  eq(drift, 0, 'every slot keeps its sets, reps, RPE, band and increment');

  // The technique work must stay marked now that it has no day of its own.
  const tech = three.days.flatMap((d) => d.slots).filter((s) => s.technique);
  eq(tech.length, 3, 'the three technique slots are flagged');
  ok(tech.every((s) => s.rpe === 5), 'and they are the RPE 5 sets');
  ok(!three.days.some((d) => d.role === 'technique'), 'no day is a technique day any more');
  // Skill work should come while fresh: each technique slot leads its day.
  for (const d of three.days) {
    if (d.slots.some((s) => s.technique)) {
      ok(d.slots[0].technique, `day ${d.n} opens with its technique work`);
    }
  }
}

// Volume: identical to the four-day, and inside the book's target.
{
  store.resetAll();
  store.update((s) => {
    s.profile.units = 'kg'; s.profile.barWeight = 20;
    s.profile.plates = [25, 20, 15, 10, 5, 2.5, 1.25];
    s.maxes.squat = { value: 180, date: '2026-08-01', source: 'tested', reps: 3 };
    s.maxes.bench = { value: 120, date: '2026-08-01', source: 'tested', reps: 3 };
    s.maxes.deadlift = { value: 220, date: '2026-08-01', source: 'tested', reps: 3 };
    s.program = buildProgram({ templateId: INTERMEDIATE_PL.id, startDate: '2026-08-03' });
    s.onboarded = true;
  });
  const four = volumeAudit(store.getState());

  store.update((s) => { s.program = buildProgram({ templateId: INTERMEDIATE_PL_3DAY.id, startDate: '2026-08-03' }); });
  const three = volumeAudit(store.getState());

  eq(three.total, four.total, 'same number of counted working sets');
  eq(three.excluded, four.excluded, 'the leg curl is still excluded from totals');
  eq(three.main, four.main, 'same main/variation set count');
  eq(three.accessory, four.accessory, 'same accessory set count');
  for (const k of Object.keys(four.cats)) {
    eq(three.cats[k], four.cats[k], `${k}: same weekly sets as the four-day`);
  }
  for (const [k, v] of Object.entries(three.cats)) {
    ok(v >= 13 && v <= 15, `${k} sits inside the book's 13-15 target`, `${v}`);
  }
}

// It runs: a full three-week wave advances 3 days per week, then asks for the
// assessment — exactly like the four-day, just with one fewer day.
{
  const seen = [];
  for (let i = 0; i < 9; i++) {
    const before = store.getState().program.cursor;
    seen.push(`${before.week}.${before.day}`);
    trainAsPrescribed();
  }
  eq(seen.join(' '), '1.1 1.2 1.3 2.1 2.2 2.3 3.1 3.2 3.3',
     'nine sessions walk three days across three weeks');
  ok(store.getState().program.pendingAssessment,
     'after the last loading week it asks for the deload checklist');

  store.update((s) => { res = resolveAssessment(s, {}); });
  eq(res.action, 'proceed', 'a clean checklist proceeds into the next cycle');
  eq(store.getState().program.cursor.day, 1, 'and the next cycle starts on day 1');
}

// The folded-in technique sets must never be read as a stall, even though they
// no longer sit on a day whose role exempts them.
{
  store.resetAll();
  store.update((s) => {
    s.profile.units = 'kg'; s.profile.barWeight = 20;
    s.profile.plates = [25, 20, 15, 10, 5, 2.5, 1.25];
    s.maxes.squat = { value: 180, date: '2026-08-01', source: 'tested', reps: 3 };
    s.maxes.bench = { value: 120, date: '2026-08-01', source: 'tested', reps: 3 };
    s.maxes.deadlift = { value: 220, date: '2026-08-01', source: 'tested', reps: 3 };
    s.program = buildProgram({ templateId: INTERMEDIATE_PL_3DAY.id, startDate: '2026-08-03' });
    s.onboarded = true;
  });

  // Day 1 opens with deadlift technique triples. Come up short on purpose.
  const r1 = trainAsPrescribed({ d2_dead: { reps: 1, load: 40 } });
  eq(r1.notes.filter((n) => n.kind === 'stall').length, 0,
     'a short technique deadlift on the volume day is not a stall');
  eq(store.getState().program.slots.d2_dead.stalls, 0, 'and no stall is recorded');
  ok(!store.getState().program.forcedDeload, 'and no deload is forced');

  trainAsPrescribed();                                    // day 2, clean

  // Day 3 opens with squat + bench technique, then the heavy deadlift.
  const r3 = trainAsPrescribed({ d2_squat: { reps: 1, load: 40 }, d2_bench: { reps: 1, load: 40 } });
  eq(r3.notes.filter((n) => n.kind === 'stall').length, 0,
     'short technique squat/bench on a strength day is still not a stall');
  eq(store.getState().program.slots.d2_squat.stalls, 0, 'no stall on the technique squat');
  eq(store.getState().program.slots.d2_bench.stalls, 0, 'no stall on the technique bench');

  // But the genuinely heavy work on the same day still stalls normally.
  const r4 = trainAsPrescribed({ d4_dead: { reps: 1 } });  // week 2 day 1... walk to day 3
  let guard = 0;
  while (store.getState().program.cursor.day !== 3 && guard++ < 5) trainAsPrescribed();
  const heavy = trainAsPrescribed({ d4_dead: { reps: 1 } });
  ok(heavy.notes.some((n) => n.kind === 'stall') || store.getState().program.slots.d4_dead.stalls > 0,
     'the heavy deadlift on that same day does still stall');
}

// Switching between the two schedules carries choices, anchors and history.
{
  store.resetAll();
  store.update((s) => {
    s.profile.units = 'kg'; s.profile.barWeight = 20;
    s.profile.plates = [25, 20, 15, 10, 5, 2.5, 1.25];
    s.maxes.squat = { value: 180, date: '2026-08-01', source: 'tested', reps: 3 };
    s.maxes.bench = { value: 120, date: '2026-08-01', source: 'tested', reps: 3 };
    s.maxes.deadlift = { value: 220, date: '2026-08-01', source: 'tested', reps: 3 };
    s.program = buildProgram({ templateId: INTERMEDIATE_PL.id, startDate: '2026-08-03' });
    s.onboarded = true;
  });
  [1, 2, 3, 4].forEach(() => trainAsPrescribed());   // one four-day week logged

  const beforeChoices = { ...store.getState().program.choices };
  const beforeHistory = slotHistory(store.getState(), 'd3_squat').length;
  const beforeAnchor = store.getState().program.slots.d3_squat.week1Load;
  ok(beforeHistory > 0 && beforeAnchor > 0, 'we have history and an anchor to carry');

  store.update((s) => {
    const old = s.program;
    s.program = buildProgram({
      templateId: INTERMEDIATE_PL_3DAY.id, emphasis: old.emphasis,
      startDate: '2026-08-10', choices: old.choices,
    });
  });

  const after = store.getState();
  eq(templateOf(after.program).daysPerWeek, 3, 'now on the three-day');
  let lost = 0;
  for (const [k, v] of Object.entries(beforeChoices)) if (after.program.choices[k] !== v) lost++;
  eq(lost, 0, 'every exercise choice survived the switch');
  eq(slotHistory(after, 'd3_squat').length, beforeHistory, 'logged history is untouched');
  ok(Object.keys(after.program.slots).length === Object.keys(beforeChoices).length
     || Object.keys(after.program.slots).length > 0, 'slot state exists for the new template');

  // And every slot still resolves to something trainable on the new schedule.
  let unresolved = 0, days = 0;
  for (let day = 1; day <= 3; day++) {
    const d = resolveDay(after, { cycle: after.program.cursor.cycle, week: 1, day, phase: 'load' });
    days++;
    for (const s of d.slots) if (!s.exercise || !s.reps) unresolved++;
  }
  eq(days, 3, 'three days resolve');
  eq(unresolved, 0, 'every slot on the three-day resolves to a real exercise and rep target');
}

// The coach must still explain the technique work now that it has no day.
{
  store.resetAll();
  store.update((s) => {
    s.profile.units = 'kg'; s.profile.barWeight = 20;
    s.profile.plates = [25, 20, 15, 10, 5, 2.5, 1.25];
    s.maxes.squat = { value: 180, date: '2026-08-01', source: 'tested', reps: 3 };
    s.program = buildProgram({ templateId: INTERMEDIATE_PL_3DAY.id, startDate: '2026-08-03' });
    s.onboarded = true;
  });
  const st3 = store.getState();
  const d1 = sessionBriefing(resolveDay(st3, { cycle: 1, week: 1, day: 1, phase: 'load' }), st3);
  const d2 = sessionBriefing(resolveDay(st3, { cycle: 1, week: 1, day: 2, phase: 'load' }), st3);
  const d3 = sessionBriefing(resolveDay(st3, { cycle: 1, week: 1, day: 3, phase: 'load' }), st3);
  ok(d1.notes.some((n) => n.kind === 'technique'), 'day 1 explains its technique deadlifts');
  ok(!d2.notes.some((n) => n.kind === 'technique'), 'day 2 has no technique work, so no such note');
  ok(d3.notes.some((n) => n.kind === 'technique'), 'day 3 explains its technique squat/bench');
  ok(/never counted as a stall/.test(d3.notes.find((n) => n.kind === 'technique').text),
     'and it says coming up short there is not a stall');

  // The four-day keeps its original whole-day wording.
  store.update((s) => { s.program = buildProgram({ templateId: INTERMEDIATE_PL.id, startDate: '2026-08-03' }); });
  const st4 = store.getState();
  const f2 = sessionBriefing(resolveDay(st4, { cycle: 1, week: 1, day: 2, phase: 'load' }), st4);
  const tn = f2.notes.find((n) => n.kind === 'technique');
  ok(tn && /^Technique day/.test(tn.title), 'the four-day still calls it a technique day');
}

/* ======================================================================
   15b. Training age
   ====================================================================== */
hr('15b. Training age');
{
  store.update((s) => {
    s.profile = { ...s.profile, units: 'kg', barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25], microplates: true };
    s.maxes = { squat: { value: 170 }, bench: { value: 120 }, deadlift: { value: 200 } };
    s.program = buildProgram({ templateId: INTERMEDIATE_PL.id });
    s.sessions = [];
    s.activeSessionId = null;
  });
  for (let w = 0; w < 3; w++) [1, 2, 3, 4].forEach(() => trainAsPrescribed());

  const r = trainingAgeReport(store.getState());
  eq(r.age, 'intermediate', 'the report reads the training age off the template');
  eq(r.ready, false, 'a lifter who has never stalled is not ready to move up');
  eq(r.have, 0, 'no strength-day main qualifies yet');
  ok(r.need >= 1 && r.need <= r.rows.length, 'the bar is a real fraction of the strength mains', `${r.need}/${r.rows.length}`);
  ok(/No stalls/.test(r.why), 'and it says so in plain words', r.why);
  eq(TRAINING_AGE_BANDS.length, 3, 'three training-age bands');
  ok(TRAINING_AGE_BANDS.every((b) => b.adds && b.label), 'each band says how often you can add load');

  // Only strength-day mains count. Day 2 is technique work and is excluded by
  // name in the book, so it must not appear among the rows being judged.
  ok(!r.rows.some((x) => x.slotKey.startsWith('d2_')), 'technique-day lifts are not part of the criterion');
  ok(r.rows.length >= 2, 'the strength days contribute several mains', `${r.rows.length}`);

  // A lifter who has genuinely met the book's bar reads as ready.
  store.update((s) => {
    for (const row of r.rows) { s.program.slots[row.slotKey].smallIncrement = true; s.program.slots[row.slotKey].stalls = 2; }
  });
  const ready = trainingAgeReport(store.getState());
  eq(ready.ready, true, 'stalling twice on cut increments across the strength mains reads as ready');
  eq(ready.verdict, 'graduate', 'and the verdict says to move up');
  eq(ready.have, ready.rows.length, 'every main counted');

  // One stall is not the signal; the second one is.
  store.update((s) => {
    for (const row of r.rows) { s.program.slots[row.slotKey].smallIncrement = false; s.program.slots[row.slotKey].stalls = 1; }
  });
  const once = trainingAgeReport(store.getState());
  eq(once.ready, false, 'a single stall is not the signal to move up');
  ok(/second stall/.test(once.why), 'and the card explains that it is the second that counts', once.why);

  // A rate needs a span to be a rate. trainAsPrescribed stamps every session
  // with today's date, so this history spans zero days and the per-week figure
  // must come back null rather than as a confident-looking zero.
  const withRate = trainingAgeReport(store.getState());
  for (const l of withRate.lifts) {
    if (l.delta == null) continue;
    ok(Number.isFinite(l.delta), `${l.lift}: the 28-day change is a real number`, `${l.delta}`);
    eq(l.perWeek, null, `${l.lift}: a same-day history reports no weekly rate`);
    ok(l.days < 7, `${l.lift}: and says how short the window was`, `${l.days}`);
  }

  // Spread the same sessions over a real calendar and the rate appears.
  store.update((s) => {
    const start = new Date('2026-08-05T12:00:00Z');
    s.sessions.forEach((ses, i) => { ses.date = new Date(start.getTime() + i * 2 * 864e5).toISOString().slice(0, 10); });
  });
  const dated = trainingAgeReport(store.getState());
  const sq = dated.lifts.find((l) => l.lift === 'squat');
  ok(sq.days >= 7, 'a spread-out history spans enough days to rate', `${sq.days}`);
  ok(Number.isFinite(sq.perWeek), 'and then reports a weekly rate', `${sq.perWeek}`);
  ok(sq.perWeek > 0 && sq.perWeek < 10, 'which is a plausible weekly gain', `${sq.perWeek}`);
}

/* ======================================================================
   15c. Test day and milestones
   ====================================================================== */
hr('15c. Test day');
{
  store.update((s) => {
    s.profile = { ...s.profile, units: 'kg', barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25], microplates: true };
    s.maxes = { squat: { value: 150 }, bench: { value: 95 }, deadlift: { value: 173.5 } };
    s.program = buildProgram({ templateId: INTERMEDIATE_PL.id, meetDate: '2026-10-16' });
    s.sessions = [];
    s.activeSessionId = null;
  });
  for (let w = 0; w < 3; w++) [1, 2, 3, 4].forEach(() => trainAsPrescribed());

  const before = JSON.parse(JSON.stringify(store.getState().program.cursor));
  const pendingBefore = store.getState().program.pendingAssessment;
  const st0 = store.getState();

  const a = attemptsFor(st0, 'deadlift');
  ok(a.opener < a.second && a.second < a.third, 'attempts climb', `${a.opener}/${a.second}/${a.third}`);
  ok(a.opener < a.max, 'the opener is below the estimated max — it is insurance, not a test');
  ok(a.third > a.max, 'the third attempt is a weight the lifter has not done');
  for (const v of [a.opener, a.second, a.third, ...a.ramp.map((r) => r.load)]) {
    eq(roundToLoadable(v, st0.profile), v, 'every attempt and ramp load is loadable');
  }
  ok(a.ramp.length >= 3, 'there is a real warm-up ramp', `${a.ramp.length}`);
  ok(a.ramp.every((r, i, xs) => i === 0 || r.load > xs[i - 1].load), 'the ramp climbs');
  ok(a.ramp[a.ramp.length - 1].load < a.opener, 'and stops below the opener');

  const td = resolveTestDay(st0, {});
  ok(td.isTest, 'the resolved day knows it is a test');
  eq(td.label, 'Test day', 'and is labelled as one');
  eq(td.slots.length, 3, 'all three competition lifts by default');
  for (const sl of td.slots) {
    eq(sl.reps, 1, 'a test set is a single');
    eq(sl.sets, 3, 'three attempts');
    eq(sl.setLoads.length, 3, 'each attempt carries its own load');
    ok(sl.exerciseId, `${sl.slotKey} resolves to a real exercise`);
  }
  eq(resolveTestDay(st0, { lifts: ['deadlift'] }).slots.length, 1, 'a single-lift test day is possible');

  // startSession must give each attempt its own weight rather than repeating the first.
  const ses = startSession(st0, { ...st0.program.cursor, phase: 'test' });
  const dl = ses.entries.find((e) => e.slotKey === 'test_deadlift');
  eq(dl.sets.length, 3, 'three attempt rows');
  ok(dl.sets[0].load < dl.sets[1].load && dl.sets[1].load < dl.sets[2].load,
    'each row is pre-filled with its own attempt', dl.sets.map((x) => x.load).join('/'));

  // Log a successful third attempt.
  dl.sets = dl.sets.map((x) => ({ ...x, reps: 1, rpe: 10, done: true, ts: new Date().toISOString() }));
  for (const e of ses.entries) if (e.slotKey !== 'test_deadlift') e.sets = e.sets.map((x) => ({ ...x, done: false }));
  store.update((s) => { s.sessions.push(ses); s.activeSessionId = ses.id; });
  let tnotes = [];
  store.update((s) => { tnotes = completeSession(s, ses.id).notes; s.activeSessionId = null; });
  st = store.getState();

  ok(tnotes.some((n) => n.kind === 'tested'), 'a tested max is reported back');
  eq(st.maxes.deadlift.source, 'tested', 'and written to the maxes as tested');
  near(st.maxes.deadlift.value, dl.sets[2].load, 'a single at RPE 10 is the max itself', 0.05);

  // The whole point: a test day must not disturb the program.
  eq(JSON.stringify(st.program.cursor), JSON.stringify(before), 'a test day does not move the cursor');
  eq(st.program.pendingAssessment, pendingBefore, 'and leaves the checklist exactly as it found it');
  for (const [k, v] of Object.entries(st.program.slots)) {
    eq(v.stalls, 0, `a test day cannot stall ${k}`);
  }

  // A logged single is the truest point the trend can have.
  ok(strengthTrend(st, 'deadlift').some((p) => p.value >= dl.sets[2].load - 0.1),
    'the tested single reaches the strength trend');

  /* ---- milestones ---- */
  hr('15c. Milestones');
  const ms = milestones(st);
  const dlm = ms.find((m) => m.lift === 'deadlift');
  ok(dlm.next.length > 0, 'there is always a next milestone');
  ok(dlm.next.every((n) => n.load > (dlm.lifted || 0)), 'the next ones are all ahead of what has been lifted');
  ok(dlm.next.every((n, i, xs) => i === 0 || n.load >= xs[i - 1].load), 'and are listed nearest first');
  // "Four plates" means four 20 kg reds, not four of whatever is heaviest on the
  // rack. A gym with 25s does not make 170 kg three plates to anyone lifting in
  // it, and the whole point of a milestone is that it is the number the lifter
  // already had in their head.
  const allRows = ms.flatMap((m) => [...m.next, ...(m.cleared ? [m.cleared] : [])]);
  const four = allRows.find((n) => /^4 plates/.test(n.label));
  ok(four, 'there is a four-plate milestone');
  eq(four.load, 180, 'and four plates is 180 kg, not 4 x 25 + bar');
  const three = allRows.find((n) => /^3 plates/.test(n.label));
  if (three) eq(three.load, 140, 'three plates is 140 kg');
  ok(/180 kg/.test(four.label), 'the label carries the number as well as the plate count', four.label);

  // A gym with no 20s falls back rather than producing nothing.
  store.update((s) => { s.profile = { ...s.profile, plates: [25, 15, 10, 5, 2.5] }; });
  const odd = milestones(store.getState()).flatMap((m) => m.next);
  ok(odd.some((n) => n.kind === 'plates'), 'a gym without the standard plate still gets plate milestones');
  store.update((s) => { s.profile = { ...s.profile, plates: [25, 20, 15, 10, 5, 2.5, 1.25] }; });

  // Pounds keeps its own convention.
  store.update((s) => { s.profile = { ...s.profile, units: 'lb', barWeight: 45, plates: [45, 35, 25, 10, 5, 2.5] }; });
  const lb = milestones(store.getState()).flatMap((m) => [...m.next, ...(m.cleared ? [m.cleared] : [])]);
  const lb1 = lb.find((n) => /^1 plate\b/.test(n.label));
  if (lb1) eq(lb1.load, 135, 'one plate is 135 lb');
  store.update((s) => { s.profile = { ...s.profile, units: 'kg', barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] }; });
  // "done" must mean lifted, never estimated.
  for (const m of ms) {
    if (!m.cleared) continue;
    ok(m.lifted >= m.cleared.load - 1e-9, `${m.lift}: a cleared milestone was actually lifted`, `${m.lifted} vs ${m.cleared.load}`);
  }
  const anyInRange = ms.flatMap((m) => m.next).filter((n) => n.inRange);
  for (const n of anyInRange) ok(n.away <= 2.5 + 1e-9, 'in-range means within one small jump', `${n.away}`);
}

/* ======================================================================
   16. Invariants that hold for every template
   ----------------------------------------------------------------------
   The deload and the high-rep week were both wrong in the same shape: a phase
   the cursor could reach that nothing had actually resolved, so it inherited
   whatever the ordinary wave maths produced at a week number off the end of the
   range. Two sweeps, so the next phase added cannot repeat it.
   ====================================================================== */
hr('16. Cross-template invariants');

for (const id of [INTERMEDIATE_PL.id, INTERMEDIATE_PL_3DAY.id]) {
  store.update((s) => {
    s.profile = { ...s.profile, units: 'kg', barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25], microplates: true };
    s.maxes = { squat: { value: 170 }, bench: { value: 120 }, deadlift: { value: 200 } };
    s.program = buildProgram({ templateId: id });
    s.sessions = [];
    s.activeSessionId = null;
  });
  const tpl = templateOf(store.getState().program);
  const weeks = loadingWeeks(store.getState().program);
  for (let w = 0; w < weeks; w++) tpl.days.forEach(() => trainAsPrescribed());

  const base = store.getState();
  const heaviest = {};
  for (const d of tpl.days) {
    for (let w = 1; w <= weeks; w++) {
      for (const sl of resolveDay(base, { week: w, day: d.n, phase: 'load' }).slots) {
        if (sl.plannedLoad == null) continue;
        heaviest[sl.slotKey] = Math.max(heaviest[sl.slotKey] ?? 0, sl.plannedLoad);
      }
    }
  }

  // Answer the checklist for real rather than poking the cursor, so the routing
  // that puts the lifter into these phases is under test too.
  for (const [phase, answers] of [['deload', { dread: true, sleep: true }], ['painWeek', { pain: true }]]) {
    const snap = JSON.stringify(store.getState());
    let routed = null;
    store.update((s) => { routed = resolveAssessment(s, answers); });
    eq(routed.action, phase, `${id}: the checklist routes to ${phase}`);
    const stx = store.getState();
    eq(stx.program.cursor.phase, phase, `${id}: and the cursor follows it there`);
    for (const d of tpl.days) {
      for (const sl of resolveDay(stx, { day: d.n, phase }).slots) {
        // An easy week may never be the heaviest thing the program has asked for.
        if (sl.plannedLoad != null) {
          ok(sl.plannedLoad <= heaviest[sl.slotKey] + 1e-6,
            `${id} ${phase}: ${sl.slotKey} is not heavier than any loading week`,
            `${sl.plannedLoad} vs ${heaviest[sl.slotKey]}`);
        }
        // And it may never print an RPE the lifter has no way to log.
        const lows = [sl.targetRPE, ...(sl.rpeRange || [])].filter((r) => r != null);
        for (const r of lows) {
          ok(r >= 5 && r <= 10, `${id} ${phase}: ${sl.slotKey} RPE ${r} is on the scale`);
        }
        // Reps have to stay inside what a human can be asked for.
        if (sl.reps != null) ok(sl.reps >= 1 && sl.reps <= 20, `${id} ${phase}: ${sl.slotKey} reps are sane`, `got ${sl.reps}`);
      }
    }
    // Every non-proceed phase must terminate into the next cycle.
    tpl.days.forEach(() => trainAsPrescribed());
    const after = store.getState();
    eq(after.program.cursor.phase, 'load', `${id} ${phase}: rolls back into a loading phase`);
    ok(!after.program.pendingAssessment, `${id} ${phase}: does not re-raise the checklist it just answered`);
    store.update((s) => { const r = JSON.parse(snap); s.sessions = r.sessions; s.program = r.program; s.activeSessionId = null; });
  }
}

/* ======================================================================
   done
   ====================================================================== */
console.log(`\n\x1b[1m${fail ? '\x1b[31mFAILED' : '\x1b[32mPASSED'}\x1b[0m  ${pass} passed, ${fail} failed`);
if (problems.length) {
  console.log('\nFailures:');
  for (const p of problems) console.log('  ✗ ' + p);
}
process.exit(fail ? 1 : 0);
