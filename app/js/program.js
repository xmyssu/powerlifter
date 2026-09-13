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

import { TEMPLATES, INTERMEDIATE_PL, INTERMEDIATE_PEAK, PEAK_DAYS, EMPHASIS,
         incrementFor, assessDeload, TEST_DAY, WARMUP } from './templates.js';
import { SLOT_DEFAULTS, byId } from './exercises.js';
import { e1RM, loadFor, roundToLoadable, pctOf1RM, normalizeRPE, convertLoad, loadBand, minIncrement, RPE_TOLERANCE, PLATE_PRESETS, KG_PER_LB } from './rpe.js';
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
  // Meet week is a taper: its loads were chosen to be light, exactly as a
  // deload's are, so an estimate drawn from one is a reading on the taper rather
  // than on the lifter. The opener day is week 3 and is not excluded by this.
  const hist = slotHistory(state, slotKey)
    .filter((h) => h.phase !== 'deload' && h.phase !== 'meetWeek')
    .slice(-lookback);
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

/* ---- max testing ------------------------------------------------------ */

/**
 * The best current estimate for a competition lift, across every slot that
 * trains it.
 *
 * A lift is trained in more than one place — the squat appears on the technique
 * day and the strength day — and the strength day is the one that knows what you
 * can actually do. Taking the best across slots picks that up without having to
 * name which slot matters.
 */
export function bestMaxFor(state, lift) {
  const tpl = templateOf(state.program);
  let best = 0;
  for (const d of tpl.days) {
    for (const slot of d.slots) {
      if (slot.lift !== lift) continue;
      const e = slotE1RM(state, slot.key);
      if (e && e > best) best = e;
    }
  }
  // A logged single beats any estimate drawn from a triple. Peak week 3's opener
  // practice counts for the same reason a test day does — it is a real single,
  // taken to a real RPE, seven days out. The primer is not in this list: RPE 4
  // by prescription, it says nothing about what the lifter can do.
  const singleKeys = [
    ...TEST_DAY.slots.filter((x) => x.lift === lift).map((x) => x.key),
    ...Object.values(PEAK_DAYS)
      .filter((d) => d.countsForMax)
      .flatMap((d) => d.slots.filter((x) => x.lift === lift).map((x) => x.key)),
  ];
  for (const key of singleKeys) {
    const e = slotE1RM(state, key);
    if (e && e > best) best = e;
  }
  return best || state.maxes?.[lift]?.value || null;
}

/**
 * Opener, second and third for one lift, plus the ramp to get there.
 *
 * Openers and seconds come off the RPE table rather than off flat percentages:
 * a weight you could triple *is* your opener, and the table already knows what
 * that is relative to a max. The third is the next thing you have not done —
 * one increment past the estimate, because a PR attempt that is not a PR is a
 * wasted attempt.
 *
 * Every number is rounded onto the lifter's own plate grid. These are loads
 * someone walks up to a bar and lifts; a figure they cannot load is not an
 * attempt, it is a suggestion.
 */
export function attemptsFor(state, lift, { max = null } = {}) {
  const est = max ?? bestMaxFor(state, lift);
  if (!est) return null;
  const opts = {
    barWeight: state.profile.barWeight,
    plates: state.profile.plates,
    microplates: state.profile.microplates,
  };
  const inc = state.profile.units === 'kg' ? 2.5 : 5;
  const opener = roundToLoadable(loadFor(est, 3, 10), opts);
  const second = roundToLoadable(loadFor(est, 2, 10), opts);
  let third = roundToLoadable(est + inc, opts);
  // Rounding can collapse the jumps on a coarse plate set; keep them ordered
  // and distinct, or the lifter is handed the same weight three times.
  const step = minIncrement(state.profile.plates, { microplates: state.profile.microplates });
  const second2 = Math.max(second, opener + step);
  third = Math.max(third, second2 + step);

  // Ramp to the opener, not to the third: the warm-up is there to prepare the
  // first attempt, and the attempts themselves are the rest of the ramp.
  const ramp = WARMUP.lowRep.sets
    .filter((w) => w.pct != null)
    .map((w) => ({ reps: w.reps, load: roundToLoadable((opener * w.pct) / 100, opts), pct: w.pct }))
    .filter((w, i, xs) => i === 0 || w.load > xs[i - 1].load);

  return { lift, max: est, opener, second: second2, third, ramp };
}

/**
 * Which exercise the lifter actually competes in for a lift.
 *
 * A lift is trained in several slots and they can hold different exercises — a
 * front squat on the volume day, a low-bar on the strength day. The strength
 * day's main is the one that is the competition lift, so it wins; anything else
 * is a fallback for a program that does not have one.
 */
function competitionChoice(state, lift) {
  const tpl = templateOf(state.program);
  const choices = state.program?.choices || {};
  let fallback = null;
  for (const day of tpl.days) {
    for (const slot of day.slots) {
      if (slot.lift !== lift || slot.technique) continue;
      if (day.role === 'strength' && slot.role === 'main' && choices[slot.key]) return choices[slot.key];
      if (!fallback && choices[slot.key]) fallback = choices[slot.key];
    }
  }
  return fallback;
}

/**
 * A test day: three attempts on each lift, resolved like any other day so the
 * session screen, the logger and the history need to know nothing new.
 *
 * It sits outside the program. `completeSession` neither advances the cursor nor
 * touches a wave anchor for one of these, so taking a heavy single on a whim
 * costs you nothing except the fatigue of having taken it.
 */
export function resolveTestDay(state, { lifts = null } = {}) {
  const wanted = lifts && lifts.length ? lifts : TEST_DAY.slots.map((s) => s.lift);
  const opts = {
    barWeight: state.profile.barWeight,
    plates: state.profile.plates,
    microplates: state.profile.microplates,
  };

  const slots = TEST_DAY.slots
    .filter((slot) => wanted.includes(slot.lift))
    .map((slot, i) => {
      const a = attemptsFor(state, slot.lift);
      const exId = competitionChoice(state, slot.lift) || SLOT_DEFAULTS[slot.slotType] || null;
      return {
        index: i,
        slot,
        slotKey: slot.key,
        exerciseId: exId,
        exercise: byId(exId),
        role: 'main',
        sets: 3,
        reps: 1,
        targetRPE: null,
        rpeRange: null,
        rpeMax: null,
        pct: null,
        timed: false,
        prescription: null,
        plannedLoad: a ? a.opener : null,
        // Opener, second, third — the logger fills each set with its own weight
        // rather than repeating the first.
        setLoads: a ? [a.opener, a.second, a.third] : null,
        attempts: a,
        loadRange: null,
        loadSource: a ? 'test' : 'discover',
        loadNote: a
          ? `Opener ${a.opener}, second ${a.second}, third ${a.third}. Take the third only if the second moved well — and change it on the spot if it did not.`
          : 'No estimate yet for this lift. Work up by feel and stop at the first grinder.',
        rpeCheckLoad: null,
        increment: null,
        lastTime: null,
      };
    });

  return {
    template: templateOf(state.program),
    dayDef: TEST_DAY,
    cycle: state.program?.cursor?.cycle ?? 1,
    week: state.program?.cursor?.week ?? 1,
    day: TEST_DAY.n,
    phase: 'test',
    isDeload: false,
    isPainWeek: false,
    isTest: true,
    label: 'Test day',
    scheduleNote: null,
    why: TEST_DAY.why,
    title: TEST_DAY.title,
    slots,
  };
}

/* ---- the peaking cycle ------------------------------------------------ */

/**
 * Four weeks, ending on the platform.
 *
 * The book prints this as a separate program (pp. 245-246), but it is not one —
 * it is the same template with three changes layered over it, and treating it as
 * a template switch would throw away every wave anchor and every stall the
 * lifter has accumulated, at the exact moment those numbers matter most. So the
 * peak is a *mode*: `program.peak` is set, the base template is untouched, and
 * the rules below are applied on top of it.
 *
 *   W1  strength-day mains at 1-3 reps instead of 3-5. The wave does the rest.
 *   W2  the same, one rep lower and one increment heavier.
 *   W3  everything that is not a competition lift deloads; Day 4 is replaced by
 *       squat, bench and deadlift in meet order, one opener single each.
 *   W4  the competition lifts deload too. Day 3 is the primer; Day 4 is the meet.
 */
export const PEAK_WEEKS = INTERMEDIATE_PEAK.cycleWeeks;

/**
 * How close the meet has to be before the peak takes over.
 *
 * Four training weeks, and the check runs at a week boundary, so a lifter who
 * finishes a week 26 days out starts peaking the following Monday and the meet
 * lands in week 4 — which is the whole point.
 *
 * The block compresses from the front when less than that is left (see
 * `enterPeak`), because the loading weeks are the part that can be given up and
 * the opener rehearsal and the taper are not. The floor is where even those two
 * stop fitting: under a fortnight there is no room for an opener week followed
 * by a taper, and what is left is not a peak but a week off before a max
 * attempt. The app says so rather than dressing it up as a block.
 */
const PEAK_TRIGGER_DAYS = 28;
export const PEAK_MIN_DAYS = 14;

/** Whole days from today to an ISO date; negative once it is past. */
export function daysUntil(iso, from = todayISO()) {
  if (!iso) return null;
  const a = new Date(`${from}T00:00:00`), b = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** Only the intermediate wave has a peaking cycle written for it. */
function peakable(program) {
  const tpl = TEMPLATES[program?.templateId];
  return !!tpl && tpl.trainingAge === 'intermediate' && tpl.model !== 'block';
}

/**
 * Should the cycle about to start be the peaking cycle?
 *
 * Asked at week boundaries only. `peakDoneFor` stops a meet that has been and
 * gone — or one the lifter has already peaked for and then kept training past —
 * from launching a second block off the same date.
 */
export function shouldEnterPeak(state, { today = todayISO() } = {}) {
  const program = state?.program;
  if (!program || program.peak) return false;
  if (!program.meetDate || program.peakDoneFor === program.meetDate) return false;
  if (!peakable(program)) return false;
  const d = daysUntil(program.meetDate, today);
  return d != null && d <= PEAK_TRIGGER_DAYS && d >= PEAK_MIN_DAYS;
}

/**
 * Why the peak has not started, in words, when the lifter asks.
 *
 * Returns null when it either has started or has nothing to say.
 */
export function peakStatus(state, { today = todayISO() } = {}) {
  const program = state?.program;
  if (!program?.meetDate) return null;
  const out = daysUntil(program.meetDate, today);
  if (program.peak) {
    const week = peakWeek(program);
    return { kind: 'running', week, out, weeks: PEAK_WEEKS };
  }
  if (out == null) return null;
  if (out < 0) return { kind: 'past', out };
  if (program.peakDoneFor === program.meetDate) return { kind: 'done', out };
  if (!peakable(program)) return { kind: 'unsupported', out };
  if (out < PEAK_MIN_DAYS) return { kind: 'tooLate', out };
  if (out > PEAK_TRIGGER_DAYS) return { kind: 'waiting', out, startsIn: out - PEAK_TRIGGER_DAYS };
  return { kind: 'nextWeek', out };
}

/**
 * Where the peak's three special days land in a given template.
 *
 * The book writes the peak against the four-day program and names the days by
 * number — openers and the meet on Day 4, the primer on Day 3. Taken literally
 * that is a rule about a template rather than about training, and on the
 * three-day week it names days that do not exist: the block would resolve every
 * meet-week day as a taper, never reach a competition day, and never end.
 *
 * What the numbers actually mean is "last day of the week" and "the day before
 * it", which is a statement about the taper and survives the translation.
 */
export function peakDayNumbers(tpl) {
  const days = tpl.days.map((d) => d.n).sort((a, b) => a - b);
  const last = days[days.length - 1];
  return {
    openersDay: last,
    competitionDay: last,
    primerDay: days.length > 1 ? days[days.length - 2] : last,
  };
}

/** Which of the four peak weeks the cursor is in, or null. */
export function peakWeek(program) {
  if (!program?.peak) return null;
  if (program.cursor.phase === 'meetWeek') return PEAK_WEEKS;
  return Math.min(PEAK_WEEKS - 1, Math.max(1, program.cursor.week));
}

/** The three lifts as they are contested, as opposed to trained around. */
const COMP_SLOT_TYPES = new Set(['squat', 'bench', 'deadlift']);
export const isCompetitionSlot = (slot) => !!slot?.lift && COMP_SLOT_TYPES.has(slot.slotType);

/**
 * What the peak does to a given day — the single place the four weeks are
 * turned into instructions, so the resolver, the schedule and the coach cannot
 * drift apart.
 *
 * Returns null when the peak is not running or the day is untouched by it
 * (weeks 1-2 need nothing here: the rep-range override in `repRangeFor` is the
 * whole change, and the wave carries it).
 */
export function peakPlanFor(program, { week, day, phase }) {
  if (!program?.peak) return null;
  const pd = peakDayNumbers(TEMPLATES[program.templateId] || INTERMEDIATE_PL);

  if (phase === 'meetWeek') {
    if (day === pd.competitionDay) return { kind: 'meet', week: PEAK_WEEKS };
    if (day === pd.primerDay) return { kind: 'primer', week: PEAK_WEEKS };
    return { kind: 'taper', week: PEAK_WEEKS };
  }
  if (week === INTERMEDIATE_PEAK.deloadWeek) {
    if (day === pd.openersDay) return { kind: 'openers', week };
    return { kind: 'week3', week };
  }
  return { kind: 'load', week };
}

/**
 * The opener day and the primer day, resolved the way a test day is.
 *
 * Both sit outside the wave, so they are built here rather than threaded through
 * `resolveDay`'s anchor machinery: there is no week-1 load to progress from and
 * nothing either day could stall. The loads come from the same `attemptsFor`
 * the meet plan and the test day use, so the opener rehearsed on Sunday is the
 * opener printed on the attempt card, to the kilo.
 */
function resolvePeakDay(state, kind, { week, day, phase }) {
  const program = state.program;
  const dayDef = kind === 'openers' ? PEAK_DAYS.openers : PEAK_DAYS.primer;
  const loadOpts = {
    barWeight: state.profile.barWeight,
    plates: state.profile.plates,
    microplates: state.profile.microplates,
  };

  const slots = dayDef.slots.map((slot, i) => {
    const a = attemptsFor(state, slot.lift);
    const exId = competitionChoice(state, slot.lift) || SLOT_DEFAULTS[slot.slotType] || null;
    // The primer is a fraction of the opener, not of a max: it is the same ramp
    // the lifter will walk on meet day, stopped early. Expressing it off the
    // opener keeps the two days on the same scale even when the estimate moves.
    const load = !a ? null
      : kind === 'openers' ? a.opener
      : roundToLoadable(a.opener * 0.85, loadOpts);

    return {
      index: i,
      slot,
      slotKey: slot.key,
      exerciseId: exId,
      exercise: byId(exId),
      role: 'main',
      sets: slot.sets,
      reps: 1,
      targetRPE: slot.rpe ?? null,
      rpeRange: slot.rpeRange ? [...slot.rpeRange] : null,
      rpeMax: slot.rpeMax ?? null,
      pct: null,
      timed: false,
      prescription: null,
      plannedLoad: load,
      loadRange: null,
      loadSource: a ? 'peak' : 'discover',
      loadNote: !a
        ? 'No estimate for this lift yet — work up by feel and stop well short.'
        : kind === 'openers'
          ? `Your opener: ${a.opener}. Ramp to it and take one. If it does not move like a warm-up, it is not your opener — lower it now, while lowering it is free.`
          : 'One easy single. If you are thinking about whether to add weight, you have finished.',
      rpeCheckLoad: null,
      increment: null,
      lastTime: lastComparable(state, slot.key, { reps: 1 }),
      attempts: kind === 'openers' ? a : null,
    };
  });

  return {
    template: templateOf(program),
    dayDef,
    cycle: program.cursor.cycle,
    week, day, phase,
    isDeload: false,
    isPainWeek: false,
    isTest: false,
    isPeak: true,
    peakKind: kind,
    peakWeek: kind === 'openers' ? week : PEAK_WEEKS,
    label: kind === 'openers' ? `Peak week ${week} · Openers` : 'Meet week · Primer',
    scheduleNote: dayDef.note || null,
    why: dayDef.why,
    title: dayDef.title,
    slots,
  };
}

/**
 * Meet day.
 *
 * Three attempts a lift, in meet order, off the same `attemptsFor` the plan has
 * been printing for four weeks — so this is a test day with a date on it, and it
 * is built as one deliberately. What it does not share with a test day is the
 * aftermath: logging it is what ends the peak.
 */
function resolveMeetDay(state, { week, day, phase }) {
  const base = resolveTestDay(state, { lifts: ['squat', 'bench', 'deadlift'] });
  return {
    ...base,
    // Its own day definition: inheriting the test day's would have every pill
    // and heading on the biggest day of the block read "Test".
    dayDef: { n: day, role: 'meet', label: 'Meet', meet: true, slots: [] },
    week, day, phase,
    isTest: false,
    isMeet: true,
    isPeak: true,
    peakKind: 'meet',
    peakWeek: PEAK_WEEKS,
    label: 'Meet day',
    title: 'The meet',
    why: 'Nine attempts, three that count. Open with something you could triple — the opener is insurance, not a statement. Take the second only if the opener moved, and the third only if the second did. Going three for three beats going one for three with a bigger number on the card.',
  };
}

/**
 * Turn the cycle that is starting into the peaking cycle.
 *
 * Called instead of `startNextCycle`, not after it — the anchor roll is the part
 * that has to change. A slot whose rep range drops from 3-5 to 1-3 is being
 * asked for a triple where it did a set of five at the same RPE, and the bar has
 * to go up for that to still be RPE 8. The conversion runs through the RPE table
 * off the lifter's own anchor, exactly as the high-rep week does in the other
 * direction, and it *replaces* the weekly increment rather than stacking on top
 * of it: the rep drop is this slot's progression for the week.
 */
export function enterPeak(state, { today = todayISO() } = {}) {
  const program = state.program;
  startNextCycle(state, { intoPeak: true });

  // How much of the block actually fits. A lifter who answers the deload
  // checklist honestly four weeks out spends a week on the deload and arrives
  // here with three, and running the block from its own week 1 regardless would
  // put meet week after the meet. Starting partway in gives up the loading
  // weeks — which is the right thing to give up, because the taper and the
  // opener rehearsal are the parts that cannot be shortened.
  const days = daysUntil(program.meetDate, today);
  // Meet week is the last week and the meet sits partway through it, on the
  // week's final training day. So the weeks that fit are meet week plus however
  // many whole weeks clear the days before it — counted from the meet's own
  // position in the week rather than from a round seven, which would put the
  // opener rehearsal on the morning of the meet.
  const tpl = templateOf(program);
  const meetDayOffset = tpl.days.findIndex((d) => d.n === peakDayNumbers(tpl).competitionDay) + 1;
  const weeksLeft = days == null
    ? PEAK_WEEKS
    : 1 + Math.floor(Math.max(0, days - meetDayOffset) / 7);
  const start = Math.min(INTERMEDIATE_PEAK.deloadWeek, Math.max(1, PEAK_WEEKS - weeksLeft + 1));
  if (start > 1) {
    program.cursor.week = start;
    program.peak.startedAtWeek = start;
  }

  program.events.push({
    date: todayISO(), kind: 'peakStart', meetDate: program.meetDate,
    week: start, weeks: PEAK_WEEKS,
  });
  return program.peak;
}

function peakAnchor(slot, program, slotState) {
  const override = INTERMEDIATE_PEAK.rules.repRangeOverrides[slot.key];
  if (!override || !slotState.week1Load) return null;
  const rpe = slot.rpe ?? (slot.rpeRange ? (slot.rpeRange[0] + slot.rpeRange[1]) / 2 : null);
  const fromReps = repsForWeek(slot, program, 1);
  const toReps = override[1];
  if (!rpe || !fromReps || !toReps || fromReps === toReps) return null;
  const a = pctOf1RM(fromReps, rpe);
  const b = pctOf1RM(toReps, rpe);
  if (!a || !b) return null;
  return +((slotState.week1Load * b) / a).toFixed(2);
}

/**
 * The peak is over the moment the meet is logged.
 *
 * `peakDoneFor` is stamped with the date rather than cleared, so a lifter who
 * keeps training afterwards without changing the meet date does not get a second
 * peaking cycle out of a meet they have already lifted.
 */
export function exitPeak(state, { competed = true } = {}) {
  const program = state.program;
  if (!program?.peak) return null;
  const meetDate = program.peak.meetDate || program.meetDate;
  program.peakDoneFor = meetDate;
  program.peak = null;
  program.events.push({ date: todayISO(), kind: 'peakEnd', meetDate, competed });
  // Meet week was a taper and the meet itself is three singles: the lifter is
  // beaten up but not accumulating fatigue, so the deload counter starts clean
  // rather than dragging the pre-meet cycles into the next block.
  program.cyclesSinceDeload = 0;
  startNextCycle(state);
  return { meetDate, competed };
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

  if (phase === 'test') return resolveTestDay(state, { lifts: state.program?.testLifts });

  // The peaking cycle replaces two of its sixteen days outright and deloads
  // part of a third. Everything it does not name falls through to the wave.
  const peak = peakPlanFor(program, { week, day, phase });
  if (peak?.kind === 'openers' || peak?.kind === 'primer') {
    return resolvePeakDay(state, peak.kind, { week, day, phase });
  }
  if (peak?.kind === 'meet') return resolveMeetDay(state, { week, day, phase });

  const units = state.profile.units;
  const dayDef = tpl.days.find((d) => d.n === day) || tpl.days[0];
  // Meet week is a deload the lifter does not get a vote on: the competition
  // lifts come down too, which is the one week of the year that is true.
  const isDeload = phase === 'deload' || peak?.kind === 'taper';
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

    // Peak week 3 deloads everything that is not contested — the variants
    // included — while the competition lifts keep climbing to their opener.
    // That is a per-slot decision, so it cannot ride on the day-level flag.
    const slotDeload = isDeload || (peak?.kind === 'week3' && !isCompetitionSlot(slot));

    if (slotDeload) {
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

    if (isPainWeek && !slotDeload && !slot.technique && !slot.timed && !slot.fixedReps && reps != null) {
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
    const plan = plannedLoad({ state, program, slot, week: waveWeek, isDeload: slotDeload, repsRaised, inc, pct, reps, targetRPE, rpeRange });
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
    isTest: false,
    isPeak: !!peak,
    peakKind: peak?.kind || null,
    peakWeek: peak?.week || null,
    label: dayLabel(tpl, dayDef, { week, cycle, phase, peak }),
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

function dayLabel(tpl, dayDef, { week, cycle, phase, peak }) {
  if (dayDef.off) return 'Rest day';
  if (dayDef.meet) return 'Meet day';
  if (peak?.kind === 'taper') return `Meet week · Day ${dayDef.n} · Taper`;
  if (peak) return `Peak week ${peak.week} · Day ${dayDef.n} · ${dayDef.label}`;
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
      sets: Array.from({ length: s.sets }, (_, i) => ({ load: s.setLoads?.[i] ?? s.plannedLoad, reps: null, rpe: null, done: false, ts: null })),
    })),
    sessionRPE: null,
    notes: '',
    readiness: null,
  };
}

/**
 * Throw away a session that was started and not wanted.
 *
 * Starting a session is how you find out what is in one, so it has to be
 * undoable — otherwise the only way out of a session opened out of curiosity is
 * to finish it, which writes a training day that never happened into the log and
 * moves the cycle on.
 *
 * Only an unfinished session can go. A completed one is history, and history
 * that can be deleted by a stray tap is not history; the caller gets a null back
 * rather than an exception so a double-tap on the button is harmless.
 *
 * Nothing else needs unwinding: `startSession` is pure — the cursor only moves in
 * `completeSession` — so discarding leaves the program exactly where it was.
 */
export function discardSession(state, sessionId) {
  const i = (state.sessions || []).findIndex((x) => x.id === sessionId);
  if (i < 0) return { discarded: null };
  const ses = state.sessions[i];
  if (ses.status === 'done') return { discarded: null };

  const logged = (ses.entries || []).reduce((n, e) => n + (e.sets || []).filter((x) => x.done).length, 0);
  state.sessions.splice(i, 1);
  if (state.activeSessionId === sessionId) state.activeSessionId = null;
  if (ses.phase === 'test' && state.program) delete state.program.testLifts;
  return { discarded: { id: ses.id, phase: ses.phase, date: ses.date, logged } };
}

/**
 * Fold a test day's singles into the lifter's recorded maxes.
 *
 * Only a completed single counts. A missed third attempt is information about
 * the day, not about the lifter, and writing it in as a max would hand the next
 * cycle a number the lifter has never actually lifted.
 */
function recordTestedMaxes(state, session) {
  const notes = [];
  for (const entry of session.entries) {
    const def = TEST_DAY.slots.find((x) => x.key === entry.slotKey);
    if (!def) continue;

    const singles = (entry.sets || []).filter((x) => x.done && x.load > 0 && x.reps >= 1);
    if (!singles.length) continue;

    // The heaviest completed set, expressed as a one-rep max. A clean double at
    // the end is worth more than a missed single, and the table knows it.
    const best = singles.reduce((a, b) => {
      const av = e1RM(a.load, a.reps, a.rpe ?? 10) || 0;
      const bv = e1RM(b.load, b.reps, b.rpe ?? 10) || 0;
      return bv > av ? b : a;
    }, singles[0]);
    const value = +(e1RM(best.load, best.reps, best.rpe ?? 10) || best.load).toFixed(1);
    const prev = state.maxes?.[def.lift]?.value || 0;

    state.maxes[def.lift] = {
      value,
      date: session.date,
      source: 'tested',
      reps: best.reps,
      fromLoad: best.load,
      fromRPE: best.rpe ?? 10,
    };
    notes.push({
      kind: 'tested',
      title: value > prev ? `New ${def.lift} max` : `${def.lift.charAt(0).toUpperCase() + def.lift.slice(1)} tested`,
      slotKey: entry.slotKey,
      text: value > prev && prev > 0
        ? `${best.load} × ${best.reps} recorded. Your ${def.lift} max is now ${value}, up ${+(value - prev).toFixed(1)} from ${prev}. Every load the program gives you from here is built on this number.`
        : `${best.load} × ${best.reps} recorded as your ${def.lift} max (${value}).`,
    });
  }
  return notes;
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

  // A test day sits outside the program: it is not part of a wave, so it has no
  // anchor to set and nothing it can stall. What it does have is the best data
  // the app will ever get about this lifter, so it writes the maxes.
  if (session.phase === 'test') {
    notes.push(...recordTestedMaxes(state, session));
    return { state, notes };
  }

  // Meet day is a test day that also closes the block. Recording the maxes and
  // ending the peak have to happen together: a lifter who logs the platform and
  // then opens the app the next morning must not be shown the meet again.
  if (session.phase === 'meetWeek' && session.day === peakDayNumbers(tpl).competitionDay) {
    notes.push(...recordTestedMaxes(state, session));
    const ended = exitPeak(state, { competed: true });
    if (ended) {
      notes.push({
        kind: 'meetDone',
        title: 'That is the meet',
        text: 'Your peaking block is closed and a fresh cycle is waiting. Do not start it tomorrow — take the rest of the week off, eat, sleep, and let the next block begin when you actually want to train again. The attempts you just logged are now the maxes every load in it is built from.',
      });
    }
    return { state, notes };
  }

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

  // The peaking cycle is four fixed weeks with a date at the end of it. There is
  // no checklist to run and no decision to make: the deload is week 3 whether or
  // not the lifter feels they need one, because the meet is on Saturday.
  if (program.peak) {
    if (cur.phase === 'meetWeek') { exitPeak(state); return; }

    // The block is counted in training weeks; the meet is on a date. A lifter
    // who trains three times in a week rather than four falls behind the
    // calendar, and carrying on by week number would have the app prescribing
    // heavy doubles two days before they compete. The date wins.
    const out = daysUntil(program.meetDate);
    if (out != null && out <= 7) { cur.phase = 'meetWeek'; cur.week = PEAK_WEEKS; return; }
    if (out != null && out <= 14 && cur.week < INTERMEDIATE_PEAK.deloadWeek) {
      cur.week = INTERMEDIATE_PEAK.deloadWeek;   // straight to the opener week
      return;
    }

    if (cur.week < INTERMEDIATE_PEAK.deloadWeek) { cur.week += 1; return; }
    cur.phase = 'meetWeek';
    cur.week = PEAK_WEEKS;
    return;
  }

  // Both of the checklist's non-proceed answers are a single week that stands in
  // for the normal cycle break, so both roll into the next cycle when they are
  // done. Without this the cursor stayed pinned to the pain week and re-asked
  // the checklist every time it came round, with no way out but answering
  // differently.
  if (cur.phase === 'deload' || cur.phase === 'painWeek') {
    if (shouldEnterPeak(state)) enterPeak(state); else startNextCycle(state);
    return;
  }

  // A meet inside the next four weeks outranks the rest of the cycle. The peak
  // is its own mesocycle and starts at its own week 1, so this cuts the current
  // cycle short rather than peaking from wherever the wave happened to be.
  if (shouldEnterPeak(state)) { enterPeak(state); return; }

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
  } else if (shouldEnterPeak(state)) {
    enterPeak(state);
  } else {
    startNextCycle(state);
  }
  return { action, reasons, verdict };
}

/** Roll the wave anchors forward and begin the next cycle. */
export function startNextCycle(state, { intoPeak = false } = {}) {
  const program = state.program;
  const tpl = templateOf(program);
  const units = state.profile.units;
  // Meet week counts as a deload for this purpose, because that is what it is:
  // two-thirds of the sets at the wave's lightest load, then a primer at RPE 4.
  // Without this a lifter came out of a meet one cycle closer to a mandatory
  // deload than they went in, having just taken the easiest week of the year.
  const wasDeload = program.cursor.phase === 'deload' || program.cursor.phase === 'meetWeek';

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
      } else if (st.week1Load && intoPeak && peakAnchor(slot, program, st) != null) {
        // Peaking: this slot's rep range is dropping, and the rep drop is its
        // progression for the week. See `peakAnchor`. Safe to read the old rep
        // range here — `program.peak` is not set until the loop has finished.
        st.week1Load = peakAnchor(slot, program, st);
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

  if (intoPeak) {
    program.peak = {
      meetDate: program.meetDate,
      startedAt: todayISO(),
      cycle: program.cursor.cycle,
      repRangeOverrides: { ...INTERMEDIATE_PEAK.rules.repRangeOverrides },
    };
  }
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
  const peaking = !!program.peak;

  const planSlot = (slot, w) => ({
    key: slot.key,
    name: byId(program.choices[slot.key] || SLOT_DEFAULTS[slot.slotType])?.short || slot.slotType,
    sets: slot.sets,
    reps: repsForWeek(slot, program, w),
    pct: pctForWeek(slot, program, w),
    rpe: slot.rpe ?? null,
    rpeRange: slot.rpeRange || null,
  });

  // A compressed block starts partway in, and the weeks it skipped are not part
  // of anyone's plan. Showing them would have the schedule promise two loading
  // weeks to a lifter who is going straight to opener practice.
  const from = peaking ? (program.peak.startedAtWeek || 1) : 1;

  const out = [];
  for (let w = from; w <= weeks; w++) {
    const plan = peaking ? peakPlanFor(program, { week: w, day: tpl.days[0].n, phase: 'load' }) : null;
    out.push({
      week: w,
      phase: 'load',
      // The schedule is the one screen whose whole job is to say what is coming,
      // so a peaking week that swaps a day out has to say so here or the sheet
      // is quietly wrong for a month.
      peakKind: plan?.kind || null,
      note: plan?.kind === 'week3'
        ? 'Everything that is not a competition lift deloads this week, and Day 4 is replaced by opener singles.'
        : null,
      days: tpl.days.map((d) => {
        if (peaking && peakPlanFor(program, { week: w, day: d.n, phase: 'load' })?.kind === 'openers') {
          return { day: d.n, label: PEAK_DAYS.openers.label, role: 'strength', peakKind: 'openers',
                   slots: PEAK_DAYS.openers.slots.map((slot) => planSlot(slot, w)) };
        }
        return { day: d.n, label: d.label, role: d.role, peakKind: null, slots: d.slots.map((slot) => planSlot(slot, w)) };
      }),
    });
  }

  if (peaking) {
    const pd = peakDayNumbers(tpl);
    out.push({
      week: PEAK_WEEKS,
      phase: 'meetWeek',
      peakKind: 'taper',
      note: 'The competition lifts come down too. Everything before the primer is there to keep you moving, not to train you.',
      days: tpl.days.map((d) => {
        if (d.n === pd.competitionDay) {
          return { day: d.n, label: 'Meet day', role: 'meet', peakKind: 'meet', slots: [] };
        }
        if (d.n === pd.primerDay) {
          return { day: d.n, label: PEAK_DAYS.primer.label, role: 'primer', peakKind: 'primer',
                   slots: PEAK_DAYS.primer.slots.map((slot) => planSlot(slot, weeks)) };
        }
        return { day: d.n, label: `${d.label} · taper`, role: d.role, peakKind: 'taper',
                 slots: d.slots.map((slot) => planSlot(slot, weeks)) };
      }),
    });
  }

  return { weeks: out, template: tpl, peaking };
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
