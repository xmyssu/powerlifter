/* ==========================================================================
   fuzz.test.mjs — property sweeps over the whole prescription space.
   Run: node js/fuzz.test.mjs
   No framework; exits non-zero on failure.
   --------------------------------------------------------------------------
   engine.test.mjs walks one lifter through one plausible training history and
   checks the numbers that come out. This file does the opposite: it enumerates
   or randomises every combination the app can reach — template x day x week x
   phase x slot x plate set x unit — and asserts the handful of things that must
   be true of all of them.

   That split is deliberate. Every bug found in this engine so far has had the
   same shape: not a wrong formula, but a *combination nobody enumerated* — a
   phase the cursor could reach that no branch resolved, so it inherited the
   ordinary wave maths at a week number off the end of the range. A worked
   example cannot find those, because writing one means thinking of the case.
   A sweep finds them by not needing to.

   Every generator is seeded, so a failure here reproduces exactly.
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
if (!globalThis.navigator) globalThis.navigator = {};
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o); } };

const store = await import('./store.js');
const {
  buildProgram, resolveDay, startSession, completeSession, resolveAssessment,
  repsForWeek, pctForWeek, loadingWeeks, slotE1RM, slotE1RMDetail, slotHistory,
  lastComparable, convertUnits, templateOf, entryStalled,
  RELIABLE_E1RM_REPS, PAIN_WEEK_REPS, DELOAD_RPE_FLOOR,
} = await import('./program.js');
const {
  pctOf1RM, e1RM, loadFor, eXRM, repsAt, loadBand, roundToLoadable, minIncrement,
  plateBreakdown, normalizeRPE, convertLoad, parseNum, PLATE_PRESETS, RPE_TOLERANCE,
  RPE_MIN, RPE_MAX, toKg, toLb, fmtLoad, fmtRPE,
} = await import('./rpe.js');
const { TEMPLATES, assessDeload, DELOAD_CHECKLIST } = await import('./templates.js');

/* ---- harness ---------------------------------------------------------- */

let pass = 0, fail = 0;
const problems = [];
const classes = new Map();   // failure kind -> {n, sample}
const MAX_REPORTED = 25;

/** The label with its parenthetical detail stripped, so 3000 instances of one
 *  broken invariant report as one line rather than burying the other kinds. */
const classOf = (label) => label
  .split('(')[0].trim()
  .replace(/\bd\d+_\w+\b/g, '<slot>')
  .replace(/\bthe \w+ anchor\b/g, 'the <slot> anchor');

function ok(cond, label, extra) {
  if (cond) { pass++; return true; }
  fail++;
  const k = classOf(label);
  const c = classes.get(k) || { n: 0, sample: label + (extra ? `  [${extra}]` : '') };
  c.n++;
  classes.set(k, c);
  if (problems.length < MAX_REPORTED) problems.push(label + (extra ? `  [${extra}]` : ''));
  return false;
}
const eq = (a, b, label) => ok(a === b, label, `got ${a}, want ${b}`);
const near = (a, b, label, tol = 1e-6) => ok(Math.abs(a - b) <= tol, label, `got ${a}, want ~${b}`);
const finite = (v, label) => ok(v == null || Number.isFinite(v), label, `got ${v}`);

const hr = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);
const t0 = Date.now();

/** Deterministic PRNG, so any failure below reproduces from its seed alone. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const between = (r, lo, hi) => lo + r() * (hi - lo);

const TEMPLATE_IDS = Object.keys(TEMPLATES);
const RPES = [];
for (let x = RPE_MIN; x <= RPE_MAX + 1e-9; x += 0.5) RPES.push(+x.toFixed(1));

/** Equipment sets a real lifter might actually be standing in front of. */
const GYMS = [
  { units: 'kg', barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25], microplates: true },
  { units: 'kg', barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5], microplates: true },
  { units: 'kg', barWeight: 20, plates: [25, 20, 10, 5], microplates: false },
  { units: 'kg', barWeight: 15, plates: [25, 20, 15, 10, 5, 2.5, 1.25], microplates: true },
  { units: 'lb', barWeight: 45, plates: [45, 35, 25, 10, 5, 2.5, 1.25], microplates: true },
  { units: 'lb', barWeight: 45, plates: [45, 25, 10, 5], microplates: false },
  { units: 'lb', barWeight: 35, plates: [45, 35, 25, 10, 5, 2.5], microplates: true },
];

/** A plain state object — resolveDay does not need the store. */
function stateFor({ templateId, gym, maxes, sessions = [], emphasis = 'balanced' }) {
  const base = store.defaultState();
  return {
    ...base,
    profile: { ...base.profile, ...gym },
    maxes: {
      squat: { value: maxes.squat }, bench: { value: maxes.bench }, deadlift: { value: maxes.deadlift },
    },
    program: buildProgram({ templateId, emphasis }),
    sessions,
    activeSessionId: null,
  };
}

/* ======================================================================
   A. The RPE table is a mathematical object; sweep its whole domain.
   ====================================================================== */
hr('A. RPE / %1RM table — exhaustive over reps 1-20 x RPE 5.5-10');

for (let reps = 1; reps <= 20; reps++) {
  for (const rpe of RPES) {
    const p = pctOf1RM(reps, rpe);
    const at = `${reps}@${rpe}`;
    ok(Number.isFinite(p) && p > 0, `pct is a real positive number (${at})`, `got ${p}`);
    ok(p <= 100 + 1e-9, `pct never exceeds 100% (${at})`, `got ${p}`);
    ok(p >= 20, `pct never collapses below the extrapolation floor (${at})`, `got ${p}`);

    // Harder work is a bigger percentage: monotone up in RPE, down in reps.
    if (rpe < RPE_MAX) {
      ok(p <= pctOf1RM(reps, rpe + 0.5) + 1e-9, `higher RPE is never lighter (${at})`);
    }
    if (reps < 20) {
      ok(p >= pctOf1RM(reps + 1, rpe) - 1e-9, `more reps is never heavier (${at})`);
    }

    // The identity the whole table is built on (p. 116): the grid is indexed by
    // reps-in-reserve plus reps, so dropping a rep and dropping a point of RPE
    // are the same move. This is the arithmetic the deload rests on — taking
    // week 1's load for two fewer reps is week 1's RPE minus two.
    if (reps >= 2 && rpe - 1 >= RPE_MIN) {
      near(pctOf1RM(reps, rpe), pctOf1RM(reps - 1, rpe - 1), `one fewer rep == one lower RPE (${at})`, 1e-9);
    }

    // Round trip: a load prescribed for these reps at this RPE must estimate
    // back to the max it was derived from.
    for (const max of [100, 137.5, 402.5]) {
      const load = loadFor(max, reps, rpe);
      near(e1RM(load, reps, rpe), max, `loadFor/e1RM round trip (${at}, max ${max})`, 1e-6);
    }
  }
}

// eXRM and repsAt sit on the same table and must agree with it.
for (let reps = 1; reps <= 12; reps++) {
  for (const rpe of [6, 7, 8, 9, 10]) {
    const max = 200;
    const x = eXRM(loadFor(max, reps, rpe), reps, rpe, reps);
    near(x, (max * pctOf1RM(reps, 10)) / 100, `eXRM agrees with the table (${reps}@${rpe})`, 1e-6);
    const r = repsAt(max, loadFor(max, reps, rpe), rpe);
    ok(r >= reps, `repsAt is consistent with loadFor (${reps}@${rpe})`, `got ${r}`);
  }
}

// normalizeRPE clamps and snaps, for anything a UI could hand it.
for (let v = 0; v <= 15; v += 0.1) {
  const n = normalizeRPE(v);
  ok(n >= RPE_MIN && n <= RPE_MAX, `normalizeRPE clamps to the scale (${v.toFixed(1)})`, `got ${n}`);
  near(n * 2, Math.round(n * 2), `normalizeRPE snaps to half points (${v.toFixed(1)})`, 1e-9);
}

/* ======================================================================
   B. Every load the app prints must be one the lifter can actually build.
   ====================================================================== */
hr('B. Plate math — every rounded load is loadable on the real bar');

for (const gym of GYMS) {
  const step = minIncrement(gym.plates, { microplates: gym.microplates });
  ok(step > 0, `a gym has a positive smallest jump (${gym.units}/${gym.plates.join('-')})`);

  for (let raw = gym.barWeight - 30; raw <= gym.barWeight + 400; raw += 1.7) {
    const r = roundToLoadable(raw, gym);
    const at = `${gym.units} ${raw.toFixed(1)}`;
    ok(Number.isFinite(r), `rounding returns a number (${at})`, `got ${r}`);
    ok(r >= gym.barWeight - 1e-9, `never rounds below the bar (${at})`, `got ${r}`);
    eq(roundToLoadable(r, gym), r, `rounding is idempotent (${at})`);

    const b = plateBreakdown(r, gym);
    ok(b.ok, `the rounded load can be built from the plates on hand (${at})`, `got ${r}`);
    if (b.ok) {
      const built = gym.barWeight + 2 * b.perSide.reduce((n, x) => n + x.plate * x.count, 0);
      near(built, r, `the plate breakdown sums back to the load (${at})`, 1e-6);
    }
  }

  // Monotone: a heavier request never rounds to a lighter bar.
  let prev = -Infinity;
  for (let raw = gym.barWeight; raw <= gym.barWeight + 200; raw += step / 3) {
    const r = roundToLoadable(raw, gym);
    ok(r >= prev - 1e-9, `rounding is monotone (${gym.units} ${raw.toFixed(2)})`);
    prev = r;
  }
}

/* ======================================================================
   C. The load window must always contain the load it was built around.
   ====================================================================== */
hr('C. Load band — the prescribed load always sits inside its own window');

for (const gym of GYMS.slice(0, 4)) {
  for (let reps = 1; reps <= 15; reps++) {
    for (const rpe of [5.5, 6, 7, 8, 9, 10]) {
      for (const load of [60, 92.5, 147.5, 205]) {
        const band = loadBand(load, reps, rpe, { tolerance: RPE_TOLERANCE });
        if (!ok(band != null, `a band exists (${reps}@${rpe}, ${load})`)) continue;
        ok(band.low <= load + 1e-9 && load <= band.high + 1e-9,
          `the band brackets the load (${reps}@${rpe}, ${load})`, `${band.low}-${band.high}`);
        ok(band.low <= band.high, `the band is ordered (${reps}@${rpe}, ${load})`);
        // Rounding both ends must not invert them, which is what puts an
        // impossible "aim for 142.5-140" on the card.
        const lo = roundToLoadable(band.low, gym), hi = roundToLoadable(band.high, gym);
        ok(lo <= hi, `the rounded band stays ordered (${reps}@${rpe}, ${load}, ${gym.units})`, `${lo}-${hi}`);
      }
    }
  }
}

/* ======================================================================
   D. Sweep every prescription the app can produce.
   ----------------------------------------------------------------------
   template x emphasis x gym x day x week x phase. This is the space the
   deload and the high-rep week were both wrong inside.
   ====================================================================== */
hr('D. Prescription sweep — every template x day x week x phase');

let resolved = 0;
for (const templateId of TEMPLATE_IDS) {
  for (const emphasis of ['balanced', 'squat', 'bench', 'deadlift']) {
    for (const gym of GYMS) {
      const st = stateFor({
        templateId, gym, emphasis,
        maxes: gym.units === 'kg' ? { squat: 170, bench: 120, deadlift: 200 }
                                  : { squat: 375, bench: 265, deadlift: 440 },
      });
      const tpl = templateOf(st.program);
      const weeks = loadingWeeks(st.program);

      // What the loading weeks ever ask for, per slot — the ceiling an easy
      // week must stay under.
      const heaviest = {};
      const hardest = {};
      const rpeOf = (sl) => (sl.rpeRange ? (sl.rpeRange[0] + sl.rpeRange[1]) / 2 : sl.targetRPE);
      for (const d of tpl.days) {
        for (let w = 1; w <= weeks; w++) {
          for (const sl of resolveDay(st, { week: w, day: d.n, phase: 'load' }).slots) {
            if (sl.plannedLoad != null) heaviest[sl.slotKey] = Math.max(heaviest[sl.slotKey] ?? 0, sl.plannedLoad);
            const r = rpeOf(sl);
            if (r != null) hardest[sl.slotKey] = Math.max(hardest[sl.slotKey] ?? 0, r);
          }
        }
      }

      for (const d of tpl.days) {
        for (const phase of ['load', 'deload', 'painWeek']) {
          const weekList = phase === 'load' ? Array.from({ length: weeks }, (_, i) => i + 1) : [weeks + 1];
          for (const week of weekList) {
            const day = resolveDay(st, { week, day: d.n, phase });
            resolved++;
            const tag = `${templateId}/${emphasis}/${gym.units}${gym.barWeight}/d${d.n}/w${week}/${phase}`;

            ok(typeof day.label === 'string' && day.label.length > 0, `the day has a label (${tag})`);
            eq(day.isDeload, phase === 'deload', `isDeload matches the phase (${tag})`);
            eq(day.isPainWeek, phase === 'painWeek', `isPainWeek matches the phase (${tag})`);

            for (const sl of day.slots) {
              const at = `${tag}/${sl.slotKey}`;
              // Where the deload derived a new RPE (rather than passing the
              // template's own through), it must respect its own floor.
              if (phase === 'deload' && sl.targetRPE != null && hardest[sl.slotKey] != null
                  && sl.targetRPE < hardest[sl.slotKey]) {
                ok(sl.targetRPE >= DELOAD_RPE_FLOOR, `a derived deload RPE respects its floor (${at})`, `got ${sl.targetRPE}`);
              }

              // Nothing may be NaN. A single NaN load renders as "—" and the
              // lifter is told nothing at all.
              finite(sl.plannedLoad, `plannedLoad is finite (${at})`);
              finite(sl.pct, `pct is finite (${at})`);
              finite(sl.rpeCheckLoad, `rpeCheckLoad is finite (${at})`);

              ok(Number.isInteger(sl.sets) && sl.sets >= 1, `sets is a positive integer (${at})`, `got ${sl.sets}`);
              if (sl.reps != null) {
                ok(Number.isInteger(sl.reps) && sl.reps >= 1 && sl.reps <= 30,
                  `reps is a sane integer (${at})`, `got ${sl.reps}`);
              }

              // Every RPE the card can print must be one the app can represent.
              // If it prints an RPE below RPE_MIN, `pctOf1RM` normalises it away
              // and silently computes a heavier load than the program asked for.
              for (const r of [sl.targetRPE, ...(sl.rpeRange || [])]) {
                if (r == null) continue;
                ok(r >= RPE_MIN && r <= RPE_MAX, `RPE is on the scale (${at})`, `got ${r}`);
                near(r * 2, Math.round(r * 2), `RPE is a half point (${at})`, 1e-9);
                eq(normalizeRPE(r), r, `the printed RPE survives normalisation unchanged (${at})`);
              }

              // An easy week is never asked for at a harder effort than the
              // loading weeks it is recovering from. This is the RPE half of the
              // "never the heaviest week" invariant, and it is the one the
              // intermediate deload broke by printing week 3's RPE 8 on a bar
              // deliberately loaded for RPE 6.
              const rpeHere = rpeOf(sl);
              if (phase !== 'load' && rpeHere != null && hardest[sl.slotKey] != null) {
                ok(rpeHere <= hardest[sl.slotKey] + 1e-9,
                  `an easy week is never harder than a loading week (${at})`,
                  `RPE ${rpeHere} vs ${hardest[sl.slotKey]}`);
              }
              if (sl.rpeRange) ok(sl.rpeRange[0] <= sl.rpeRange[1], `the RPE range is ordered (${at})`);
              if (sl.pct != null) ok(sl.pct > 20 && sl.pct <= 105, `pct is a plausible percentage (${at})`, `got ${sl.pct}`);

              if (sl.plannedLoad != null) {
                // The memory rule: a prescribed load sits on the real grid.
                eq(roundToLoadable(sl.plannedLoad, gym), sl.plannedLoad, `the load is loadable (${at})`);
                ok(plateBreakdown(sl.plannedLoad, gym).ok, `and can be built from these plates (${at})`);
                ok(sl.plannedLoad >= gym.barWeight - 1e-9, `and is at least the empty bar (${at})`, `got ${sl.plannedLoad}`);

                if (sl.loadRange) {
                  ok(sl.loadRange.low <= sl.plannedLoad + 1e-9 && sl.plannedLoad <= sl.loadRange.high + 1e-9,
                    `the load sits inside its own window (${at})`,
                    `${sl.loadRange.low}-${sl.loadRange.high} vs ${sl.plannedLoad}`);
                  eq(roundToLoadable(sl.loadRange.low, gym), sl.loadRange.low, `the window's low end is loadable (${at})`);
                  eq(roundToLoadable(sl.loadRange.high, gym), sl.loadRange.high, `the window's high end is loadable (${at})`);
                }

                // The invariant both known bugs violated.
                if (phase !== 'load' && heaviest[sl.slotKey] != null) {
                  ok(sl.plannedLoad <= heaviest[sl.slotKey] + 1e-9,
                    `an easy week is never the heaviest week (${at})`,
                    `${sl.plannedLoad} vs ${heaviest[sl.slotKey]}`);
                }
              }
            }
          }
        }
      }
    }
  }
}
console.log(`   ${resolved} day-resolutions swept`);

/* ======================================================================
   E. Randomised lifters, randomised training, over many cycles.
   ====================================================================== */
hr('E. Randomised training histories — 60 seeded lifters');

const SEEDS = 60;
for (let seed = 1; seed <= SEEDS; seed++) {
  const r = rng(seed);
  const gym = pick(r, GYMS);
  const templateId = pick(r, [ 'intermediate-pl', 'intermediate-pl-3day' ]);
  const scale = gym.units === 'kg' ? 1 : 2.2;

  mem.clear();
  store.update((s) => {
    Object.assign(s, store.defaultState());
    s.profile = { ...s.profile, ...gym };
    s.maxes = {
      squat: { value: Math.round(between(r, 90, 220) * scale) },
      bench: { value: Math.round(between(r, 60, 150) * scale) },
      deadlift: { value: Math.round(between(r, 110, 260) * scale) },
    };
    s.program = buildProgram({ templateId, emphasis: pick(r, ['balanced', 'squat', 'bench', 'deadlift']) });
  });

  const tag = `seed ${seed} (${templateId}, ${gym.units})`;
  const seenPhases = new Set();

  for (let session = 0; session < 40; session++) {
    let st = store.getState();

    // Answer the checklist whenever it is raised, sometimes honestly.
    if (st.program.pendingAssessment) {
      const answers = {};
      for (const c of DELOAD_CHECKLIST) if (r() < 0.3) answers[c.key] = true;
      let res = null;
      store.update((s) => { res = resolveAssessment(s, answers); });
      ok(['deload', 'painWeek', 'proceed'].includes(res.action), `the checklist always routes somewhere (${tag})`);
      st = store.getState();
      ok(!st.program.pendingAssessment, `answering the checklist clears it (${tag})`);
    }

    st = store.getState();
    const cur = { ...st.program.cursor };
    seenPhases.add(cur.phase);
    const tpl = templateOf(st.program);
    ok(tpl.days.some((d) => d.n === cur.day), `the cursor points at a real day (${tag}, ${JSON.stringify(cur)})`);
    ok(cur.week >= 1 && cur.week <= loadingWeeks(st.program) + 1,
      `the cursor's week is inside the cycle (${tag})`, `${cur.week}`);

    const ses = startSession(st, cur);
    for (const e of ses.entries) {
      // Every set the app pre-fills must be loadable before it is ever edited.
      for (const set of e.sets) {
        if (set.load != null) {
          eq(roundToLoadable(set.load, gym), set.load, `pre-filled set loads are loadable (${tag})`);
        }
      }
      // Log it the way a real session goes: mostly to plan, sometimes short,
      // sometimes lighter, sometimes with the RPE left blank.
      const roll = r();
      const short = roll < 0.12;
      const lighter = roll >= 0.12 && roll < 0.2;
      e.sets = e.sets.map(() => ({
        load: lighter ? roundToLoadable((e.plannedLoad ?? 60) * 0.9, gym) : (e.plannedLoad ?? 60),
        reps: short ? Math.max(1, (e.targetReps ?? 5) - 2) : (e.targetReps ?? 5),
        rpe: r() < 0.25 ? null : normalizeRPE((e.targetRPE ?? 8) + (r() < 0.5 ? -0.5 : 0.5)),
        done: true,
        ts: new Date().toISOString(),
      }));
    }
    store.update((s) => { s.sessions.push(ses); s.activeSessionId = ses.id; });

    let notes = [];
    const before = JSON.stringify(store.getState().program.cursor);
    store.update((s) => { notes = completeSession(s, ses.id).notes; s.activeSessionId = null; });
    st = store.getState();

    ok(Array.isArray(notes), `completing a session returns notes (${tag})`);
    for (const n of notes) {
      ok(typeof n.text === 'string' && n.text.length > 0, `every note carries text (${tag}, ${n.kind})`);
      ok(typeof n.title === 'string' && n.title.length > 0, `every note carries a title (${tag}, ${n.kind})`);
    }
    // A stall is only ever recorded against a loading week.
    if (notes.some((n) => n.kind === 'stall')) eq(ses.phase, 'load', `stalls only come from loading weeks (${tag})`);
    if (notes.some((n) => n.kind === 'deloadHard')) eq(ses.phase, 'deload', `the hot-deload note only comes from a deload (${tag})`);

    // The cursor must always move; a session that leaves it where it was is a
    // program that cannot be finished.
    ok(JSON.stringify(st.program.cursor) !== before || st.program.pendingAssessment,
      `the cursor advances or the checklist is raised (${tag})`);

    // Anchors are exact bookkeeping and are deliberately NOT snapped to the
    // plate grid — after a stall the halved increment can be smaller than one
    // step on the bar, and snapping would throw it away every cycle. So the
    // invariant is not "loadable" but "sane, and never drifting more than one
    // step away from something loadable".
    const gymStep = minIncrement(gym.plates, { microplates: gym.microplates });
    for (const [key, sl] of Object.entries(st.program.slots)) {
      if (sl.week1Load != null) {
        ok(Number.isFinite(sl.week1Load) && sl.week1Load > 0, `the ${key} anchor is a real load (${tag})`, `${sl.week1Load}`);
        ok(sl.week1Load >= gym.barWeight - 1e-9, `the ${key} anchor is at least the bar (${tag})`, `${sl.week1Load} vs bar ${gym.barWeight}`);
        ok(Math.abs(roundToLoadable(sl.week1Load, gym) - sl.week1Load) <= gymStep / 2 + 1e-9,
          `the ${key} anchor stays within a step of the grid (${tag})`, `${sl.week1Load}`);
      }
      if (sl.stalledAtLoad != null) {
        ok(sl.stalledAtLoad >= gym.barWeight - 1e-9, `the ${key} stall load is at least the bar (${tag})`);
      }
      ok(sl.stalls >= 0 && Number.isInteger(sl.stalls), `the ${key} stall count is a counter (${tag})`);
    }
    ok(st.program.cyclesSinceDeload >= 0, `the deload counter never goes negative (${tag})`);
  }

  // Over 40 sessions with a 30%-per-question checklist, a lifter must have been
  // through more than one kind of week — and must never be stuck in one.
  const finalSt = store.getState();
  ok(finalSt.program.cursor.cycle > 1, `${tag}: the program actually progressed`, `cycle ${finalSt.program.cursor.cycle}`);

  // Estimates drawn from that history must respect their own contract.
  for (const key of Object.keys(finalSt.program.slots)) {
    const d = slotE1RMDetail(finalSt, key);
    if (!d) continue;
    ok(Number.isFinite(d.value) && d.value > 0, `${tag}: ${key} estimate is a real number`, `${d.value}`);
    if (d.reliable) ok(d.fromReps <= RELIABLE_E1RM_REPS, `${tag}: a reliable estimate came off a short set`, `${d.fromReps}`);
    const used = slotHistory(finalSt, key).filter((h) => h.phase !== 'deload');
    ok(used.length > 0 || d == null, `${tag}: ${key} estimate has non-deload data behind it`);

    const cmp = lastComparable(finalSt, key, { reps: 5 });
    if (cmp) ok(cmp.phase !== 'deload' || used.length === 0, `${tag}: ${key} "last time" avoids deloads when it can`);
  }
}

/* ======================================================================
   F. Units are a presentation choice; the program underneath must survive.
   ====================================================================== */
hr('F. Unit conversion — round trips preserve a loadable program');

for (let seed = 100; seed < 140; seed++) {
  const r = rng(seed);
  mem.clear();
  store.update((s) => {
    Object.assign(s, store.defaultState());
    s.maxes = { squat: { value: Math.round(between(r, 100, 220)) }, bench: { value: Math.round(between(r, 60, 140)) }, deadlift: { value: Math.round(between(r, 120, 260)) } };
    s.program = buildProgram({ templateId: pick(r, ['intermediate-pl', 'intermediate-pl-3day']) });
  });
  for (let i = 0; i < 8; i++) {
    const st = store.getState();
    const ses = startSession(st, { ...st.program.cursor });
    for (const e of ses.entries) e.sets = e.sets.map(() => ({ load: e.plannedLoad ?? 60, reps: e.targetReps ?? 5, rpe: e.targetRPE ?? 8, done: true, ts: new Date().toISOString() }));
    store.update((s) => { s.sessions.push(ses); s.activeSessionId = ses.id; });
    store.update((s) => { completeSession(s, ses.id); s.activeSessionId = null; });
  }

  const kgAnchors = { ...store.getState().program.slots };
  store.update((s) => { convertUnits(s, 'lb'); });
  let st = store.getState();
  eq(st.profile.units, 'lb', `seed ${seed}: the profile switched to pounds`);
  for (const [k, sl] of Object.entries(st.program.slots)) {
    if (sl.week1Load == null) continue;
    eq(roundToLoadable(sl.week1Load, st.profile), sl.week1Load, `seed ${seed}: the ${k} anchor is loadable in lb`);
    ok(plateBreakdown(sl.week1Load, st.profile).ok, `seed ${seed}: and buildable from lb plates`);
  }
  // Sessions logged in kg must still resolve and display sensibly in lb.
  for (const key of Object.keys(st.program.slots)) {
    for (const h of slotHistory(st, key)) {
      finite(h.best1RM, `seed ${seed}: ${key} history estimates survive the switch`);
      ok(h.units === 'lb', `seed ${seed}: ${key} history is reported in the display unit`);
    }
  }

  store.update((s) => { convertUnits(s, 'kg'); });
  st = store.getState();
  eq(st.profile.units, 'kg', `seed ${seed}: and back to kilos`);
  for (const [k, sl] of Object.entries(st.program.slots)) {
    if (sl.week1Load == null || kgAnchors[k]?.week1Load == null) continue;
    // A round trip through a foreign plate grid cannot be lossless, but it must
    // not drift further than the grid it passed through.
    ok(Math.abs(sl.week1Load - kgAnchors[k].week1Load) <= 2.5 + 1e-9,
      `seed ${seed}: the ${k} anchor survives a kg->lb->kg round trip`,
      `${kgAnchors[k].week1Load} -> ${sl.week1Load}`);
    eq(roundToLoadable(sl.week1Load, st.profile), sl.week1Load, `seed ${seed}: and is loadable again`);
  }
}

/* ======================================================================
   G. The deload checklist is a pure function; enumerate its whole domain.
   ====================================================================== */
hr('G. Deload checklist — all 32 answer combinations');

const keys = DELOAD_CHECKLIST.map((c) => c.key);
for (let mask = 0; mask < (1 << keys.length); mask++) {
  const answers = {};
  keys.forEach((k, i) => { if (mask & (1 << i)) answers[k] = true; });
  const n = Object.keys(answers).length;
  const v = assessDeload(answers);
  const at = `[${Object.keys(answers).join(',') || 'none'}]`;
  ok(['deload', 'painWeek', 'proceed'].includes(v.verdict), `a verdict is always returned ${at}`, v.verdict);
  ok(typeof v.why === 'string' && v.why.length > 0, `a reason is always given ${at}`);
  eq(v.yes, n, `the flag count is reported ${at}`);
  if (n >= 2) eq(v.verdict, 'deload', `two or more flags is always a deload ${at}`);
  if (n === 1 && answers.pain) eq(v.verdict, 'painWeek', `pain alone is always the high-rep week ${at}`);
  if (n === 0) eq(v.verdict, 'proceed', `no flags always proceeds ${at}`);
}

/* ======================================================================
   H. Input parsing — the gym floor is a hostile environment.
   ====================================================================== */
hr('H. Number parsing — comma decimals, spaces, junk');

const PARSE_CASES = [
  ['82.5', 82.5], ['82,5', 82.5], [' 82.5 ', 82.5], ['82 . 5', 82.5],
  ['100', 100], ['0', 0], ['-5', -5], ['', null], ['  ', null],
  ['abc', null], [null, null], [undefined, null], ['1e3', 1000], ['.5', 0.5], [',5', 0.5],
];
for (const [input, want] of PARSE_CASES) {
  eq(parseNum(input), want, `parseNum(${JSON.stringify(input)})`);
}
for (let seed = 200; seed < 260; seed++) {
  const r = rng(seed);
  const n = +between(r, 0, 400).toFixed(2);
  near(parseNum(String(n)), n, `a period decimal round trips (seed ${seed})`, 1e-9);
  near(parseNum(String(n).replace('.', ',')), n, `a comma decimal round trips (seed ${seed})`, 1e-9);
}

/* ======================================================================
   done
   ====================================================================== */
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n\x1b[1m${fail ? '\x1b[31mFAILED' : '\x1b[32mPASSED'}\x1b[0m  ${pass} passed, ${fail} failed  (${secs}s)`);
if (classes.size) {
  console.log(`\n${classes.size} distinct failure class${classes.size === 1 ? '' : 'es'}:`);
  for (const [k, c] of [...classes.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ✗ ${String(c.n).padStart(6)} x  ${k}`);
    console.log(`           e.g. ${c.sample}`);
  }
}
process.exit(fail ? 1 : 0);
