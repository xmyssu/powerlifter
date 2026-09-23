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
  lastComparable, convertUnits, templateOf, entryStalled, entryShortfall, enterPeak, peakPlanFor,
  loadOptsFor, loadOptsForSlot, startNextCycle, warmupFor, attemptsFor,
  RELIABLE_E1RM_REPS, PAIN_WEEK_REPS, DELOAD_RPE_FLOOR, PEAK_WEEKS,
} = await import('./program.js');
const { meetProgress, targetLine, attemptAdvice } = await import('./meet.js');
const {
  pctOf1RM, e1RM, loadFor, eXRM, repsAt, loadBand, roundToLoadable, minIncrement,
  plateBreakdown, normalizeRPE, convertLoad, parseNum, loadStep, gridFloor, isLadder,
  PLATE_PRESETS, RPE_TOLERANCE, RPE_MIN, RPE_MAX, toKg, toLb, fmtLoad, fmtRPE,
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
   D2. The same sweep again, inside a peaking block.
   --------------------------------------------------------------------------
   The peak adds a phase the cursor can reach, two day shapes the template does
   not contain, and a per-slot deload — which is exactly the shape of every bug
   this file has ever caught. Meet week gets its own invariant on top of the
   general ones: nothing in it may be the heaviest the lifter has been asked for,
   because a taper that prescribes a peak load is not a taper.
   ====================================================================== */
hr('D2. Peaking sweep — every peak week x day, every gym');

let peakDays = 0;
for (const templateId of ['intermediate-pl', 'intermediate-pl-3day']) {
  for (const emphasis of ['balanced', 'intensity', 'volume']) {
    for (const gym of GYMS) {
      const st = stateFor({
        templateId, gym, emphasis,
        maxes: gym.units === 'kg' ? { squat: 170, bench: 120, deadlift: 200 }
                                  : { squat: 375, bench: 265, deadlift: 440 },
      });
      const tpl = templateOf(st.program);
      const weeks = loadingWeeks(st.program);

      // Anchors in place, so the wave has something to peak off.
      for (const key of Object.keys(st.program.slots)) {
        st.program.slots[key].week1Load = roundToLoadable(gym.barWeight + 40 * (gym.units === 'kg' ? 1 : 2.2), gym);
      }
      enterPeak(st);
      ok(!!st.program.peak, `the peak starts for ${templateId}/${gym.units}`);

      // The ceiling is the peak's *own* loading weeks, not the cycle before it.
      // Entering the block deliberately raises the anchor on every slot whose
      // reps dropped, so measuring meet week against the pre-peak wave would
      // assert that the peak is not allowed to have worked.
      const heaviest = {};
      for (const d of tpl.days) {
        for (let w = 1; w <= weeks; w++) {
          for (const sl of resolveDay(st, { week: w, day: d.n, phase: 'load' }).slots) {
            if (sl.plannedLoad != null) heaviest[sl.slotKey] = Math.max(heaviest[sl.slotKey] ?? 0, sl.plannedLoad);
          }
        }
      }

      // Peak weeks 1..3 as loading weeks, then meet week.
      const positions = [];
      for (let w = 1; w <= weeks; w++) for (const d of tpl.days) positions.push({ week: w, day: d.n, phase: 'load' });
      for (const d of tpl.days) positions.push({ week: PEAK_WEEKS, day: d.n, phase: 'meetWeek' });

      // The block has to have an end. Every template must place exactly one meet
      // day and one primer inside meet week, or the peak tapers forever — which
      // is what taking the book's "Day 4" literally did to the three-day week.
      const kinds = tpl.days.map((d) => peakPlanFor(st.program, { week: PEAK_WEEKS, day: d.n, phase: 'meetWeek' })?.kind);
      eq(kinds.filter((k) => k === 'meet').length, 1, `meet week has exactly one meet day (${templateId})`);
      eq(kinds.filter((k) => k === 'primer').length, 1, `and exactly one primer (${templateId})`);
      eq(kinds[kinds.length - 1], 'meet', `with the meet last (${templateId})`);
      const w3 = tpl.days.map((d) => peakPlanFor(st.program, { week: 3, day: d.n, phase: 'load' })?.kind);
      eq(w3.filter((k) => k === 'openers').length, 1, `week 3 has exactly one opener day (${templateId})`);

      const meetStep = gym.units === 'kg' ? 2.5 : 5;
      for (const pos of positions) {
        const day = resolveDay(st, pos);
        peakDays++;
        const tag = `peak ${templateId}/${emphasis}/${gym.units}${gym.barWeight}/d${pos.day}/w${pos.week}/${pos.phase}`;

        ok(typeof day.label === 'string' && day.label.length > 0, `the peak day has a label (${tag})`);
        ok(day.isPeak, `and knows it is part of the block (${tag})`);
        ok(Array.isArray(day.slots) && day.slots.length > 0, `and has something to do (${tag})`);

        for (const sl of day.slots) {
          const at = `${tag}/${sl.slotKey}`;
          finite(sl.plannedLoad, `plannedLoad is finite (${at})`);
          finite(sl.pct, `pct is finite (${at})`);
          ok(Number.isInteger(sl.sets) && sl.sets >= 1, `sets is a positive integer (${at})`, `got ${sl.sets}`);
          if (sl.reps != null) {
            ok(Number.isInteger(sl.reps) && sl.reps >= 1 && sl.reps <= 30, `reps is a sane integer (${at})`, `got ${sl.reps}`);
          }
          for (const r of [sl.targetRPE, ...(sl.rpeRange || [])]) {
            if (r == null) continue;
            ok(r >= RPE_MIN && r <= RPE_MAX, `RPE is on the scale (${at})`, `got ${r}`);
            eq(normalizeRPE(r), r, `the printed RPE survives normalisation (${at})`);
          }
          if (sl.plannedLoad != null) {
            // Meet day is the one session that does not happen in this gym, so
            // it is held to the platform's ladder instead of these plates: in
            // kg federations every attempt is a multiple of 2.5.
            if (day.isMeet) {
              const n = sl.plannedLoad / meetStep;
              ok(Math.abs(n - Math.round(n)) < 1e-9,
                `a meet-day attempt is a legal one (${at})`, `${sl.plannedLoad} is not a multiple of ${meetStep}`);
            } else {
              eq(roundToLoadable(sl.plannedLoad, gym), sl.plannedLoad, `the load is loadable (${at})`);
              ok(plateBreakdown(sl.plannedLoad, gym).ok, `and can be built from these plates (${at})`);
            }
            ok(sl.plannedLoad >= gym.barWeight - 1e-9, `and is at least the empty bar (${at})`, `got ${sl.plannedLoad}`);
          }
          // Meet week is a taper and the primer is RPE 4. Neither may hand the
          // lifter a load or an effort bigger than a loading week did.
          if (pos.phase === 'meetWeek' && sl.plannedLoad != null && heaviest[sl.slotKey] != null) {
            ok(sl.plannedLoad <= heaviest[sl.slotKey] + 1e-9,
              `meet week is never the heaviest week (${at})`, `${sl.plannedLoad} vs ${heaviest[sl.slotKey]}`);
          }
          if (day.peakKind === 'primer') {
            ok(sl.targetRPE != null && sl.targetRPE <= 5, `the primer stays at primer effort (${at})`, `got ${sl.targetRPE}`);
            eq(sl.reps, 1, `and is singles (${at})`);
          }
        }

        // Every day the block can reach must be startable and loggable.
        const ses = startSession(st, pos);
        ok(ses.entries.length > 0, `the day starts a real session (${tag})`);
        for (const e of ses.entries) {
          for (const set of e.sets) {
            if (set.load == null) continue;
            if (day.isMeet) {
              const n = set.load / meetStep;
              ok(Math.abs(n - Math.round(n)) < 1e-9,
                `pre-filled meet attempts are legal (${tag})`, `${set.load} is not a multiple of ${meetStep}`);
            } else {
              eq(roundToLoadable(set.load, gym), set.load, `pre-filled peak set loads are loadable (${tag})`);
            }
          }
        }
      }
    }
  }
}
console.log(`   ${peakDays} peak-day resolutions swept`);

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
   G2. Loading grids — every prescription lands on a weight that exists.
   ----------------------------------------------------------------------
   The barbell sweep in D asserts every load is loadable from the lifter's
   plates. That assertion is only true because every slot was assumed to be a
   barbell. Once a slot can be a weight stack, the same claim has to hold
   against *that* slot's own ladder — including both ends of the load window,
   the RPE-check suggestion, and the loads a stall reset and a unit switch make.
   ====================================================================== */
hr('G2. Loading grids — every load lands on the grid its own exercise has');

{
  /**
   * Is this load one of the weights that grid can actually make?
   *
   * Deliberately not `roundToLoadable(v) === v`: that asks the rounder to mark
   * its own homework, and a rounder that ignores grids entirely passes it.
   */
  const onGrid = (v, { barWeight = 20, plates = [], microplates = true, loading = null } = {}) => {
    if (v == null) return true;
    if (isLadder(loading)) {
      const n = (v - (Number(loading.start) || 0)) / Number(loading.step);
      return n >= -1e-9 && Math.abs(n - Math.round(n)) < 1e-6;
    }
    if (v < barWeight - 1e-9) return false;
    const step = minIncrement(plates, { microplates });
    const n = (v - barWeight) / step;
    return Math.abs(n - Math.round(n)) < 1e-6;
  };
  let ladders = 0;

  const LADDERS = [
    { mode: 'stack', start: 8, step: 8 },      // a pulldown that goes 72, 80, 88
    { mode: 'stack', start: 5, step: 5 },
    { mode: 'stack', start: 2.5, step: 7.5 },  // deliberately ugly
    { mode: 'fixed', start: 2, step: 2 },      // a dumbbell rack
    { mode: 'fixed', start: 10, step: 10 },
  ];

  for (const templateId of TEMPLATE_IDS) {
    for (const gym of GYMS.slice(0, 3)) {
      for (let li = 0; li < LADDERS.length; li++) {
        const st = stateFor({
          templateId, gym,
          maxes: gym.units === 'kg' ? { squat: 170, bench: 120, deadlift: 200 }
                                    : { squat: 375, bench: 265, deadlift: 440 },
        });
        const tpl = templateOf(st.program);
        const weeks = loadingWeeks(st.program);

        // Put a ladder on every other exercise, so each sweep has barbell and
        // stack slots side by side in the same session.
        const ids = [...new Set(Object.values(st.program.choices).filter(Boolean))];
        st.profile.loading = {};
        ids.forEach((id, i) => { if ((i + li) % 2 === 0) st.profile.loading[id] = { ...LADDERS[li] }; });

        for (const k of Object.keys(st.program.slots)) {
          st.program.slots[k].week1Load = roundToLoadable(
            gym.units === 'kg' ? 70 : 155, loadOptsForSlot(st, k));
        }

        for (const d of tpl.days) {
          for (const phase of ['load', 'deload', 'painWeek']) {
            const weekList = phase === 'load' ? Array.from({ length: weeks }, (_, i) => i + 1) : [weeks + 1];
            for (const week of weekList) {
              for (const sl of resolveDay(st, { week, day: d.n, phase }).slots) {
                const grid = loadOptsForSlot(st, sl.slotKey);
                const at = `${templateId}/${gym.units}/ladder${li}/${sl.slotKey}/w${week}/${phase}`;
                // Checked arithmetically rather than by round-tripping through
                // `roundToLoadable`: asking the rounder whether its own output is
                // rounded agrees with itself even when it is wrong.
                const snap = (v) => onGrid(v, grid);
                if (sl.plannedLoad != null) {
                  ladders += isLadder(grid.loading) ? 1 : 0;
                  ok(snap(sl.plannedLoad), `the load exists on this exercise grid (${at})`, `${sl.plannedLoad}`);
                  ok(sl.plannedLoad >= gridFloor(grid) - 1e-9,
                    `and is at least the lightest weight it has (${at})`, `${sl.plannedLoad} vs ${gridFloor(grid)}`);
                }
                if (sl.rpeCheckLoad != null) ok(snap(sl.rpeCheckLoad), `the RPE-check suggestion too (${at})`, `${sl.rpeCheckLoad}`);
                if (sl.loadRange) {
                  ok(snap(sl.loadRange.low), `and the bottom of the window (${at})`, `${sl.loadRange.low}`);
                  ok(snap(sl.loadRange.high), `and the top (${at})`, `${sl.loadRange.high}`);
                  ok(sl.loadRange.low <= sl.loadRange.high, `which stays ordered (${at})`);
                  if (sl.plannedLoad != null) {
                    ok(sl.loadRange.low <= sl.plannedLoad + 1e-9 && sl.plannedLoad <= sl.loadRange.high + 1e-9,
                      `and still brackets the load (${at})`, `${sl.loadRange.low}-${sl.loadRange.high} vs ${sl.plannedLoad}`);
                  }
                }
              }
            }
          }
        }

        // A stall reset must land on the grid too, and never below its floor.
        const before = {};
        for (const k of Object.keys(st.program.slots)) {
          before[k] = st.program.slots[k].week1Load;
          st.program.slots[k].stalledThisCycle = true;
          st.program.slots[k].stalledAtLoad = st.program.slots[k].week1Load;
        }
        startNextCycle(st);
        for (const k of Object.keys(st.program.slots)) {
          const grid = loadOptsForSlot(st, k);
          const v = st.program.slots[k].week1Load;
          const at = `${templateId}/${gym.units}/ladder${li}/${k}`;
          ok(onGrid(v, grid), `a stall reset lands on the grid (${at})`, `${v}`);
          ok(v >= gridFloor(grid) - 1e-9, `and never below the lightest weight there is (${at})`, `${v} vs ${gridFloor(grid)}`);
          ok(v <= before[k] + 1e-9, `and never heavier than what was stalled with (${at})`, `${before[k]} -> ${v}`);
        }

        // ...and so must everything a unit switch produces.
        const other = st.profile.units === 'kg' ? 'lb' : 'kg';
        convertUnits(st, other);
        for (const k of Object.keys(st.program.slots)) {
          const grid = loadOptsForSlot(st, k);
          const v = st.program.slots[k].week1Load;
          if (v == null) continue;
          ok(onGrid(v, grid),
            `a unit switch leaves every anchor loadable (${templateId}/${other}/ladder${li}/${k})`, `${v}`);
        }
        for (const g of Object.values(st.profile.loading)) {
          ok(isLadder(g), 'a converted grid is still a grid');
          ok(g.step > 0, 'with a positive step');
        }
      }
    }
  }
  // Without this the whole section can pass by never having configured a grid.
  ok(ladders > 500, 'the sweep actually put loads on ladders', `${ladders} ladder loads`);
  console.log(`   ${ladders} loads checked against a machine's own ladder`);
}

/* ======================================================================
   G3. Shortfall severity — the ordering must never invert.
   ====================================================================== */
hr('G3. Shortfall — missing more is never less serious');

{
  const RANK = { none: 0, soft: 1, hard: 2 };
  for (let seed = 900; seed < 1100; seed++) {
    const r = rng(seed);
    const targetSets = 2 + Math.floor(between(r, 0, 4));
    const targetReps = 1 + Math.floor(between(r, 0, 12));
    const prescribed = +between(r, 20, 200).toFixed(1);
    const step = [0, 1.25, 2.5, 5, 8][Math.floor(between(r, 0, 5))];
    const mk = (n) => Array.from({ length: targetSets }, (_, i) => ({
      done: true, load: prescribed, reps: i === targetSets - 1 ? Math.max(0, targetReps - n) : targetReps, rpe: 8,
    }));
    const entryOf = (n) => ({ targetSets, targetReps, prescribedLoad: prescribed, plannedLoad: prescribed, sets: mk(n) });

    let last = 0;
    for (let n = 0; n <= targetReps; n++) {
      const k = RANK[entryShortfall(entryOf(n), { step }).kind];
      ok(k >= last, `missing more reps never becomes less serious (seed ${seed}, ${n} short)`, `${k} after ${last}`);
      last = k;
    }
    eq(entryShortfall(entryOf(0), { step }).kind, 'none', `a session to plan is clean (seed ${seed})`);
    // Nor is the nearest weight the grid actually has a shortfall.
    const nearest = entryOf(0);
    nearest.sets = nearest.sets.map((x) => ({ ...x, load: prescribed - step }));
    eq(entryShortfall(nearest, { step }).kind, 'none',
      `nor is the nearest weight the grid has (seed ${seed}, step ${step})`);
  }
}

/* ======================================================================
   G4. The board — every outcome of nine attempts.
   ----------------------------------------------------------------------
   3^9 orderings is too many to enumerate usefully, but the invariants are
   simple and absolute: the total is the sum of made attempts, a bombed lift
   means no total at all, and the ceiling can never be below the board.
   ====================================================================== */
hr('G4. Meet day — nine attempts, every way they can go');

{
  const OUTCOMES = ['good', 'missed', 'pending'];
  const mkSession = (plan, loads) => ({
    units: 'kg',
    entries: ['test_squat', 'test_bench', 'test_deadlift'].map((slotKey, li) => ({
      slotKey, exerciseId: null, targetReps: 1,
      sets: [0, 1, 2].map((i) => {
        const o = plan[li][i];
        const load = loads[li][i];
        if (o === 'pending') return { load, reps: null, rpe: null, done: false };
        if (o === 'missed') return { load, reps: 0, rpe: null, failed: true, done: true };
        return { load, reps: 1, rpe: 9, done: true };
      }),
    })),
  });
  const st = stateFor({ templateId: 'intermediate-pl', gym: GYMS[0], maxes: { squat: 150, bench: 100, deadlift: 180 } });

  let swept = 0;
  for (let seed = 1200; seed < 1500; seed++) {
    const r = rng(seed);
    const plan = [0, 1, 2].map(() => [0, 1, 2].map(() => OUTCOMES[Math.floor(between(r, 0, 3))]));
    // A pending attempt before a taken one is not a thing that happens; sort so
    // each lift's attempts are taken in order.
    for (const row of plan) row.sort((a, b) => (a === 'pending' ? 1 : 0) - (b === 'pending' ? 1 : 0));
    const loads = [0, 1, 2].map((li) => {
      const base = [140, 95, 170][li];
      return [base, base + 7.5, base + 12.5];
    });
    const ses = mkSession(plan, loads);
    const p = meetProgress(st, ses);
    swept++;
    const at = `seed ${seed}`;

    ok(p.lifts.length === 3, `every lift is on the board (${at})`);
    ok(p.total >= 0, `the total is never negative (${at})`, `${p.total}`);
    ok(p.ifAllMade >= p.total - 1e-9, `the ceiling is never below the board (${at})`, `${p.ifAllMade} vs ${p.total}`);

    const anyBombed = p.lifts.some((l) => l.done && l.made === 0);
    eq(p.bombed, anyBombed, `bombing is exactly three misses on one lift (${at})`);
    if (anyBombed) {
      eq(p.total, 0, `a bombed lift is no total at all, not a smaller one (${at})`);
      eq(p.ifAllMade, 0, `and no ceiling either (${at})`);
    } else {
      const byHand = p.lifts.reduce((n, l) => {
        const made = l.attempts.filter((a) => a.status === 'good').map((a) => a.load);
        return n + (made.length ? Math.max(...made) : 0);
      }, 0);
      near(p.total, byHand, `the total is the best made attempt on each lift (${at})`, 1e-9);
    }

    // lastChance and bombed are mutually exclusive, and both are about the
    // same fact: this lift has nothing on the board.
    for (const l of p.lifts) {
      ok(!(l.lastChance && l.bombed), `a last chance is not yet a bomb (${at}/${l.lift})`);
      if (l.lastChance || l.bombed) eq(l.made, 0, `both mean nothing made (${at}/${l.lift})`);
      eq(l.made + l.misses + l.remaining, 3, `three attempts, always accounted for (${at}/${l.lift})`);
      if (l.made > 0) ok(l.best > 0, `a made lift has a best (${at}/${l.lift})`);
    }

    // nextUp is the first pending attempt in meet order, or nothing.
    const firstPending = p.lifts.flatMap((l) => l.attempts.map((a) => ({ l, a }))).find((x) => x.a.status === 'pending');
    if (!firstPending) eq(p.nextUp, null, `a finished meet has nothing next (${at})`);
    else eq(p.nextUp.lift, firstPending.l.lift, `next up is the first attempt still to come (${at})`);
    eq(p.complete, !firstPending, `and complete says the same thing (${at})`);

    // A target is only reachable when the weights already loaded can reach it.
    const tgt = targetLine(p, p.total + 20);
    if (tgt) {
      eq(tgt.reachable, tgt.toGo <= tgt.headroom + 1e-9, `reachable agrees with the arithmetic (${at})`);
      near(tgt.short, tgt.toGo - tgt.headroom, `and the shortfall is the difference (${at})`, 1e-6);
    }
    eq(targetLine(p, 0), null, `no target, no line (${at})`);

    // Advice never suggests adding weight to a bar you just failed.
    for (const l of p.lifts) {
      const adv = attemptAdvice(l, { step: 2.5 });
      if (!adv) { ok(l.done, `no advice only when the lift is finished (${at}/${l.lift})`); continue; }
      const idx = l.attempts.findIndex((a) => a.status === 'pending');
      const prev = idx > 0 ? l.attempts[idx - 1] : null;
      if (adv.load != null) {
        ok(adv.load > 0, `advised load is a real weight (${at}/${l.lift})`, `${adv.load}`);
        eq(adv.load % 2.5, 0, `and a legal attempt (${at}/${l.lift})`);
      }
      if (prev?.status === 'missed') {
        ok(adv.load <= prev.load + 1e-9,
          `never heavier than a weight already missed today (${at}/${l.lift})`, `${adv.load} vs ${prev.load}`);
      }
      if (prev?.status === 'good' && adv.load != null) {
        ok(adv.load > prev.load - 1e-9, `and never lighter than one already made (${at}/${l.lift})`);
      }
    }
  }
  console.log(`   ${swept} meets swept`);
}

/* ======================================================================
   G5. Warm-up ramps — loadable, ascending, and under the working weight.
   ====================================================================== */
hr('G5. Warm-ups — every rung is a weight you can load');

{
  const LADDER = { mode: 'stack', start: 8, step: 8 };
  let rungs = 0;
  for (const gym of GYMS) {
    for (const loading of [null, LADDER]) {
      const grid = loading ? { ...gym, loading } : gym;
      for (let seed = 1500; seed < 1560; seed++) {
        const r = rng(seed);
        const reps = 1 + Math.floor(between(r, 0, 15));
        const raw = between(r, gym.barWeight, gym.barWeight * 10);
        const load = roundToLoadable(raw, grid);
        const w = warmupFor(load, reps, grid);
        const at = `${gym.units}${gym.barWeight}/${loading ? 'stack' : 'bar'}/${load}x${reps}`;
        if (!w) { ok(load <= gridFloor(grid) + 1e-9, `no ramp only for the lightest weight there is (${at})`, `${load}`); continue; }
        let prev = -Infinity;
        for (const x of w.sets) {
          rungs++;
          eq(roundToLoadable(x.load, grid), x.load, `a rung is loadable (${at})`);
          ok(x.load < load - 1e-9, `and under the working weight (${at})`, `${x.load} vs ${load}`);
          ok(x.load > prev, `and heavier than the one before it (${at})`, `${x.load} after ${prev}`);
          ok(Number.isFinite(x.reps) || typeof x.reps === 'string', `with a rep target (${at})`);
          prev = x.load;
        }
        if (loading) ok(w.sets.every((x) => x.pct != null), `a stack has no empty-bar rung (${at})`);
      }
    }
  }
  console.log(`   ${rungs} warm-up rungs checked`);
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
