/* ==========================================================================
   templates.js — program templates from Eric Helms, "The Muscle & Strength
   Pyramid: Training" (2nd ed).
   --------------------------------------------------------------------------
   Slot fields
     key            stable id, used to key progression state and history
     slotType       which exercise-picker fills it (see exercises.js)
     lift           'squat'|'bench'|'deadlift'|null — links to maxes for %1RM
     role           'main' | 'variation' | 'accessory' | 'isolation'
     sets           number of working sets
     repRange       [low, high]; the wave runs high -> low
     repStep        reps dropped per week (1, or 2 for the 8-12 hypertrophy range)
     pctBand        [lowPct, highPct] reference %1RM; low% pairs with the high-rep
                    week, high% with the low-rep week. null = RPE-driven only.
     rpe            1st-set RPE target (intermediate) — hold the load for
                    remaining sets
     rpeRange       [lo, hi] every-set RPE window (advanced) — adjust load
                    set to set to stay inside it
     inc            'lower' (+5 kg / +10 lb) or 'other' (+2.5 kg / +5 lb)
   ========================================================================== */

/** Weekly load increments by unit, per p. 243. */
export const INCREMENTS = {
  kg: { lower: 5, other: 2.5, small: 2.5, micro: 1.25 },
  lb: { lower: 10, other: 5, small: 5, micro: 2.5 },
};

export function incrementFor(slot, units = 'kg', { small = false } = {}) {
  const table = INCREMENTS[units] || INCREMENTS.kg;
  if (small) return table.small;
  return slot.inc === 'lower' ? table.lower : table.other;
}

/* ==========================================================================
   INTERMEDIATE POWERLIFTING — 4 days/week, 3-week wave + optional deload
   Book: overview pp. 227-228, table p. 263, progression pp. 241-244
   ========================================================================== */

export const INTERMEDIATE_PL = {
  id: 'intermediate-pl',
  name: 'Intermediate Powerlifting',
  source: 'Helms — Muscle & Strength Pyramid: Training 2e, p. 263',
  trainingAge: 'intermediate',
  daysPerWeek: 4,
  cycleWeeks: 3,
  model: 'wave',
  loadMode: 'firstSetRPE',
  allowDeloadWeek: true,
  scheduleNote: 'Put a rest day between Day 3 and Day 4 if you can — they are your two heavy competition-lift sessions.',
  days: [
    {
      n: 1,
      role: 'volume',
      label: 'Volume',
      title: 'Squat variation + bench, higher reps',
      why: 'Moderate loads, RPE 7 on the first set. You should never come close to failure here — form stays clean and you avoid muscle damage bleeding into the rest of the week.',
      slots: [
        { key: 'd1_sqvar',   slotType: 'squatVariant', lift: null,   role: 'variation', sets: 3, repRange: [7, 9], repStep: 1, pctBand: null,          rpe: 7, inc: 'lower' },
        { key: 'd1_bench',   slotType: 'bench',        lift: 'bench', role: 'main',      sets: 3, repRange: [7, 9], repStep: 1, pctBand: [67.5, 72.5], rpe: 7, inc: 'other' },
        { key: 'd1_verpull', slotType: 'verticalPull', lift: null,   role: 'accessory', sets: 3, repRange: [7, 9], repStep: 1, pctBand: null,          rpe: 8, inc: 'other' },
      ],
    },
    {
      n: 2,
      role: 'technique',
      label: 'Technique',
      title: 'Competition big 3, low reps, deliberately easy',
      why: 'RPE 5 — four to six reps shy of failure. This day builds skill on the competition lifts without adding fatigue. It is meant to stay submaximal forever, so do not treat a lack of progress here as a stall.',
      slots: [
        // technique: true marks work that is meant to stay submaximal forever, so
        // it never counts as a stall. On this template the day role says the same
        // thing; the flag is what carries that meaning into schedules where the
        // technique work is folded into other days.
        { key: 'd2_squat',   slotType: 'squat',        lift: 'squat',    role: 'main',      sets: 3, repRange: [1, 3], repStep: 1, pctBand: [80, 85], rpe: 5, inc: 'lower', technique: true },
        { key: 'd2_bench',   slotType: 'bench',        lift: 'bench',    role: 'main',      sets: 3, repRange: [1, 3], repStep: 1, pctBand: [80, 85], rpe: 5, inc: 'other', technique: true },
        { key: 'd2_dead',    slotType: 'deadlift',     lift: 'deadlift', role: 'main',      sets: 3, repRange: [1, 3], repStep: 1, pctBand: [80, 85], rpe: 5, inc: 'lower', technique: true },
        { key: 'd2_verpush', slotType: 'verticalPush', lift: null,       role: 'accessory', sets: 3, repRange: [4, 6], repStep: 1, pctBand: null,     rpe: 8, inc: 'other' },
      ],
    },
    {
      n: 3,
      role: 'strength',
      label: 'Strength',
      title: 'Squat + bench for strength',
      why: 'RPE 8 on the first set. This is where you push. Pick the load so all three sets are completable — if you blow past RPE 10 on set 3 you started too heavy.',
      slots: [
        { key: 'd3_squat',   slotType: 'squat',          lift: 'squat', role: 'main',      sets: 3, repRange: [3, 5],  repStep: 1, pctBand: [82.5, 87.5], rpe: 8, inc: 'lower' },
        { key: 'd3_bench',   slotType: 'bench',          lift: 'bench', role: 'main',      sets: 3, repRange: [3, 5],  repStep: 1, pctBand: [82.5, 87.5], rpe: 8, inc: 'other' },
        { key: 'd3_horpull', slotType: 'horizontalPull', lift: null,    role: 'accessory', sets: 3, repRange: [4, 6],  repStep: 1, pctBand: null,         rpe: 8, inc: 'other' },
        // Printed as a flat 12 in the book, but p. 242 says every lift in this
        // program waves. Implemented as the book's 8-12 two-rep wave (12/10/8).
        { key: 'd3_legcurl', slotType: 'legCurl',        lift: null,    role: 'isolation', sets: 3, repRange: [8, 12], repStep: 2, pctBand: null,         rpe: 8, inc: 'other', bookLiteralReps: 12, excludeFromTotals: true },
      ],
    },
    {
      n: 4,
      role: 'strength',
      label: 'Strength',
      title: 'Deadlift for strength + bench variation',
      why: 'RPE 8 again. If you bench with a wide grip, a close-grip variation is the default recommendation here — otherwise pick the variation that attacks your weak point.',
      slots: [
        { key: 'd4_bevar',   slotType: 'benchVariant',   lift: null,       role: 'variation', sets: 3, repRange: [6, 8],  repStep: 1, pctBand: null,         rpe: 8, inc: 'other' },
        { key: 'd4_dead',    slotType: 'deadlift',       lift: 'deadlift', role: 'main',      sets: 3, repRange: [3, 5],  repStep: 1, pctBand: [82.5, 87.5], rpe: 8, inc: 'lower' },
        { key: 'd4_horpull', slotType: 'horizontalPull2', lift: null,      role: 'accessory', sets: 3, repRange: [8, 12], repStep: 2, pctBand: null,         rpe: 8, inc: 'other' },
      ],
    },
  ],
};

/* ==========================================================================
   A three-day week.
   --------------------------------------------------------------------------
   NOT a printed template. The book gives the intermediate powerlifting program
   as four days (p. 263); this rearranges that same work for someone who can
   only train three times a week.

   What is preserved: every working set. All fourteen slots survive with their
   sets, rep waves, RPE targets, percentage bands and increments untouched, so
   weekly volume stays at 15/15/15 per pattern — the same as the four-day, and
   inside the book's 13-15 target (p. 208). Weekly frequency per lift is also
   unchanged: squat 3x, bench 4x, deadlift 2x.

   What it costs: the Technique day dissolves, so its skill work is spread over
   the remaining days and two of them run to five exercises. The book keeps
   technique work on its own day specifically so it happens fresh, which is the
   one thing a three-day week cannot reproduce. Each day therefore leads with
   its technique sets while the lifter is fresh, before the heavy work.

   The slot keys deliberately match the four-day template's, so switching in
   either direction carries exercise choices, load anchors and logged history
   across intact.
   ========================================================================== */
export const INTERMEDIATE_PL_3DAY = {
  id: 'intermediate-pl-3day',
  name: 'Intermediate Powerlifting (3-day)',
  source: 'Adapted from Helms — Muscle & Strength Pyramid: Training 2e, p. 263. Not a printed template.',
  adapted: true,
  trainingAge: 'intermediate',
  daysPerWeek: 3,
  cycleWeeks: 3,
  model: 'wave',
  loadMode: 'firstSetRPE',
  allowDeloadWeek: true,
  character: 'The same weekly volume as the four-day, compressed into three longer sessions. Technique work moves to the front of each day instead of having its own.',
  scheduleNote: 'Spread the three days out — Monday/Wednesday/Friday or similar. Days 2 and 3 are both heavy, so avoid stacking them back to back.',
  days: [
    {
      n: 1,
      role: 'volume',
      label: 'Volume',
      title: 'Deadlift technique, then higher-rep squat and bench',
      why: 'Deadlift triples at RPE 5 come first, while you are fresh — this is skill practice, not a test, and it is the deadlift exposure that the four-day puts on its own technique day. The rest is the volume work: moderate loads, RPE 7 on the first set, never close to failure.',
      slots: [
        { key: 'd2_dead',    slotType: 'deadlift',     lift: 'deadlift', role: 'main',      sets: 3, repRange: [1, 3], repStep: 1, pctBand: [80, 85],     rpe: 5, inc: 'lower', technique: true },
        { key: 'd1_sqvar',   slotType: 'squatVariant', lift: null,       role: 'variation', sets: 3, repRange: [7, 9], repStep: 1, pctBand: null,         rpe: 7, inc: 'lower' },
        { key: 'd1_bench',   slotType: 'bench',        lift: 'bench',    role: 'main',      sets: 3, repRange: [7, 9], repStep: 1, pctBand: [67.5, 72.5], rpe: 7, inc: 'other' },
        { key: 'd1_verpull', slotType: 'verticalPull', lift: null,       role: 'accessory', sets: 3, repRange: [7, 9], repStep: 1, pctBand: null,         rpe: 8, inc: 'other' },
      ],
    },
    {
      n: 2,
      role: 'strength',
      label: 'Strength',
      title: 'Squat + bench for strength',
      why: 'RPE 8 on the first set — this is where you push. Pick the load so all three sets are completable. The vertical push moves here from the four-day\'s technique day.',
      slots: [
        { key: 'd3_squat',   slotType: 'squat',          lift: 'squat', role: 'main',      sets: 3, repRange: [3, 5],  repStep: 1, pctBand: [82.5, 87.5], rpe: 8, inc: 'lower' },
        { key: 'd3_bench',   slotType: 'bench',          lift: 'bench', role: 'main',      sets: 3, repRange: [3, 5],  repStep: 1, pctBand: [82.5, 87.5], rpe: 8, inc: 'other' },
        { key: 'd3_horpull', slotType: 'horizontalPull', lift: null,    role: 'accessory', sets: 3, repRange: [4, 6],  repStep: 1, pctBand: null,         rpe: 8, inc: 'other' },
        { key: 'd2_verpush', slotType: 'verticalPush',   lift: null,    role: 'accessory', sets: 3, repRange: [4, 6],  repStep: 1, pctBand: null,         rpe: 8, inc: 'other' },
        { key: 'd3_legcurl', slotType: 'legCurl',        lift: null,    role: 'isolation', sets: 3, repRange: [8, 12], repStep: 2, pctBand: null,         rpe: 8, inc: 'other', bookLiteralReps: 12, excludeFromTotals: true },
      ],
    },
    {
      n: 3,
      role: 'strength',
      label: 'Strength',
      title: 'Squat + bench technique, then deadlift for strength',
      why: 'The competition squat and bench singles at RPE 5 open the session as skill work — four to six reps shy of failure, and never a stall no matter what the loads look like. Then the heavy deadlift and your bench variation.',
      slots: [
        { key: 'd2_squat',   slotType: 'squat',           lift: 'squat',    role: 'main',      sets: 3, repRange: [1, 3],  repStep: 1, pctBand: [80, 85],     rpe: 5, inc: 'lower', technique: true },
        { key: 'd2_bench',   slotType: 'bench',           lift: 'bench',    role: 'main',      sets: 3, repRange: [1, 3],  repStep: 1, pctBand: [80, 85],     rpe: 5, inc: 'other', technique: true },
        { key: 'd4_dead',    slotType: 'deadlift',        lift: 'deadlift', role: 'main',      sets: 3, repRange: [3, 5],  repStep: 1, pctBand: [82.5, 87.5], rpe: 8, inc: 'lower' },
        { key: 'd4_bevar',   slotType: 'benchVariant',    lift: null,       role: 'variation', sets: 3, repRange: [6, 8],  repStep: 1, pctBand: null,         rpe: 8, inc: 'other' },
        { key: 'd4_horpull', slotType: 'horizontalPull2', lift: null,       role: 'accessory', sets: 3, repRange: [8, 12], repStep: 2, pctBand: null,         rpe: 8, inc: 'other' },
      ],
    },
  ],
};

/** Emphasis re-tuning, p. 228. Applied to the 3-5 @ 82.5-87.5% strength slots. */
export const EMPHASIS = {
  balanced:  { label: 'Balanced',          repShift: 0,  pctShift: 0,    note: 'The program as written.' },
  volume:    { label: 'Volume-focused',    repShift: 1,  pctShift: -2.5, note: '3-5 reps @ 82.5-87.5% becomes 4-6 @ 80-85%.' },
  intensity: { label: 'Intensity-focused', repShift: -1, pctShift: 2.5,  note: '3-5 reps @ 82.5-87.5% becomes 2-4 @ 85-90%.' },
};

/* ==========================================================================
   INTERMEDIATE PEAKING — 4-week meet cycle, pp. 245-246
   W1/W2/W3 are the three weeks before the meet; W4 is meet week.
   ========================================================================== */

export const INTERMEDIATE_PEAK = {
  id: 'intermediate-pl-peak',
  name: 'Intermediate Peaking (4 weeks out)',
  extends: 'intermediate-pl',
  cycleWeeks: 4,
  rules: {
    // 1. Strength-day main lifts drop from 3-5 to 1-3 reps for the whole cycle.
    repRangeOverrides: {
      d3_squat: [1, 3],
      d3_bench: [1, 3],
      d4_dead:  [1, 3],
    },
    // 2. Week 3 (index 2): deload everything that is not a competition lift,
    //    including squat/bench/deadlift variants.
    week3DeloadNonComp: true,
    // 3. Week 3 reshuffle: Day 4 becomes squat, bench, deadlift in meet order,
    //    working up to a single at your opener on each.
    week3Reshuffle: {
      day: 4,
      slots: ['squat', 'bench', 'deadlift'],
      prescription: { sets: 1, reps: 1, rpeRange: [7.5, 8.5], note: 'Work up to your opener for one rep. Opener ≈ your current 3RM.' },
    },
    // 4. Meet week: Day 3 is the primer 24-48 h out; Day 4 is the meet.
    meetWeek: {
      primerDay: 3,
      primer: [
        { lift: 'squat',    sets: 2, reps: 1, rpe: 4 },
        { lift: 'bench',    sets: 2, reps: 1, rpe: 4 },
        { lift: 'deadlift', sets: 1, reps: 1, rpe: 4 },
      ],
      primerNote: 'Do this 24-48 hours before you lift. Work up to these singles and do nothing else.',
      competitionDay: 4,
    },
  },
  attemptSelection: {
    opener: { basis: '3RM', pctOf1RM: [87.5, 92.5], rpe: [7.5, 8.5] },
    second: { basis: '2RM' },
    third:  { basis: 'PR',  note: 'Next incremental PR if it is there — typically +2.5 kg. Otherwise a conservative jump.' },
  },
};

/* ==========================================================================
   ADVANCED POWERLIFTING — 6 days/week, two 3-week blocks
   Book: overview pp. 229-230, tables pp. 265-267, progression p. 246
   ========================================================================== */

const advSlot = (key, slotType, lift, role, sets, reps, pct, rpeRange, inc) =>
  ({ key, slotType, lift, role, sets, repRange: [reps - 2, reps], repStep: 1, baseReps: reps, pctBase: pct, rpeRange, inc });

export const ADVANCED_ACCUMULATION = {
  id: 'advanced-pl-accumulation',
  name: 'Advanced — Accumulation Block',
  source: 'Helms — Muscle & Strength Pyramid: Training 2e, pp. 265-266',
  trainingAge: 'advanced',
  daysPerWeek: 6,
  cycleWeeks: 3,
  model: 'block',
  block: 'accumulation',
  loadMode: 'rpeRange',
  /** Every rep target -1 per week; every prescribed %1RM +2.5 points per week. */
  weeklyRepDelta: -1,
  weeklyPctDelta: 2.5,
  character: 'More accessory work, higher reps, lower intensity. Builds the hypertrophy and work capacity that the intensification block then converts into strength. Half the volume comes from competition lifts.',
  days: [
    { n: 1, role: 'volume', label: 'Volume', slots: [
      advSlot('a1_sqvar',   'squatVariant',   null,       'variation', 3, 8,  null, [6, 8], 'lower'),
      advSlot('a1_bench',   'bench',          'bench',    'main',      3, 8,  70,   [6, 8], 'other'),
      advSlot('a1_verpull', 'verticalPull',   null,       'accessory', 3, 10, null, [6, 8], 'other'),
    ]},
    { n: 2, role: 'volume', label: 'Volume', slots: [
      advSlot('a2_hhvar',   'hipHingeVariant', null,      'accessory', 3, 8,  null, [6, 8], 'lower'),
      advSlot('a2_verpush', 'verticalPush',    null,      'accessory', 3, 8,  null, [6, 8], 'other'),
      advSlot('a2_tri',     'triceps',         null,      'isolation', 3, 10, null, [6, 8], 'other'),
    ]},
    { n: 3, role: 'technique', label: 'Technique', slots: [
      advSlot('a3_squat',   'squat',           'squat',   'main',      3, 4,  77.5, [5, 7], 'lower'),
      advSlot('a3_bench',   'bench',           'bench',   'main',      3, 4,  77.5, [5, 7], 'other'),
      advSlot('a3_horpull', 'horizontalPull',  null,      'accessory', 3, 8,  null, [6, 8], 'other'),
    ]},
    { n: 4, role: 'technique', label: 'Technique', slots: [
      advSlot('a4_dead',    'deadlift',        'deadlift', 'main',     3, 4,  77.5, [5, 7], 'lower'),
      advSlot('a4_bevar',   'benchVariant',    null,      'variation', 3, 8,  null, [6, 8], 'other'),
      advSlot('a4_ab',      'weightedAb',      null,      'isolation', 3, 10, null, [6, 8], 'other'),
    ]},
    { n: 5, role: 'strength', label: 'Strength', slots: [
      advSlot('a5_squat',   'squat',           'squat',   'main',      3, 5,  82.5, [7, 9], 'lower'),
      advSlot('a5_bench',   'bench',           'bench',   'main',      3, 5,  82.5, [7, 9], 'other'),
      advSlot('a5_facepull','facePull',        null,      'isolation', 3, 12, null, [6, 8], 'other'),
    ]},
    { n: 6, role: 'strength', label: 'Strength', slots: [
      advSlot('a6_dead',    'deadlift',        'deadlift', 'main',     3, 5,  82.5, [7, 9], 'lower'),
      advSlot('a6_verpush', 'verticalPush',    null,      'accessory', 3, 5,  null, [6, 8], 'other'),
      { key: 'a6_grip', slotType: 'grip', lift: null, role: 'accessory', sets: 3, timed: true,
        prescription: '10-20 s hold at 90-110% of your max, out of the rack near lockout — or a single-arm bodyweight hang for 10-20 s.',
        repRange: null, pctBase: null, rpeRange: null, inc: 'other' },
    ]},
  ],
};

export const ADVANCED_INTENSIFICATION = {
  id: 'advanced-pl-intensification',
  name: 'Advanced — Intensification Block',
  source: 'Helms — Muscle & Strength Pyramid: Training 2e, pp. 266-267',
  trainingAge: 'advanced',
  daysPerWeek: 6,
  cycleWeeks: 3,
  model: 'block',
  block: 'intensification',
  loadMode: 'rpeRange',
  weeklyRepDelta: -1,
  weeklyPctDelta: 2.5,
  character: 'Volume and reps come down, intensity goes up, accessory work is stripped back. 75% of volume now comes from the competition lifts. Day 5 becomes a full big-3 strength day and Day 6 becomes heavy-ish primer singles.',
  days: [
    { n: 1, role: 'volume', label: 'Volume', slots: [
      advSlot('i1_sqvar',   'squatVariant',   null,       'variation', 3, 7,  null, [6, 8], 'lower'),
      advSlot('i1_bench',   'bench',          'bench',    'main',      3, 7,  72.5, [6, 8], 'other'),
      advSlot('i1_verpull', 'verticalPull',   null,       'accessory', 3, 10, null, [6, 8], 'other'),
    ]},
    { n: 2, role: 'volume', label: 'Volume', slots: [
      advSlot('i2_hhvar',   'hipHingeVariant', null,      'accessory', 3, 7,  null, [6, 8], 'lower'),
      advSlot('i2_verpush', 'verticalPush',    null,      'accessory', 3, 7,  null, [6, 8], 'other'),
    ]},
    { n: 3, role: 'technique', label: 'Technique', slots: [
      advSlot('i3_squat',   'squat',           'squat',   'main',      3, 3,  80,   [5, 7], 'lower'),
      advSlot('i3_bench',   'bench',           'bench',   'main',      4, 3,  80,   [5, 7], 'other'),
      advSlot('i3_horpull', 'horizontalPull',  null,      'accessory', 3, 8,  null, [6, 8], 'other'),
    ]},
    { n: 4, role: 'technique', label: 'Technique', slots: [
      advSlot('i4_dead',    'deadlift',        'deadlift', 'main',     4, 3,  80,   [5, 7], 'lower'),
      advSlot('i4_bevar',   'benchVariant',    null,      'variation', 4, 7,  null, [6, 8], 'other'),
    ]},
    { n: 5, role: 'strength', label: 'Strength', slots: [
      advSlot('i5_squat',   'squat',           'squat',    'main',     3, 4,  85,   [7, 9], 'lower'),
      advSlot('i5_bench',   'bench',           'bench',    'main',     3, 4,  85,   [7, 9], 'other'),
      advSlot('i5_dead',    'deadlift',        'deadlift', 'main',     3, 4,  85,   [7, 9], 'lower'),
    ]},
    { n: 6, role: 'primer', label: 'Primer', slots: [
      advSlot('i6_squat',   'squat',           'squat',   'main',      3, 1,  77.5, [4, 6], 'lower'),
      advSlot('i6_bench',   'bench',           'bench',   'main',      3, 1,  77.5, [4, 6], 'other'),
    ]},
  ],
};

/** Advanced competition taper — meet week, p. 268. */
export const ADVANCED_TAPER = {
  id: 'advanced-pl-taper',
  name: 'Advanced Competition Taper (meet week)',
  source: 'Helms — Muscle & Strength Pyramid: Training 2e, p. 268',
  daysPerWeek: 6,
  cycleWeeks: 1,
  loadMode: 'rpeRange',
  days: [
    { n: 1, role: 'volume', label: 'Light volume', slots: [
      { key: 't1_sqvar',   slotType: 'squatVariant', lift: null,    role: 'variation', sets: 2, fixedReps: 5, pctBase: null, rpeRange: [5, 7], inc: 'lower' },
      { key: 't1_bench',   slotType: 'bench',        lift: 'bench', role: 'main',      sets: 2, fixedReps: 5, pctBase: 75,   rpeRange: [5, 7], inc: 'other' },
      { key: 't1_verpull', slotType: 'verticalPull', lift: null,    role: 'accessory', sets: 2, fixedReps: 6, pctBase: null, rpeRange: [5, 7], inc: 'other' },
    ]},
    { n: 2, role: 'off', label: 'Off', off: true, slots: [] },
    { n: 3, role: 'technique', label: 'Singles', slots: [
      { key: 't3_squat', slotType: 'squat',    lift: 'squat',    role: 'main', sets: 3, fixedReps: 1, pctBase: 82.5, rpeRange: [5, 7], inc: 'lower' },
      { key: 't3_bench', slotType: 'bench',    lift: 'bench',    role: 'main', sets: 3, fixedReps: 1, pctBase: 82.5, rpeRange: [5, 7], inc: 'other' },
      { key: 't3_dead',  slotType: 'deadlift', lift: 'deadlift', role: 'main', sets: 2, fixedReps: 1, pctBase: 82.5, rpeRange: [5, 7], inc: 'lower' },
    ]},
    { n: 4, role: 'technique', label: 'Singles', slots: [
      { key: 't4_squat', slotType: 'squat',    lift: 'squat',    role: 'main', sets: 2, fixedReps: 1, pctBase: 80, rpeRange: [4, 6], inc: 'lower' },
      { key: 't4_bench', slotType: 'bench',    lift: 'bench',    role: 'main', sets: 2, fixedReps: 1, pctBase: 80, rpeRange: [4, 6], inc: 'other' },
      { key: 't4_dead',  slotType: 'deadlift', lift: 'deadlift', role: 'main', sets: 1, fixedReps: 1, pctBase: 80, rpeRange: [4, 6], inc: 'lower' },
    ]},
    { n: 5, role: 'primer', label: 'Primer (24-48 h out)', note: 'Do not exceed RPE 5. Deadlift single is optional.', slots: [
      { key: 't5_squat', slotType: 'squat', lift: 'squat', role: 'main', sets: 1, fixedReps: 1, pctBase: 77.5, rpeMax: 5, inc: 'lower' },
      { key: 't5_bench', slotType: 'bench', lift: 'bench', role: 'main', sets: 1, fixedReps: 1, pctBase: 77.5, rpeMax: 5, inc: 'other' },
    ]},
    { n: 6, role: 'meet', label: 'Meet day', meet: true, slots: [] },
  ],
};

export const TEMPLATES = {
  [INTERMEDIATE_PL.id]: INTERMEDIATE_PL,
  [INTERMEDIATE_PL_3DAY.id]: INTERMEDIATE_PL_3DAY,
  [ADVANCED_ACCUMULATION.id]: ADVANCED_ACCUMULATION,
  [ADVANCED_INTENSIFICATION.id]: ADVANCED_INTENSIFICATION,
  [ADVANCED_TAPER.id]: ADVANCED_TAPER,
};

/* ---- reference data used by the coach + reference screens -------------- */

/** Deload assessment checklist, pp. 123 & 218. */
export const DELOAD_CHECKLIST = [
  { key: 'dread',  q: 'Are you dreading going to the gym?' },
  { key: 'sleep',  q: 'Is your sleep worse than normal?' },
  { key: 'perf',   q: 'Are your loads or reps decreasing?' },
  { key: 'stress', q: 'Is life stress worse than normal?' },
  { key: 'pain',   q: 'Are aches and pains worse than normal?' },
];

export function assessDeload(answers) {
  const yes = DELOAD_CHECKLIST.filter((c) => answers[c.key]).map((c) => c.key);
  const n = yes.length;
  if (n >= 2) return { verdict: 'deload', yes: n, flags: yes, why: `You answered yes to ${n} of 5. Take the deload week before starting the next, heavier wave.` };
  if (n === 1 && yes[0] === 'pain') {
    return {
      verdict: 'painWeek', yes: n, flags: yes,
      why: 'Aches and pains are your only flag. Rather than a full deload, run a normal-volume, normal-RPE week but raise the reps to 12-20. Keeps the stimulus while giving the joints a break.',
    };
  }
  return { verdict: 'proceed', yes: n, flags: yes, why: n === 0 ? 'Nothing flagged. Start the next cycle.' : 'One flag only. Start the next cycle.' };
}

/** Rep and RPE ranges by exercise role, p. 210. */
export const ROLE_RANGES = [
  { role: 'Main lift — strength',   reps: '1-5',  rpe: '7-10', note: 'Specific strength in the competition lifts and their variants.' },
  { role: 'Main lift — volume',     reps: '4-8',  rpe: '5-8',  note: 'Specific hypertrophy and work capacity.' },
  { role: 'Main lift — technique',  reps: '1-3',  rpe: '4-7',  note: 'Skill work and active recovery.' },
  { role: 'Compound accessory',    reps: '4-8',  rpe: '6-9',  note: 'Overhead press, good morning, barbell row.' },
  { role: 'Machine / isolation',   reps: '8-15', rpe: '7-10', note: 'Pushdowns, curls, machine rows.' },
];

/** Volume and frequency by training age, p. 208. */
export const VOLUME_BY_AGE = [
  { age: 'Novice',       sets: '10-12', freq: '2-3x / week' },
  { age: 'Intermediate', sets: '13-15', freq: '3-4x / week' },
  { age: 'Advanced',     sets: '16-20', freq: '3-5x / week' },
];

/** RPE scale, p. 65. */
export const RPE_SCALE = [
  { rpe: 10,  rir: '0',   meaning: 'Could not do more reps or more load.' },
  { rpe: 9.5, rir: '0+',  meaning: 'Could not do more reps, could do slightly more load.' },
  { rpe: 9,   rir: '1',   meaning: 'Could do 1 more rep.' },
  { rpe: 8.5, rir: '1-2', meaning: 'Could definitely do 1 more rep, chance at 2.' },
  { rpe: 8,   rir: '2',   meaning: 'Could do 2 more reps.' },
  { rpe: 7.5, rir: '2-3', meaning: 'Could definitely do 2 more reps, chance at 3.' },
  { rpe: 7,   rir: '3',   meaning: 'Could do 3 more reps.' },
  { rpe: 6,   rir: '4-6', meaning: 'Could do 4 to 6 more reps.' },
  { rpe: 5,   rir: '4-6', meaning: 'Could do 4 to 6 more reps. Light.' },
];

/** Warm-up protocol, p. 224. */
export const WARMUP = {
  general: [
    'Up to 5 min easy cardio if you want it',
    '10 leg swings front-to-back (each leg)',
    '10 leg swings side-to-side (each leg)',
    '10 arm circles forward, 10 backward',
    '10 cross-body arm slaps',
    '10 walking lunges with a trunk rotation',
  ],
  lowRep: {
    label: 'Working sets of 1-5 reps',
    sets: [
      { reps: '5-10', pct: null, label: 'Empty bar (optional)' },
      { reps: 5, pct: 50 },
      { reps: 4, pct: 60 },
      { reps: 3, pct: 70 },
      { reps: 2, pct: 80 },
      { reps: 1, pct: 90 },
    ],
  },
  highRep: {
    label: 'Working sets of 6+ reps',
    sets: [
      { reps: 8, pct: 50 },
      { reps: 4, pct: 70 },
      { reps: 2, pct: 90 },
    ],
  },
};

/** Rest periods, p. 184 — the only place the book quantifies rest. */
export const REST_GUIDE = {
  compound: 150,   // >= 2.5 min
  isolation: 90,   // >= 1.5 min
  apsUpper: 120,
  apsIsolation: 60,
  principle: 'Rest until you feel ready to perform at your best on the next set. The clock is a floor, not a target.',
};
