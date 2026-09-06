/* ==========================================================================
   program.js — program instantiation, prescription resolution, progression
   --------------------------------------------------------------------------
   The book's model in one paragraph: within a 3-week wave, sets stay constant,
   reps drop by one per week, and load goes up one increment per week. After
   three weeks you run the deload checklist; if you need it, week 4 is a deload
   at week 3's reps and week 1's load for two-thirds of the sets. The next cycle
   restarts at the top of the rep range, one increment above the previous
   cycle's week-1 load. Load itself is chosen by first-set RPE — the listed
   %1RM is only a reference for where that ought to land.
   ========================================================================== */

import { TEMPLATES, INTERMEDIATE_PL, EMPHASIS, incrementFor, assessDeload } from './templates.js';
import { SLOT_DEFAULTS, byId } from './exercises.js';
import { e1RM, loadFor, roundToLoadable, pctOf1RM, normalizeRPE, convertLoad, loadBand, RPE_TOLERANCE, PLATE_PRESETS, KG_PER_LB } from './rpe.js';
import { todayISO, uid } from './store.js';

/* ---- construction ----------------------------------------------------- */

export function buildProgram({
  templateId = INTERMEDIATE_PL.id,
  choices = {},
  emphasis = 'balanced',
  startDate = todayISO(),
  meetDate = null,
} = {}) {
  const tpl = TEMPLATES[templateId];
  if (!tpl) throw new Error(`Unknown template: ${templateId}`);

  const slotState = {};
  for (const day of tpl.days) {
    for (const slot of day.slots) {
      slotState[slot.key] = {
        week1Load: null,        // anchor load for week 1 of the current cycle
        increment: null,        // resolved on first use, from units
        smallIncrement: false,  // halved after a stall (book step 4, p. 244)
        extendedRange: false,   // rep range widened by a rep each side (p. 244)
        stalls: 0,
        stalledThisCycle: false,
        stalledAtLoad: null,
      };
    }
  }

  const resolvedChoices = {};
  for (const day of tpl.days) {
    for (const slot of day.slots) {
      resolvedChoices[slot.key] = choices[slot.key] || SLOT_DEFAULTS[slot.slotType] || null;
    }
  }

  return {
    id: uid('prg'),
    templateId,
    startDate,
    emphasis,
    meetDate,
    choices: resolvedChoices,
    slots: slotState,
    cursor: { cycle: 1, week: 1, day: 1, phase: 'load' },
    cyclesSinceDeload: 0,
    pendingAssessment: false,   // set when a cycle's loading weeks are done
    forcedDeload: false,        // a stall forces week 4 regardless of checklist
    events: [],                 // program-level history for the coach log
  };
}

export const templateOf = (program) => TEMPLATES[program?.templateId] || INTERMEDIATE_PL;

/** Lowest RPE the app will print. The RPE scale itself stops at 5 (p. 130), so
 *  a deload that derives lower than that is described as "5" rather than as a
 *  number the lifter has no way to log. */
export const DELOAD_RPE_FLOOR = 5;

/**
 * Above this many reps a 1RM estimate stops being trustworthy (p. 116).
 *
 * This is not merely noise. High-rep sets estimate *higher*, systematically —
 * the same lifter's 12-rep set and 3-rep set do not agree, and the 12 reads
 * bigger. That matters because the obvious way to combine several sessions is
 * to take the best one, and "best" then means "whichever week had the most
 * reps". A lifter adding weight to a leg curl every week can watch the estimate
 * fall as their reps come down and they actually get stronger.
 */
export const RELIABLE_E1RM_REPS = 6;

/**
 * The high-rep week (Level 1, pp. 40-42; the checklist's `painWeek` verdict).
 *
 * Joint and tendon pain as the *only* flag does not call for a deload — it calls
 * for the same volume and the same RPE at reps high enough to bring the bar
 * load down. Twelve is the bottom of the book's 12-20 window: enough to drop
 * peak joint stress hard, few enough that a squat session is still a squat
 * session.
 */
export const PAIN_WEEK_REPS = 12;

/* ---- slot geometry ---------------------------------------------------- */

/** Effective rep range for a slot, after emphasis and any widening. */
export function repRangeFor(slot, program) {
  const st = program?.slots?.[slot.key];
  const tpl = templateOf(program);
  let range = slot.repRange ? [...slot.repRange] : null;
  if (!range) return null;

  // Emphasis re-tuning (p. 228) applies only to the 3-5 @ 82.5-87.5% strength slots.
  const emph = EMPHASIS[program?.emphasis] || EMPHASIS.balanced;
  if (emph.repShift && slot.pctBand && slot.repRange[0] === 3 && slot.repRange[1] === 5) {
    range = [range[0] + emph.repShift, range[1] + emph.repShift];
  }
  // Peaking overrides the strength-day main lifts down to 1-3.
  const override = program?.peak?.repRangeOverrides?.[slot.key];
  if (override) range = [...override];

  if (st?.extendedRange) {
    const step = slot.repStep || 1;
    range = [range[0] - step, range[1] + step];
    if (range[0] < 1) range[0] = 1;
  }
  return range;
}

/** Reps prescribed for a given week index (1-based) of the loading wave. */
export function repsForWeek(slot, program, week) {
  const tpl = templateOf(program);

  if (slot.fixedReps != null) return slot.fixedReps;

  // Advanced blocks: a flat weekly delta off a base.
  if (tpl.model === 'block' && slot.baseReps != null) {
    const r = slot.baseReps + (tpl.weeklyRepDelta || -1) * (week - 1);
    return Math.max(1, r);
  }

  const range = repRangeFor(slot, program);
  if (!range) return null;
  const step = slot.repStep || 1;
  return Math.max(range[0], range[1] - step * (week - 1));
}

/** Number of loading weeks the wave needs to walk the whole rep range. */
export function loadingWeeks(program) {
  const tpl = templateOf(program);
  if (tpl.model === 'block') return tpl.cycleWeeks;
  let max = tpl.cycleWeeks;
  for (const day of tpl.days) {
    for (const slot of day.slots) {
      const range = repRangeFor(slot, program);
      if (!range) continue;
      const step = slot.repStep || 1;
      max = Math.max(max, Math.round((range[1] - range[0]) / step) + 1);
    }
  }
  return max;
}

/** Reference %1RM for a slot in a given week. */
export function pctForWeek(slot, program, week) {
  const tpl = templateOf(program);
  const emph = EMPHASIS[program?.emphasis] || EMPHASIS.balanced;

  if (tpl.model === 'block' && slot.pctBase != null) {
    return slot.pctBase + (tpl.weeklyPctDelta || 0) * (week - 1);
  }
  if (slot.pctBase != null) return slot.pctBase;
  if (!slot.pctBand) return null;

  // The band maps onto the wave: lowest % on the highest-rep week.
  const range = repRangeFor(slot, program);
  const weeks = range ? Math.round((range[1] - range[0]) / (slot.repStep || 1)) + 1 : 3;
  let [lo, hi] = slot.pctBand;
  if (emph.pctShift && slot.repRange?.[0] === 3 && slot.repRange?.[1] === 5) {
    lo += emph.pctShift; hi += emph.pctShift;
  }
  if (weeks <= 1) return hi;
  const t = Math.min(1, Math.max(0, (week - 1) / (weeks - 1)));
  return +(lo + (hi - lo) * t).toFixed(2);
}

export function incrementOf(slot, program, units) {
  const st = program?.slots?.[slot.key];
  return incrementFor(slot, units, { small: !!st?.smallIncrement });
}

/* ---- history ---------------------------------------------------------- */

/**
 * Every completed entry for a slot, oldest first.
 *
 * Loads come back in the profile's current unit regardless of the unit they were
 * logged in. This is what the progression engine reads to decide the next load,
 * so a session recorded in pounds must not be compared against a kilo anchor.
 */
export function slotHistory(state, slotKey) {
  const to = state.profile?.units;
  const out = [];
  for (const s of state.sessions) {
    if (s.status !== 'done') continue;
    const from = s.units || to;
    for (const e of s.entries) {
      if (e.slotKey !== slotKey) continue;
      const sets = (e.sets || [])
        .filter((x) => x.done && x.load > 0 && x.reps > 0)
        .map((x) => (from === to ? x : { ...x, load: convertLoad(x.load, from, to) }));
      if (!sets.length) continue;
      out.push({
        sessionId: s.id,
        date: s.date,
        cycle: s.cycle,
        week: s.week,
        day: s.day,
        phase: s.phase,
        units: to,
        exerciseId: e.exerciseId,
        targetReps: e.targetReps,
        targetRPE: e.targetRPE,
        plannedLoad: from === to ? e.plannedLoad : convertLoad(e.plannedLoad, from, to),
        sets,
        topSet: sets.reduce((a, b) => (b.load > a.load ? b : a), sets[0]),
        firstSet: sets[0],
        best1RM: Math.max(...sets.map((x) => e1RM(x.load, x.reps, x.rpe ?? e.targetRPE ?? 8) || 0)),
        // The same figure restricted to sets short enough to estimate from, plus
        // the rep count it came off. Callers that are about to prescribe a load
        // need both: an estimate drawn from a set of twelve is only good for
        // prescribing around twelve.
        ...reliableOf(sets, e),
      });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * The best estimate a session's sets support, and how far it had to reach.
 *
 * `reliable1RM` is taken only from sets at or under RELIABLE_E1RM_REPS. When a
 * slot never goes that low — a leg curl lives at 8-12 — there is no reliable
 * reading to be had, so `soft1RM` comes off the *shortest* set on record rather
 * than the biggest number. The shortest set is the least extrapolated one, and
 * picking the biggest is precisely the mistake that makes a stronger lifter's
 * estimate go down.
 */
function reliableOf(sets, entry) {
  const est = (x) => e1RM(x.load, x.reps, x.rpe ?? entry.targetRPE ?? 8) || 0;
  const good = sets.filter((x) => x.reps <= RELIABLE_E1RM_REPS);
  if (good.length) {
    return {
      reliable1RM: Math.max(...good.map(est)),
      soft1RM: null,
      estimatedFromReps: Math.min(...good.map((x) => x.reps)),
    };
  }
  const shortest = sets.reduce((a, b) => (b.reps < a.reps ? b : a), sets[0]);
  const tied = sets.filter((x) => x.reps === shortest.reps);
  return {
    reliable1RM: null,
    soft1RM: Math.max(...tied.map(est)),
    estimatedFromReps: shortest.reps,
  };
}

/**
 * Most recent usable estimate of a slot's 1RM, with the caveats attached.
 *
 * Returns { value, reliable, fromReps, date } or null.
 *
 * Two exclusions, for the same reason in both cases: the number is about to be
 * turned into a load and put in front of a lifter, so it must not be drawn from
 * data that cannot support it.
 *
 *  - Deload weeks are deliberately light. An estimate from one says nothing
 *    about current capability — the reasoning `trendSummary` already spells out
 *    before dropping them from the progress stats, which applies with more force
 *    here than it does to a chart.
 *  - Sets above RELIABLE_E1RM_REPS estimate high and estimate inconsistently.
 *    Where a slot offers anything shorter, that wins outright; where it never
 *    does, the estimate is returned marked `reliable: false` along with the rep
 *    count behind it, so callers can decline to extrapolate away from it.
 */
export function slotE1RMDetail(state, slotKey, { lookback = 6, window = 3 } = {}) {
  const hist = slotHistory(state, slotKey).filter((h) => h.phase !== 'deload').slice(-lookback);
  if (!hist.length) return null;
  // Weight recency: take the best of the last few sessions, which smooths a
  // single bad day without letting a stale PR dominate.
  const recent = hist.slice(-window);

  const solid = recent.filter((h) => h.reliable1RM > 0);
  if (solid.length) {
    const pick = solid.reduce((a, b) => (b.reliable1RM > a.reliable1RM ? b : a), solid[0]);
    return { value: pick.reliable1RM, reliable: true, fromReps: pick.estimatedFromReps, date: pick.date };
  }

  // Nothing short enough on record. Take the least extrapolated reading rather
  // than the largest, and say so.
  const soft = recent.filter((h) => h.soft1RM > 0);
  if (!soft.length) return null;
  const pick = soft.reduce((a, b) => (b.estimatedFromReps < a.estimatedFromReps ? b : a), soft[0]);
  return { value: pick.soft1RM, reliable: false, fromReps: pick.estimatedFromReps, date: pick.date };
}

/** Most recent usable estimate of a slot's 1RM. */
export function slotE1RM(state, slotKey, opts) {
  return slotE1RMDetail(state, slotKey, opts)?.value ?? null;
}

/**
 * The most recent session worth showing next to today's prescription.
 *
 * "Last time" is only useful if it is comparable. Straight after a deload the
 * previous session for a slot is two light sets of the wave's lowest reps, and
 * putting that beside week 1 of the next cycle reads as though the lifter has
 * gone backwards. So: prefer the last loading session at the same rep target,
 * fall back to the last loading session, and only fall back to the deload
 * itself when there is nothing else on record.
 */
export function lastComparable(state, slotKey, { reps = null, excludeSessionId = null } = {}) {
  const hist = slotHistory(state, slotKey).filter((h) => h.sessionId !== excludeSessionId);
  if (!hist.length) return null;
  const loading = hist.filter((h) => h.phase !== 'deload');
  const sameReps = reps == null ? [] : loading.filter((h) => h.targetReps === reps);
  const pick = sameReps[sameReps.length - 1] || loading[loading.length - 1] || hist[hist.length - 1];
  if (!pick) return null;
  return { ...pick, matchedReps: sameReps.length > 0 };
}

/* ---- prescription ---------------------------------------------------- */

/**
 * Resolve one training day into concrete prescriptions.
 * Returns { template, day, week, cycle, phase, slots: [...] }
 */
export function resolveDay(state, { cycle, week, day, phase } = {}) {
  const program = state.program;
  const tpl = templateOf(program);
  const cur = program.cursor;
  cycle = cycle ?? cur.cycle;
  week = week ?? cur.week;
  day = day ?? cur.day;
  phase = phase ?? cur.phase;

  const units = state.profile.units;
  const dayDef = tpl.days.find((d) => d.n === day) || tpl.days[0];
  const isDeload = phase === 'deload';
  const isPainWeek = phase === 'painWeek';
  const loadOpts = {
    barWeight: state.profile.barWeight,
    plates: state.profile.plates,
    microplates: state.profile.microplates,
  };

  const slots = dayDef.slots.map((slot, i) => {
    const st = program.slots[slot.key] || {};
    const exId = program.choices[slot.key];
    const ex = byId(exId);
    const inc = incrementOf(slot, program, units);
    const weeksInWave = loadingWeeks(program);

    // --- sets / reps -------------------------------------------------
    // A pain week sits at week `loadingWeeks + 1`, which is off the end of the
    // wave. Anything the rep raise below does not touch still has to resolve
    // against a real week, or `repsForWeek` walks past the bottom of the rep
    // range and `plannedLoad` adds a fourth increment — which is how asking for
    // relief from joint pain produced the heaviest session in the program.
    const waveWeek = isPainWeek ? Math.min(week, weeksInWave) : week;

    let sets = slot.sets;
    let reps = repsForWeek(slot, program, waveWeek);
    let targetRPE = slot.rpe ?? null;
    let rpeRange = slot.rpeRange ? [...slot.rpeRange] : null;
    let pct = pctForWeek(slot, program, waveWeek);
    let repsRaised = false;

    if (isDeload) {
      // Intermediate: lowest reps and lowest load of the wave, two-thirds of the sets.
      // Advanced: repeat week 3 at two-thirds sets, RPE -1, %1RM -5.
      sets = Math.max(1, Math.floor((slot.sets * 2) / 3));
      if (tpl.model === 'block') {
        reps = repsForWeek(slot, program, tpl.cycleWeeks);
        const floorTo = (r) => Math.max(DELOAD_RPE_FLOOR, r - 1);
        if (rpeRange) rpeRange = rpeRange.map(floorTo);
        if (targetRPE != null) targetRPE = floorTo(targetRPE);
        // "Repeat week 3" — so the percentage is week 3's, minus five points.
        const w3pct = pctForWeek(slot, program, tpl.cycleWeeks);
        pct = w3pct == null ? null : w3pct - 5;
      } else {
        reps = repsForWeek(slot, program, weeksInWave);   // the lowest rep week
        pct = pctForWeek(slot, program, 1);               // the lightest load

        // ...and therefore a lower RPE, which has to be said out loud.
        //
        // Week 1's load was chosen so that week 1's reps landed on the slot's
        // RPE. The deload takes that same load for the wave's lowest rep count,
        // and at a fixed load every rep you do not do is one more rep in
        // reserve — so the honest target is the slot's RPE minus the reps the
        // wave walked off. On the 3-5 strength slots that is RPE 8 minus two:
        // RPE 6.
        //
        // Leaving the loading week's RPE on the card is not cosmetic. It made
        // the load window, the RPE-check suggestion and the stored history all
        // describe a hard set, so the app would tell a lifter mid-deload that
        // their own data says to put week 3's weight back on the bar.
        const dropped = repsForWeek(slot, program, 1) - reps;
        if (dropped > 0 && !slot.technique) {
          // Technique work is submaximal by design and never progresses, so it
          // is already its own deload; dropping it further says nothing.
          const floorTo = (r) => Math.max(DELOAD_RPE_FLOOR, r - dropped);
          if (targetRPE != null) targetRPE = floorTo(targetRPE);
          if (rpeRange) rpeRange = rpeRange.map(floorTo);
        }
      }
    }

    if (isPainWeek && !slot.technique && !slot.timed && !slot.fixedReps && reps != null) {
      // Same sets, same RPE, reps raised until the bar load comes down. Only the
      // reps move: dropping the RPE too would make this a deload, which is the
      // thing the checklist just decided against, and cutting sets would give up
      // the volume this week exists to preserve.
      //
      // Technique work is left alone. It is 1-3 reps of skill practice at RPE 5
      // that never progresses, and taking it to twelve would not be the same
      // exercise.
      reps = Math.max(reps, PAIN_WEEK_REPS);
      pct = targetRPE != null ? pctOf1RM(reps, targetRPE) : pct;
      repsRaised = true;
    }

    // --- load --------------------------------------------------------
    const plan = plannedLoad({ state, program, slot, week: waveWeek, isDeload, repsRaised, inc, pct, reps, targetRPE, rpeRange });
    const planned = plan.load == null ? null : roundToLoadable(plan.load, loadOpts);
    const loadRange = bandFor(planned, reps, targetRPE, rpeRange, loadOpts);

    return {
      index: i,
      slot,
      slotKey: slot.key,
      exerciseId: exId,
      exercise: ex,
      role: slot.role,
      sets,
      reps,
      targetRPE,
      rpeRange,
      rpeMax: slot.rpeMax ?? null,
      pct,
      timed: !!slot.timed,
      prescription: slot.prescription || null,
      plannedLoad: planned,
      loadRange,
      loadSource: plan.source,
      loadNote: plan.note,
      rpeCheckLoad: plan.rpeCheck == null ? null : roundToLoadable(plan.rpeCheck, loadOpts),
      increment: inc,
      lastTime: plan.lastTime,
    };
  });

  return {
    template: tpl,
    dayDef,
    cycle, week, day, phase,
    isDeload,
    isPainWeek,
    label: dayLabel(tpl, dayDef, { week, cycle, phase }),
    scheduleNote: tpl.scheduleNote || null,
    why: dayDef.why || null,
    title: dayDef.title || null,
    slots,
  };
}

/**
 * Where the suggested load comes from, in priority order:
 *   1. the wave anchor from this cycle's week 1, plus one increment per week
 *   2. the %1RM reference against a known competition max
 *   3. what your own recent RPE data implies for these reps at this RPE
 *   4. nothing — you work up by feel and the app learns from it
 */
function plannedLoad({ state, program, slot, week, isDeload, repsRaised, inc, pct, reps, targetRPE, rpeRange }) {
  const st = program.slots[slot.key] || {};
  const hist = slotHistory(state, slot.key);
  const last = hist.length ? hist[hist.length - 1] : null;

  const targetForRPE = rpeRange ? (rpeRange[0] + rpeRange[1]) / 2 : targetRPE;
  const detail = slotE1RMDetail(state, slot.key);
  const est = detail?.value ?? null;

  // Whether the estimate is allowed to argue with the program today.
  //
  //  - On a deload the load *is* the prescription: it was picked to be light,
  //    not to hit an RPE, so a second opinion drawn from loading weeks can only
  //    argue for more weight, which is the one thing a deload must not do.
  //  - An estimate that came off a set of twelve is only good for prescribing
  //    around twelve. The bias in a high-rep e1RM cancels when you prescribe at
  //    the reps you measured and compounds when you do not, so an unreliable
  //    estimate may only speak near its own rep count.
  const canCheck = detail && (detail.reliable || Math.abs(detail.fromReps - reps) <= 2);
  const rpeCheck = !isDeload && canCheck && est && reps && targetForRPE
    ? loadFor(est, reps, targetForRPE)
    : null;

  // A high-rep week has to leave the wave behind: the anchor was chosen for a
  // set of five, and this is a set of twelve at the same RPE. Scale it through
  // the RPE table instead — the ratio of percentages is the whole conversion,
  // and it stays tied to the lifter's own anchor rather than to an estimate.
  if (repsRaised && st.week1Load) {
    const fromReps = repsForWeek(slot, program, 1);
    const a = fromReps && targetForRPE ? pctOf1RM(fromReps, targetForRPE) : null;
    const b = reps && targetForRPE ? pctOf1RM(reps, targetForRPE) : null;
    // When the slot already lived at these reps the ratio is 1 and this lands
    // exactly on the week-1 anchor, which is the right answer: for a leg curl
    // prescribed 8-12, the high-rep week simply is its week 1.
    if (a && b) {
      return {
        load: (st.week1Load * b) / a,
        source: 'painWeek',
        note: reps === fromReps
          ? `High-rep week: this slot already lives at ${reps} reps, so it runs at its week-1 load.`
          : `High-rep week: same sets, same RPE, ${reps} reps instead of ${fromReps} so the bar load drops. This is converted from your week-1 anchor through the RPE table — nobody can predict a ${reps}RM from a ${fromReps}RM, so treat it as a starting guess and let the RPE decide.`,
        rpeCheck,
        lastTime: last,
      };
    }
  }

  if (isDeload) {
    const anchor = st.week1Load;
    if (anchor) return { load: anchor, source: 'deload', note: 'Deload: week 1 load, week 3 reps, two-thirds of the sets. It should feel easy — that is the prescription, not a bonus.', rpeCheck, lastTime: last };
  }

  // 1. wave anchor
  if (st.week1Load) {
    const load = st.week1Load + inc * (week - 1);
    return {
      load,
      source: 'wave',
      note: week === 1
        ? 'Week 1 anchor — carried from last cycle plus one increment.'
        : `Week ${week} of the wave: ${week - 1} × ${inc} above this cycle's week 1.`,
      rpeCheck,
      lastTime: last,
    };
  }

  // 2. %1RM reference against a tested max
  if (pct != null && slot.lift) {
    const max = state.maxes[slot.lift]?.value;
    if (max) {
      return {
        load: (max * pct) / 100,
        source: 'pct',
        note: `${pct}% of your ${slot.lift} max — a reference. Adjust so set 1 lands on the target RPE.`,
        rpeCheck,
        lastTime: last,
      };
    }
  }

  // 3. inferred from your own logged RPE
  if (rpeCheck) {
    return {
      load: rpeCheck,
      source: 'estimated',
      note: 'Estimated from your recent sets on this exercise. Treat it as a starting guess.',
      rpeCheck: null,
      lastTime: last,
    };
  }

  // 4. work up by feel
  return {
    load: null,
    source: 'discover',
    note: targetForRPE
      ? `First time on this one. Work up until ${reps} reps feels like RPE ${targetForRPE}, then log it — the app takes over from here.`
      : 'First time on this one. Work up by feel and log what you do.',
    rpeCheck: null,
    lastTime: last,
  };
}

/**
 * The loadable weight window to aim for — an objective target for lifters who
 * would rather not stake the session on an RPE call made mid-set.
 *
 * Both ends are rounded onto the lifter's own plate grid, so every number in a
 * displayed range is a weight that can literally be loaded. Because rounding is
 * monotonic and the band is built around `load`, the prescribed load always
 * falls inside the window.
 *
 * A program-declared rpeRange is used as-is; a single target RPE gets
 * ± RPE_TOLERANCE. `exact` means the window came out narrower than the smallest
 * available plate jump, so there is only one weight to aim for.
 */
function bandFor(load, reps, targetRPE, rpeRange, loadOpts) {
  if (load == null || !reps) return null;
  const center = rpeRange ? (rpeRange[0] + rpeRange[1]) / 2 : targetRPE;
  if (center == null) return null;

  const band = loadBand(load, reps, center, rpeRange
    ? { low: rpeRange[0], high: rpeRange[1] }
    : { tolerance: RPE_TOLERANCE });
  if (!band) return null;

  const low = roundToLoadable(band.low, loadOpts);
  const high = roundToLoadable(band.high, loadOpts);
  if (low == null || high == null) return null;
  return { low: Math.min(low, high), high: Math.max(low, high), exact: low === high };
}

function dayLabel(tpl, dayDef, { week, cycle, phase }) {
  if (dayDef.off) return 'Rest day';
  if (dayDef.meet) return 'Meet day';
  if (phase === 'deload') return `Deload · Day ${dayDef.n}`;
  if (phase === 'painWeek') return `High-rep week · Day ${dayDef.n}`;
  return `${tpl.name.includes('Advanced') ? tpl.block ? cap(tpl.block) : 'Block' : 'Week'} ${week} · Day ${dayDef.n} · ${dayDef.label}`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---- session lifecycle ----------------------------------------------- */

export function startSession(state, position) {
  const resolved = resolveDay(state, position);
  return {
    id: uid('ses'),
    date: todayISO(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'active',
    templateId: state.program.templateId,
    // The unit these loads get written in. Switching units later leaves them
    // alone, so this is the only record of what the numbers mean.
    units: state.profile.units,
    cycle: resolved.cycle,
    week: resolved.week,
    day: resolved.day,
    phase: resolved.phase,
    entries: resolved.slots.map((s) => ({
      slotKey: s.slotKey,
      exerciseId: s.exerciseId,
      targetSets: s.sets,
      targetReps: s.reps,
      targetRPE: s.targetRPE,
      rpeRange: s.rpeRange,
      plannedLoad: s.plannedLoad,
      pct: s.pct,
      note: '',
      sets: Array.from({ length: s.sets }, () => ({ load: s.plannedLoad, reps: null, rpe: null, done: false, ts: null })),
    })),
    sessionRPE: null,
    notes: '',
    readiness: null,
  };
}

/** Did a slot fall short of what was prescribed? (book's definition of a stall) */
export function entryStalled(entry) {
  const done = (entry.sets || []).filter((s) => s.done);
  if (!done.length) return false;
  const target = entry.targetReps;
  const planned = entry.plannedLoad;
  const missedReps = done.some((s) => s.reps != null && target != null && s.reps < target);
  const droppedLoad = planned != null && done.some((s) => s.load != null && s.load < planned - 1e-6);
  const shortSets = done.length < (entry.targetSets || done.length);
  return missedReps || droppedLoad || shortSets;
}

/**
 * Close out a session: fold what actually happened back into the program's
 * progression state and advance the cursor.
 */
export function completeSession(state, sessionId) {
  const program = state.program;
  const tpl = templateOf(program);
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return { state, notes: [] };

  const notes = [];
  const units = state.profile.units;
  const strengthDays = tpl.days.filter((d) => d.role === 'strength').map((d) => d.n);

  session.status = 'done';
  session.endedAt = new Date().toISOString();

  for (const entry of session.entries) {
    const slot = findSlot(tpl, entry.slotKey);
    if (!slot) continue;
    const st = program.slots[entry.slotKey];
    if (!st) continue;

    const doneSets = (entry.sets || []).filter((s) => s.done && s.load > 0);
    if (!doneSets.length) continue;

    // The week-1 load of a cycle is the anchor the whole wave is built from.
    if (session.week === 1 && session.phase === 'load') {
      st.week1Load = doneSets[0].load;
    }

    if (entryStalled(entry) && session.phase === 'load') {
      // Technique work is meant to stay submaximal forever, so falling short of
      // it is never a stall. On the 4-day that is a whole day; on the 3-day the
      // same sets are folded into other days, so the slot flag has to count too.
      const isTechniqueDay = tpl.days.find((d) => d.n === session.day)?.role === 'technique';
      if (!isTechniqueDay && !slot.technique) {
        if (!st.stalledThisCycle) {
          st.stalledThisCycle = true;
          st.stalledAtLoad = doneSets[0].load;
          st.stalls += 1;
          program.forcedDeload = true;
          notes.push({
            kind: 'stall',
            title: 'Stall recorded',
            slotKey: entry.slotKey,
            text: `You came up short on ${byId(entry.exerciseId)?.short || entry.slotKey}. Finish this cycle, dropping load as needed so every set and rep gets completed — then take the week-4 deload regardless of how the checklist scores.`,
          });
        }
      }
    }
  }

  const hot = deloadRanHot(session, tpl);
  if (hot) notes.push(hot);

  advanceCursor(state);
  return { state, notes };
}

/** How far above the deload's target RPE still counts as "went to plan". */
const DELOAD_HARD_MARGIN = 1.5;

/**
 * A deload that still felt like work is worth saying out loud.
 *
 * The checklist that sent the lifter here is five self-reported questions asked
 * once, before the week started. What the week actually felt like is a second,
 * better-informed reading of the same thing: two light sets of the wave's
 * lowest reps should land around RPE 6, and if they came in at 8 the fatigue
 * was deeper than the checklist knew. That is a recovery signal, not a strength
 * one, and the app has it for free the moment the week is logged.
 */
function deloadRanHot(session, tpl) {
  if (session.phase !== 'deload') return null;

  const hot = [];
  for (const entry of session.entries) {
    const slot = findSlot(tpl, entry.slotKey);
    // Technique work is prescribed at RPE 5 and left there, so it is not part
    // of the comparison the deload's own target sets up.
    if (!slot || slot.technique || entry.targetRPE == null) continue;
    const logged = (entry.sets || []).filter((x) => x.done && x.rpe != null).map((x) => x.rpe);
    if (!logged.length) continue;
    const avg = logged.reduce((a, b) => a + b, 0) / logged.length;
    if (avg - entry.targetRPE >= DELOAD_HARD_MARGIN) {
      hot.push({ name: byId(entry.exerciseId)?.short || entry.slotKey, avg, target: entry.targetRPE });
    }
  }
  if (!hot.length) return null;

  const worst = hot.reduce((a, b) => (b.avg - b.target > a.avg - a.target ? b : a), hot[0]);
  const named = hot.map((h) => h.name).join(', ');
  return {
    kind: 'deloadHard',
    title: 'Your deload ran hot',
    text: `${named} came in around RPE ${worst.avg.toFixed(1)} where ${worst.target} was the target — this week was meant to feel easy. A deload that still feels like work is a reading on your recovery, not on your strength. If next cycle's first week lands the same way, take another easy week rather than training through it.`,
  };
}

function findSlot(tpl, key) {
  for (const d of tpl.days) {
    const s = d.slots.find((x) => x.key === key);
    if (s) return s;
  }
  return null;
}

/** Move to the next scheduled day, raising the deload question at a cycle end. */
export function advanceCursor(state) {
  const program = state.program;
  const tpl = templateOf(program);
  const cur = program.cursor;
  const days = tpl.days.map((d) => d.n).sort((a, b) => a - b);
  const idx = days.indexOf(cur.day);

  if (idx < days.length - 1) {
    cur.day = days[idx + 1];
    return;
  }

  // end of a training week
  cur.day = days[0];

  // Both of the checklist's non-proceed answers are a single week that stands in
  // for the normal cycle break, so both roll into the next cycle when they are
  // done. Without this the cursor stayed pinned to the pain week and re-asked
  // the checklist every time it came round, with no way out but answering
  // differently.
  if (cur.phase === 'deload' || cur.phase === 'painWeek') {
    startNextCycle(state);
    return;
  }

  const weeks = loadingWeeks(program);
  if (cur.week < weeks) {
    cur.week += 1;
    return;
  }

  // Loading weeks are done — the checklist decides what happens next.
  program.pendingAssessment = true;
}

/** Answer the deload checklist and route accordingly. */
export function resolveAssessment(state, answers) {
  const program = state.program;
  const verdict = assessDeload(answers);
  const forced = program.forcedDeload;
  const mandatory = program.cyclesSinceDeload >= 2;   // 3rd cycle with no deload

  let action = verdict.verdict;
  const reasons = [verdict.why];

  if (forced) {
    action = 'deload';
    reasons.push('A stall this cycle forces the deload regardless of the checklist.');
  } else if (mandatory && action === 'proceed') {
    action = 'deload';
    reasons.push('Three cycles without a deload — take one anyway.');
  }

  program.pendingAssessment = false;
  program.events.push({
    date: todayISO(), kind: 'assessment', verdict: action, flags: verdict.flags, answers,
  });

  if (action === 'deload') {
    program.cursor.phase = 'deload';
    program.cursor.week = loadingWeeks(program) + 1;
  } else if (action === 'painWeek') {
    program.cursor.phase = 'painWeek';
    program.cursor.week = loadingWeeks(program) + 1;
  } else {
    startNextCycle(state);
  }
  return { action, reasons, verdict };
}

/** Roll the wave anchors forward and begin the next cycle. */
export function startNextCycle(state) {
  const program = state.program;
  const tpl = templateOf(program);
  const units = state.profile.units;
  const wasDeload = program.cursor.phase === 'deload';

  for (const day of tpl.days) {
    for (const slot of day.slots) {
      const st = program.slots[slot.key];
      if (!st) continue;

      if (st.stalledThisCycle) {
        // Step 3-4 of the stall protocol: restart 5-10% lighter than the load
        // you stalled with, and halve the weekly increment from here on.
        //
        // Rounded onto the plate grid and floored at the empty bar. A 7.5% cut
        // is far bigger than any plate step, so snapping it costs nothing, and
        // it is a load the lifter will be asked to walk out and lift. Without
        // the floor a light accessory that stalls near the bar reduces to an
        // anchor below the bar itself, and every later stall shrinks it again.
        const base = st.stalledAtLoad || st.week1Load;
        if (base) {
          const cut = roundToLoadable(base * 0.925, state.profile);
          st.week1Load = Math.max(cut ?? state.profile.barWeight, state.profile.barWeight);
        }
        st.smallIncrement = true;
        st.stalledThisCycle = false;
        st.stalledAtLoad = null;
        program.events.push({
          date: todayISO(), kind: 'stallReset', slotKey: slot.key,
          text: `Restarting ${slot.key} about 7.5% lighter with smaller weekly jumps.`,
        });
      } else if (st.week1Load) {
        // Deliberately NOT snapped to the plate grid, unlike the stall reset
        // above. After a stall the weekly increment is halved (2.5 kg, 5 lb),
        // which in a gym without the small plates is less than one step on the
        // bar. Rounding here would throw that increment away every cycle and
        // freeze the lifter's progression; carrying the exact figure lets it
        // accumulate until it crosses a step the bar can actually express.
        // Rounding happens once, at prescription time, in `resolveDay`.
        st.week1Load = +(st.week1Load + incrementOf(slot, program, units)).toFixed(2);
      }
    }
  }

  program.cursor.cycle += 1;
  program.cursor.week = 1;
  program.cursor.phase = 'load';
  program.cursor.day = tpl.days[0].n;
  program.forcedDeload = false;
  program.cyclesSinceDeload = wasDeload ? 0 : program.cyclesSinceDeload + 1;
  program.events.push({ date: todayISO(), kind: 'cycleStart', cycle: program.cursor.cycle });
}

/* ---- graduation signal ------------------------------------------------ */

/**
 * The book's trigger for moving up: you stall again after already halving your
 * increments, on most of your strength-day main lifts (pp. 244-245).
 */
export function graduationCheck(state) {
  const program = state.program;
  const tpl = templateOf(program);
  if (tpl.trainingAge !== 'intermediate') return { ready: false };

  const strengthMains = [];
  for (const day of tpl.days) {
    if (day.role !== 'strength') continue;
    for (const slot of day.slots) {
      if (slot.role === 'main' || slot.role === 'variation') strengthMains.push(slot);
    }
  }
  const stuck = strengthMains.filter((s) => {
    const st = program.slots[s.key];
    return st && st.smallIncrement && st.stalls >= 2;
  });

  const ready = stuck.length >= Math.ceil(strengthMains.length / 2);
  return {
    ready,
    stuck: stuck.map((s) => s.key),
    total: strengthMains.length,
    text: ready
      ? 'You have stalled again on most of your strength-day lifts even after cutting your increments. By the book\'s own criterion this is the point to move to an advanced, block-periodised approach.'
      : null,
  };
}

/* ---- helpers for the UI ---------------------------------------------- */

/** A compact plan of the whole current cycle, for the schedule view. */
export function cyclePlan(state) {
  const program = state.program;
  const tpl = templateOf(program);
  const weeks = loadingWeeks(program);
  const out = [];
  for (let w = 1; w <= weeks; w++) {
    out.push({
      week: w,
      phase: 'load',
      days: tpl.days.map((d) => ({
        day: d.n,
        label: d.label,
        role: d.role,
        slots: d.slots.map((slot) => ({
          key: slot.key,
          name: byId(program.choices[slot.key])?.short || slot.slotType,
          sets: slot.sets,
          reps: repsForWeek(slot, program, w),
          pct: pctForWeek(slot, program, w),
          rpe: slot.rpe ?? null,
          rpeRange: slot.rpeRange || null,
        })),
      })),
    });
  }
  return { weeks: out, template: tpl };
}

/** Weekly set counts per movement category, to check against the book's targets. */
export function volumeAudit(state) {
  const program = state.program;
  const tpl = templateOf(program);
  const cats = { 'UB Push': 0, 'UB Pull': 0, Lower: 0 };
  let main = 0, accessory = 0, total = 0;

  let excluded = 0;
  for (const day of tpl.days) {
    for (const slot of day.slots) {
      const sets = slot.sets || 0;
      const ex = byId(program.choices[slot.key]);
      const pattern = ex?.pattern || slot.slotType;

      // The book's own breakdown for the intermediate program leaves the leg
      // curl out of its headline figures, so the template marks it as such.
      if (slot.excludeFromTotals) { excluded += sets; continue; }

      total += sets;
      if (slot.role === 'main' || slot.role === 'variation') main += sets;
      else accessory += sets;

      const push = /horizontal_pus|vertical_push/.test(pattern) || /bench|Push|triceps/i.test(slot.slotType);
      const pull = /vertical_pull|horizontal_pul/.test(pattern) || /Pull/i.test(slot.slotType);
      const lower = /squat|hinge|single_leg/.test(pattern) || /squat|dead|hinge|legCurl/i.test(slot.slotType);

      if (push) cats['UB Push'] += sets;
      if (pull) cats['UB Pull'] += sets;
      if (lower) cats.Lower += sets;
      // The deadlift counts toward both lower body and upper-back pulling.
      if (slot.lift === 'deadlift' && !pull) cats['UB Pull'] += sets;
    }
  }
  return {
    cats, main, accessory, total, excluded,
    target: { sets: [13, 15], note: 'Intermediate: 13-15 sets per muscle group or movement pattern per week (p. 208).' },
  };
}

/* ---- units ------------------------------------------------------------ */

/**
 * Convert a lifter's equipment, maxes and slot anchors between kg and lb.
 *
 * Mutates `state` in place; a no-op if it is already in the target unit. Logged
 * sets are deliberately left alone — they are a record of what happened, and
 * rewriting history to a converted approximation would be worse than leaving it
 * in the unit it was recorded in.
 *
 * Anchors get rounded onto the target unit's plate grid rather than to the
 * nearest half. They are prescriptions the app puts in front of you as "load
 * this and go", and a plain half-unit round turned a 145 kg squat anchor into
 * 319.5 lb — a load no arrangement of a 45 lb bar and pairs of plates makes.
 */
export function convertUnits(state, to) {
  if (to !== 'kg' && to !== 'lb') return state;
  if (state.profile.units === to) return state;

  const f = to === 'kg' ? KG_PER_LB : 1 / KG_PER_LB;

  // Pin down what the existing history means before the profile changes under
  // it. Sessions written by this build already carry their unit; one restored
  // from an older backup does not, and this is the last moment at which the
  // answer is still knowable.
  for (const ses of state.sessions || []) {
    if (!ses.units) ses.units = state.profile.units;
  }

  // Equipment first: everything below is rounded against the plates the lifter
  // will actually be standing in front of afterwards.
  state.profile.units = to;
  state.profile.barWeight = PLATE_PRESETS[to].barWeight;
  state.profile.plates = [...PLATE_PRESETS[to].plates];

  for (const k of ['squat', 'bench', 'deadlift']) {
    const m = state.maxes[k];
    if (!m) continue;
    // A max is an estimate, not something you load, so half a unit is fine.
    if (m.value) m.value = Math.round(m.value * f * 2) / 2;
    // fromLoad was a real bar load, so it has to stay loadable.
    if (m.fromLoad) m.fromLoad = roundToLoadable(m.fromLoad * f, state.profile);
  }

  for (const key of Object.keys(state.program?.slots || {})) {
    const sl = state.program.slots[key];
    if (sl.week1Load) sl.week1Load = roundToLoadable(sl.week1Load * f, state.profile);
    if (sl.stalledAtLoad) sl.stalledAtLoad = roundToLoadable(sl.stalledAtLoad * f, state.profile);
  }
  return state;
}
