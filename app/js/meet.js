/* ==========================================================================
   meet.js — what is happening on the platform, while it is happening.
   --------------------------------------------------------------------------
   Meet day was a test day with a nicer label: nine loads, logged one at a
   time, and no idea between them what any of it added up to. But a meet is not
   nine independent attempts — it is one number, and every decision after the
   opener is made against that number under a two-minute clock with someone
   else's hands on the bar.

   So this reads the session back as a meet: what is on the board, what the day
   can still reach at the weights currently loaded, whether a lift is one miss
   from costing the whole total, and what the next attempt ought to be given how
   the last one moved. All of it is derived from the log — nothing here is
   stored, so it stays right through a changed attempt, an undone tick, or an
   app reopened between flights.
   ========================================================================== */

import { TEST_DAY } from './templates.js';
import { convertLoad } from './rpe.js';

export const MEET_ORDER = ['squat', 'bench', 'deadlift'];
export const LIFT_NAMES = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' };
export const ATTEMPT_NAMES = ['Opener', 'Second', 'Third'];

/**
 * The meet so far, from the session log.
 *
 * `total` is the competition total: the heaviest *made* attempt on each lift.
 * A lift with three misses is a bombed lift and there is no total at all — not
 * a smaller one — which is the single most important thing this file knows and
 * the reason `lastChance` exists.
 */
export function meetProgress(state, session) {
  if (!session) return null;
  const to = state.profile.units;
  const from = session.units || to;
  const load = (v) => (v == null ? null : convertLoad(v, from, to));

  const lifts = [];
  for (const lift of MEET_ORDER) {
    const def = TEST_DAY.slots.find((s) => s.lift === lift);
    const entry = (session.entries || []).find((e) => e.slotKey === def?.key);
    if (!entry) continue;

    const attempts = (entry.sets || []).map((s, i) => ({
      n: i + 1,
      name: ATTEMPT_NAMES[i] || `Attempt ${i + 1}`,
      load: load(s.load),
      reps: s.reps ?? null,
      rpe: s.rpe ?? null,
      // A completed attempt with no rep in it is a miss however it was logged:
      // the `failed` flag is the deliberate way to record one, and zero reps is
      // what a half-logged one looks like.
      status: !s.done ? 'pending' : (s.failed || !(s.reps > 0)) ? 'missed' : 'good',
    }));

    const good = attempts.filter((a) => a.status === 'good');
    const pending = attempts.filter((a) => a.status === 'pending');
    const best = good.length ? Math.max(...good.map((a) => a.load || 0)) : 0;

    lifts.push({
      lift,
      name: LIFT_NAMES[lift],
      slotKey: entry.slotKey,
      exerciseId: entry.exerciseId,
      attempts,
      best,
      made: good.length,
      misses: attempts.filter((a) => a.status === 'missed').length,
      remaining: pending.length,
      done: pending.length === 0,
      bombed: pending.length === 0 && good.length === 0,
      // Nothing on the board and one attempt left. In every federation that
      // means no total, not a lower one, and the right response is almost
      // always to drop the weight rather than chase it.
      lastChance: good.length === 0 && pending.length === 1,
    });
  }

  const bombed = lifts.some((l) => l.bombed);
  const total = bombed ? 0 : lifts.reduce((n, l) => n + l.best, 0);

  // What the day still reaches if every attempt now loaded is made. Not a
  // prediction — a ceiling, and the thing a target has to be measured against.
  const ifAllMade = bombed ? 0 : lifts.reduce((n, l) => {
    const loads = l.attempts.filter((a) => a.status === 'pending' && a.load > 0).map((a) => a.load);
    return n + (loads.length ? Math.max(l.best, ...loads) : l.best);
  }, 0);

  let nextUp = null;
  for (const l of lifts) {
    const a = l.attempts.find((x) => x.status === 'pending');
    if (a) { nextUp = { lift: l.lift, name: l.name, slotKey: l.slotKey, attempt: a, liftState: l }; break; }
  }

  return {
    lifts,
    total,
    ifAllMade,
    bombed,
    nextUp,
    complete: lifts.length > 0 && lifts.every((l) => l.done),
    attemptsTaken: lifts.reduce((n, l) => n + l.made + l.misses, 0),
    attemptsLeft: lifts.reduce((n, l) => n + l.remaining, 0),
  };
}

/**
 * A goal total, against what the day can actually still do.
 *
 * `toGo` is what is missing from the board; `headroom` is what the attempts
 * currently loaded would add if they all went up. When headroom is short, the
 * difference is the honest answer to "can I still get there" — and it is a
 * number you can put on a bar rather than a feeling about the day.
 */
export function targetLine(progress, target) {
  if (!progress || !(target > 0)) return null;
  const secured = progress.total;
  const toGo = +(target - secured).toFixed(2);
  const headroom = +(progress.ifAllMade - secured).toFixed(2);
  return {
    target,
    secured,
    toGo,
    headroom,
    hit: toGo <= 0,
    reachable: toGo <= headroom + 1e-9,
    short: +(toGo - headroom).toFixed(2),
  };
}

/**
 * What to put on the bar next, given how the last one moved.
 *
 * The plan is already on the card — these are the adjustments a handler makes
 * standing next to you, and the app has the one thing a handler is guessing at:
 * the RPE you logged thirty seconds ago.
 *
 *  - A miss is repeated, not jumped past. Every federation allows the same
 *    weight again, and a weight you have already failed once today is not a
 *    weight to add to.
 *  - RPE 9.5 or 10 means the planned jump is gone. One increment, or nothing.
 *  - RPE 9 means half the planned jump.
 *  - RPE 7.5 or under on a second attempt means the third was chosen off a
 *    stale estimate and there is more there.
 *
 * `step` is the platform's smallest change, not the gym's.
 */
export function attemptAdvice(liftState, { step = 2.5 } = {}) {
  if (!liftState) return null;
  const idx = liftState.attempts.findIndex((a) => a.status === 'pending');
  if (idx < 0) return null;
  const next = liftState.attempts[idx];
  const prev = idx > 0 ? liftState.attempts[idx - 1] : null;
  const snap = (v) => Math.round(v / step) * step;
  const planned = next.load ?? null;

  if (!prev) {
    return { load: planned, changed: false, kind: 'opener',
      text: 'Your opener is insurance, not a statement. It should move like a warm-up.' };
  }

  if (prev.status === 'missed') {
    const load = prev.load;
    return { load, changed: planned !== load, kind: 'repeat',
      text: liftState.lastChance
        ? `You have one attempt left and nothing on the board. Take ${fmt(load)} again — or less. A lift you do not total on costs you the whole meet, not just this lift.`
        : `Take ${fmt(load)} again rather than adding to it. You have already found out about that weight today.` };
  }

  const rpe = prev.rpe;
  if (rpe == null || planned == null) {
    return { load: planned, changed: false, kind: 'planned', text: 'As planned.' };
  }

  const jump = planned - prev.load;
  if (rpe >= 9.5) {
    const load = snap(prev.load + step);
    return { load, changed: Math.abs(load - planned) > 1e-9, kind: 'grind',
      text: `That was RPE ${rpe} — there is no jump left in the day. ${fmt(load)} is one increment, and a made attempt beats a bigger miss.` };
  }
  if (rpe >= 9 && jump > step) {
    const load = snap(prev.load + Math.max(step, jump / 2));
    return { load, changed: Math.abs(load - planned) > 1e-9, kind: 'trim',
      text: `RPE ${rpe} on that one. Halve the jump: ${fmt(load)} rather than ${fmt(planned)}.` };
  }
  if (rpe <= 7.5 && idx === 2) {
    const load = snap(planned + step);
    return { load, changed: true, kind: 'room',
      text: `RPE ${rpe} on your second — the third was picked off an estimate that is now out of date. ${fmt(load)} is there.` };
  }
  return { load: planned, changed: false, kind: 'planned',
    text: `RPE ${rpe} on that one. Take the third as planned.` };
}

const fmt = (v) => (v == null ? '—' : (Math.abs(v % 1) < 1e-9 ? String(v) : String(+v.toFixed(2))));
