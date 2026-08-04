/* ==========================================================================
   rpe.js — RPE / RIR, %1RM estimation, load rounding
   --------------------------------------------------------------------------
   RPE here is Helms' definition: RPE = 10 - RIR (reps in reserve). RPE 8 on a
   set of 4 means you stopped with 2 good reps left in the tank.

   The %1RM table has a structural property worth exploiting: dropping half a
   point of RPE costs the same percentage as adding half a rep. So the whole
   grid collapses to one sequence indexed by (reps - 1 + RIR), stepping in
   halves. That keeps it exact against the standard chart and lets us read
   values the printed chart doesn't cover (e.g. 15 reps @ RPE 7).
   ========================================================================== */

/** %1RM at half-rep resolution. Index i = 2 * (reps - 1 + RIR). */
const PCT = [
  100.0, 97.8, 95.5, 93.9, 92.2, 90.7, 89.2, 87.8, 86.3, 85.0,
  83.7, 82.4, 81.1, 79.9, 78.6, 77.4, 76.2, 75.1, 73.9, 72.3,
  70.7, 69.4, 68.0, 66.7, 65.3, 64.0, 62.6, 61.3, 59.9, 58.6,
  57.2, 56.0, 54.8, 53.7, 52.6, 51.5, 50.5, 49.5, 48.5, 47.6,
  46.7,
];

export const RPE_MIN = 5.5;
export const RPE_MAX = 10;

/** Clamp + snap an RPE to the nearest half point. */
export function normalizeRPE(rpe) {
  const r = Math.round(Number(rpe) * 2) / 2;
  return Math.min(RPE_MAX, Math.max(RPE_MIN, r));
}

export const rirFromRPE = (rpe) => 10 - rpe;
export const rpeFromRIR = (rir) => 10 - rir;

/**
 * Percentage of 1RM that a set of `reps` taken to `rpe` represents.
 * Returns a number 0-100, or null if out of table range.
 */
export function pctOf1RM(reps, rpe) {
  const r = Number(reps);
  const p = normalizeRPE(rpe);
  if (!Number.isFinite(r) || r < 1) return null;
  const idx = Math.round(2 * (r - 1 + rirFromRPE(p)));
  if (idx < 0) return PCT[0];
  if (idx >= PCT.length) {
    // Extrapolate gently past the table rather than failing outright.
    const last = PCT[PCT.length - 1];
    const slope = PCT[PCT.length - 1] - PCT[PCT.length - 2]; // negative
    return Math.max(20, last + slope * (idx - (PCT.length - 1)));
  }
  return PCT[idx];
}

/** Estimated 1RM from a logged set. */
export function e1RM(load, reps, rpe) {
  const pct = pctOf1RM(reps, rpe);
  if (!pct || !load) return null;
  return (Number(load) * 100) / pct;
}

/** Estimated max for `targetReps` from a logged set — an "eXRM". */
export function eXRM(load, reps, rpe, targetReps) {
  const max = e1RM(load, reps, rpe);
  if (!max) return null;
  return (max * pctOf1RM(targetReps, 10)) / 100;
}

/** Load to prescribe to hit `reps` at `rpe`, given an estimated 1RM. */
export function loadFor(max, reps, rpe) {
  const pct = pctOf1RM(reps, rpe);
  if (!pct || !max) return null;
  return (Number(max) * pct) / 100;
}

/** How many reps `load` should be good for at `rpe`, given a max. */
export function repsAt(max, load, rpe) {
  if (!max || !load) return null;
  const target = (load / max) * 100;
  for (let reps = 1; reps <= 20; reps++) {
    if (pctOf1RM(reps, rpe) <= target) return reps;
  }
  return 20;
}

/* ---- load rounding ---------------------------------------------------- */

/**
 * Smallest load step achievable on a barbell with the given plate pairs.
 * Plates are per-side pairs, so the increment is 2x the lightest plate.
 */
export function minIncrement(plates, { microplates = true } = {}) {
  const list = (plates || []).filter((p) => p > 0);
  if (!list.length) return 2.5;
  const lightest = Math.min(...list);
  return microplates ? lightest * 2 : Math.max(lightest * 2, 2.5);
}

/** Round a load to something you can actually load on the bar. */
export function roundToLoadable(load, { barWeight = 20, plates = [], microplates = true } = {}) {
  if (!Number.isFinite(load)) return null;
  const step = minIncrement(plates, { microplates });
  if (load <= barWeight) return barWeight;
  const above = load - barWeight;
  const rounded = Math.round(above / step) * step;
  return +(barWeight + rounded).toFixed(3);
}

/**
 * Plate breakdown per side for a target load.
 * Returns {ok, perSide:[{plate,count}], achieved, remainder, barWeight}
 */
export function plateBreakdown(load, { barWeight = 20, plates = [] } = {}) {
  const target = Number(load);
  if (!Number.isFinite(target)) return { ok: false, perSide: [], achieved: null, remainder: 0, barWeight };
  if (target < barWeight - 1e-6) {
    return { ok: false, perSide: [], achieved: barWeight, remainder: target - barWeight, barWeight, tooLight: true };
  }
  let perSideRemaining = (target - barWeight) / 2;
  const sorted = [...plates].filter((p) => p > 0).sort((a, b) => b - a);
  const perSide = [];
  for (const plate of sorted) {
    const count = Math.floor((perSideRemaining + 1e-6) / plate);
    if (count > 0) {
      perSide.push({ plate, count });
      perSideRemaining = +(perSideRemaining - count * plate).toFixed(4);
    }
  }
  const achieved = +(barWeight + 2 * (((target - barWeight) / 2) - perSideRemaining)).toFixed(3);
  return {
    ok: Math.abs(perSideRemaining) < 1e-6,
    perSide,
    achieved,
    remainder: +(target - achieved).toFixed(3),
    barWeight,
  };
}

/** "20 + 25/20/5" style short label for the plate hint. */
export function plateLabel(load, opts) {
  const b = plateBreakdown(load, opts);
  if (!b.perSide.length) return b.tooLight ? 'below bar weight' : 'empty bar';
  const parts = b.perSide.map(({ plate, count }) => (count > 1 ? `${plate}×${count}` : `${plate}`));
  return parts.join(' · ') + (b.ok ? '' : ` (+${b.remainder} short)`);
}

/* ---- formatting ------------------------------------------------------- */

export function fmtLoad(v, units = 'kg') {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const s = Math.abs(n % 1) < 1e-9 ? n.toFixed(0) : (Math.abs((n * 2) % 1) < 1e-9 ? n.toFixed(1) : n.toFixed(2));
  return `${s} ${units}`;
}

export function fmtLoadBare(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return Math.abs(n % 1) < 1e-9 ? n.toFixed(0) : (Math.abs((n * 2) % 1) < 1e-9 ? n.toFixed(1) : n.toFixed(2));
}

export function fmtRPE(v) {
  if (v == null) return '—';
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Parse a number the lifter typed, accepting either decimal separator.
 *
 * The inputs are type="text" with inputmode="decimal" rather than
 * type="number" on purpose: with a comma-decimal locale (Estonian, most of
 * Europe) a number input renders 82.5 as "82,5" and can reject a typed period
 * outright, handing back an empty string. Parsing it ourselves means both
 * "82.5" and "82,5" work everywhere.
 */
export function parseNum(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/\s+/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const KG_PER_LB = 0.45359237;
export const toKg = (lb) => lb * KG_PER_LB;
export const toLb = (kg) => kg / KG_PER_LB;

/**
 * Reinterpret a recorded load in a different unit.
 *
 * Sessions carry the unit their numbers were written in, because switching units
 * leaves logged sets exactly as they were recorded. Everything that puts old
 * loads on a chart, in a total, or next to a current number has to bring them
 * into the unit being displayed first, or a 150 kg squat reads as 150 lb.
 *
 * Deliberately unrounded: this is a measurement being re-expressed, not a load
 * being prescribed, so it must not be snapped to anyone's plate grid.
 */
export function convertLoad(load, from, to) {
  if (load == null || !Number.isFinite(Number(load))) return load;
  if (!from || !to || from === to) return Number(load);
  return to === 'kg' ? toKg(Number(load)) : toLb(Number(load));
}

/** Standard plate sets + bar by unit, for the settings screen. */
export const PLATE_PRESETS = {
  kg: { barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] },
  lb: { barWeight: 45, plates: [45, 35, 25, 10, 5, 2.5, 1.25] },
};
