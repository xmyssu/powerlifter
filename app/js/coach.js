/* ==========================================================================
   coach.js — the book's decision rules, as functions and reference content.
   Every rule here traces to a page in Helms' Training pyramid; the page is
   cited so you can go read the argument rather than trust the app.
   ========================================================================== */

import { templateOf, graduationCheck, slotHistory, slotE1RM, volumeAudit, loadingWeeks, bestMaxFor } from './program.js';
import { e1RM, fmtLoad, convertLoad } from './rpe.js';
import { byId } from './exercises.js';
import { relDays } from './ui.js';

/* ======================================================================
   Readiness — "if you feel terrible, do the easiest workout you had
   planned for the week instead" (p. 36)
   ====================================================================== */

export const READINESS_QUESTIONS = [
  { key: 'sleep',      label: 'Sleep',      lowLabel: 'Terrible', highLabel: 'Great' },
  { key: 'energy',     label: 'Energy',     lowLabel: 'Empty',    highLabel: 'Buzzing' },
  { key: 'soreness',   label: 'Soreness',   lowLabel: 'Wrecked',  highLabel: 'Fresh', invert: false },
  { key: 'stress',     label: 'Life stress', lowLabel: 'Crushing', highLabel: 'Calm' },
  { key: 'motivation', label: 'Motivation', lowLabel: 'Dreading it', highLabel: 'Keen' },
];

/** Score 1-5 each; returns 0-100 plus a recommendation. */
export function readinessVerdict(answers, state) {
  const vals = READINESS_QUESTIONS.map((q) => Number(answers[q.key])).filter((v) => v >= 1);
  if (!vals.length) return null;
  const score = Math.round((vals.reduce((a, b) => a + b, 0) / (vals.length * 5)) * 100);

  const program = state.program;
  const tpl = templateOf(program);
  const easiest = tpl.days.find((d) => d.role === 'technique') || tpl.days[0];
  const todayIsEasiest = program.cursor.day === easiest.n;

  if (score <= 40) {
    return {
      score, level: 'poor',
      headline: 'Today is not the day to push.',
      advice: todayIsEasiest
        ? 'You are already on the technique day, which is the easiest session of the week. Run it as written — RPE 5 is meant to feel easy — and do not chase the loads.'
        : `The book's rule is to do the easiest workout you had planned for the week instead. That is Day ${easiest.n} (${easiest.label.toLowerCase()}). Swap it in and pick the harder day back up when you are recovered.`,
      cite: 'Level 1, p. 36 — lifters who chose their session by daily readiness gained more strength than a fixed-order group at matched volume.',
      offerSwap: !todayIsEasiest,
      swapToDay: todayIsEasiest ? null : easiest.n,
    };
  }
  if (score <= 60) {
    return {
      score, level: 'fair',
      headline: 'Go, but let RPE set the load.',
      advice: 'Train as planned, but hold the target RPE rather than the target load. If the prescribed weight comes in two points hot, use less weight — the effort is the prescription, the number on the bar is not.',
      cite: 'Level 1, p. 35 and Level 2, p. 65-66.',
      offerSwap: false,
    };
  }
  return {
    score, level: 'good',
    headline: 'Green light.',
    advice: 'Run the session as written.',
    cite: null,
    offerSwap: false,
  };
}

/* ======================================================================
   Gaps in training, and cramming
   ====================================================================== */

export function layoffAdvice(state) {
  const done = state.sessions.filter((s) => s.status === 'done').map((s) => s.date).sort();
  if (!done.length) return null;
  const last = done[done.length - 1];
  const gap = -relDays(last);
  if (gap <= 4) return null;

  if (gap <= 10) {
    return {
      level: 'info',
      headline: `${gap} days since your last session.`,
      advice: 'Pick up exactly where you left off — do not skip ahead to "catch up", and do not cram two sessions together. Finishing the cycle a few days late makes almost no difference over a training career.',
      cite: 'Level 1, pp. 37-38.',
    };
  }
  if (gap <= 28) {
    return {
      level: 'warn',
      headline: `${gap} days off.`,
      advice: 'Resume where you left off, but treat the first week as an introductory cycle: same exercises, about three-quarters of the volume, and a point lower on RPE. You will get the load back quickly and you avoid a week of pointless soreness.',
      cite: 'Level 3, pp. 104-105 (intro cycles).',
    };
  }
  return {
    level: 'warn',
    headline: `It has been ${Math.round(gap / 7)} weeks.`,
    advice: 'Start a fresh cycle rather than resuming mid-wave. Run an introductory cycle first — three-quarters of the volume at a point lower RPE — and re-anchor your loads by feel against the target RPEs rather than trusting the old numbers.',
    cite: 'Level 3, pp. 104-105.',
  };
}

/* ======================================================================
   Pain and injury (p. 42) — deliberately not softened
   ====================================================================== */

export const PAIN_PROTOCOL = {
  title: 'Something hurts',
  intro: 'Aches, niggles, strains and general stiffness are part of the serious lifter\'s experience. The book is blunt in both directions: do not train through pain, and do not let fear make you irrationally conservative either.',
  chain: [
    { step: 'If it hurts, don\'t do it.', detail: 'Not as a permanent rule — as the starting point for the next three steps.' },
    { step: 'Alter the range of motion.', detail: 'Often the cheapest fix. Find the part of the ROM that is pain-free and work there for now.' },
    { step: 'Reduce the load.', detail: 'Keep the pattern, drop the weight.' },
    { step: 'Replace the movement.', detail: 'Swap in something comparable that trains the same muscles pain-free. The app\'s exercise picker is built for this — every slot has alternatives.' },
  ],
  bfr: {
    title: 'If you need to keep training a joint that hurts',
    detail: 'Blood flow restriction lets single-joint work produce a real hypertrophy stimulus at 20-30% of 1RM. Wrap the proximal limb to about 7/10 tightness — no tingling, no colour change in the limb — and take your normal number of sets to failure. Good for hypertrophy, not for strength.',
  },
  jointOnly: 'If joint or tendon pain is your only complaint, do not deload. Run a normal week for volume and RPE but raise the reps to 12-20. That keeps the stimulus while dropping the peak joint stress.',
  escalate: 'If you cannot easily work around it, or the pain is not gone in a matter of weeks, see a specialist — a physio or sports-injury doctor who works with lifters. Do not self-diagnose and do not crowd-source it.',
  cite: 'Level 1, pp. 40-42; Level 3, p. 124.',
};

/* ======================================================================
   Plateau resolution — the book's progress flowchart (pp. 87, 121-126)
   ====================================================================== */

export const PLATEAU_TREE = [
  {
    q: 'Is your technique actually solid, and is the exercise selection right for you?',
    ifNo: 'Fix that first. No amount of volume manipulation compensates for a movement you cannot execute or one that does not suit your leverages. Film your sets and get eyes on them.',
    cite: 'pp. 121-122, 163-164',
  },
  {
    q: 'Are you sleeping, eating and recovering adequately? Is life stress under control?',
    ifNo: 'Training is not the variable to change. Nothing in a program can outrun a calorie deficit plus six hours of sleep plus a crisis at work. Address the input before you touch the plan.',
    cite: 'pp. 35, 121',
  },
  {
    q: 'Have you run a deload recently?',
    ifNo: 'Deload first, then reassess. A plateau caused by accumulated fatigue looks exactly like a plateau caused by too little volume, and the deload is the cheap way to tell them apart.',
    cite: 'p. 123',
  },
  {
    q: 'After deloading, did you fall straight back into feeling under-recovered?',
    ifYes: 'Cut volume by about 20% of your weekly sets per muscle group or movement — 15 sets becomes 12. You are past what you can currently recover from.',
    cite: 'pp. 124-125',
  },
  {
    q: 'Is everything else in order and you are still stuck across multiple lifts?',
    ifYes: 'Now add volume: 1-2 sets per muscle group or movement pattern, roughly a 10% increase. Add it, give it a full mesocycle, and judge it then.',
    cite: 'pp. 125-126',
  },
  {
    q: 'Still stuck, and your weekly volume is already high?',
    ifYes: 'Increase frequency rather than piling more sets into the same sessions — spreading the same volume across more days keeps per-session quality up.',
    cite: 'p. 126',
  },
];

/* ======================================================================
   Sticking points and technical faults (pp. 158-163)
   ====================================================================== */

export const STICKING_POINT_PREAMBLE = {
  title: 'Before you pick a fix, read this',
  points: [
    'Where the bar visibly sticks is not where the force deficit is. By the time it stalls you are already past the point where you stopped producing enough force — like screeching to a halt past where you meant to stop.',
    'So do not pause at your sticking point. Pausing there requires you to produce less force at exactly the point you want to produce more.',
    'Sticking points do not move. Fixing the underlying weakness means you lift more weight and still stick in the same place.',
    'Variation is not randomisation. Pick a variation because it punishes a fault you actually have. Sometimes the right answer is just more practice of the competition lift.',
  ],
  methods: [
    'Pauses — for motor learning, to break a lift into chunks. Not at the stick.',
    'Isometrics at the point of the force deficit. Finding that point properly needs video at minimum.',
    'Variations that force efficient technique and punish the specific error.',
    'Explosive work, with or without bands or chains, to build force before the sticking region. Not everyone responds.',
  ],
  cite: 'Level 4, pp. 158-163.',
};

export const FAULTS = [
  {
    lift: 'Squat', id: 'sq-bounce',
    fault: 'I lose tightness coming out of the hole and cannot control the bounce',
    cause: 'A poor eccentric-to-concentric transition — elastic energy mismanaged and tension lost at the bottom.',
    fix: 'Pause squats, pausing in the hole. Letting the elastic energy dissipate forces you to generate and feel tightness before you drive, and that control carries back to your normal squat.',
    exercises: ['pause-squat'],
    page: 160,
  },
  {
    lift: 'Squat', id: 'sq-mornings',
    fault: 'Near maximal loads my hips shoot up and it turns into a good morning',
    cause: 'A technical fault that only shows up at heavy loads, which then creates or worsens the sticking point.',
    fix: 'Front squats. A front squat gets dumped forward the instant your hips shoot up and you lose back tightness, so the variation punishes the exact error and rewards avoiding it — and the rack position is a real anti-flexion demand on the back extensors.',
    exercises: ['front-squat'],
    page: 161,
  },
  {
    lift: 'Squat', id: 'sq-hole',
    fault: 'I get stuck in the hole and cannot reverse it',
    cause: 'A rate-of-force-development deficit before the sticking region.',
    fix: 'Explosive or speed squats, possibly with bands or chains. Accommodating resistance removes the braking phase you get with light loads, so you can keep accelerating. Worth knowing that responder status here is highly individual.',
    exercises: ['explosive-speed-squat', 'squat-with-accommodating-resistance-bands-chains'],
    page: 162,
  },
  {
    lift: 'Squat', id: 'sq-quads',
    fault: 'I am very bent over when I squat and my quads are underdeveloped',
    cause: 'Long femurs relative to your torso. The bar has to stay over midfoot, so you get heavy forward lean, little knee travel, quads working through a short range, and extra lumbar stress.',
    fix: 'You cannot swap the competition squat, but you can keep its volume moderate and build the quads elsewhere — front squats or leg press — so they contribute more when you do squat.',
    exercises: ['front-squat', 'leg-press', 'hack-squat'],
    page: 157,
  },
  {
    lift: 'Bench', id: 'bp-chest',
    fault: 'I get stuck right off the chest',
    cause: 'A rate-of-force-development deficit at the start of the concentric.',
    fix: 'Explosive or speed bench, possibly with accommodating resistance.',
    exercises: ['explosive-speed-bench-press', 'bench-press-with-accommodating-resistance'],
    page: 162,
  },
  {
    lift: 'Bench', id: 'bp-deadstop',
    fault: 'I struggle to start from a dead stop, or the press command catches me out',
    cause: 'Not enough practice producing force from a motionless bar.',
    fix: 'Longer pauses on the chest as the meet approaches — a two-count bench. You do not know how long the command will take, and getting better at generating force from a dead stop is worth training directly.',
    exercises: ['long-pause-bench-press'],
    page: 160,
  },
  {
    lift: 'Bench', id: 'bp-pain',
    fault: 'Benching often enough to progress makes my elbows or shoulders hurt',
    cause: 'Your volume tolerance on the competition bench is the limiting factor, not your strength.',
    fix: 'Bench only the frequency and volume you can do pain-free, then make up the missing volume with close-grip bench, overhead press or dumbbell press.',
    exercises: ['close-grip-bench-press', 'overhead-press', 'dumbbell-bench-chest-press'],
    page: 158,
  },
  {
    lift: 'Bench', id: 'bp-wide',
    fault: 'I bench with a wide grip',
    cause: 'Wide-grip benchers typically run into a triceps or mid-range limitation.',
    fix: 'Close-grip bench as your variation. Close means closer than your competition grip — not extremely close. The narrowest sensible grip is about push-up width with your elbows tucked.',
    exercises: ['close-grip-bench-press'],
    page: 228,
  },
  {
    lift: 'Deadlift', id: 'dl-drift',
    fault: 'The bar drifts out in front of me',
    cause: 'Poor bar path — a motor pattern problem.',
    fix: 'Pause below the knee. Pausing there may teach you to keep the bar close, and it chunks the lift into pieces you can actually learn.',
    exercises: ['pause-deadlift'],
    page: 159,
  },
  {
    lift: 'Deadlift', id: 'dl-flexion',
    fault: 'My back rounds at maximal loads even though it stays rigid otherwise',
    cause: 'A technical fault appearing near maximum, which prompts or worsens the sticking point.',
    fix: 'Use a variation that punishes flexion and rewards avoiding it. RDLs and good mornings impose a large anti-flexion and scapular-retraction demand and are the obvious candidates.',
    exercises: ['romanian-deadlift', 'good-morning'],
    page: 161,
  },
  {
    lift: 'Deadlift', id: 'dl-floor',
    fault: 'I cannot break the bar off the ground',
    cause: 'A rate-of-force-development deficit at the start of the pull.',
    fix: 'Explosive or speed pulls, possibly with accommodating resistance.',
    exercises: ['explosive-speed-deadlift', 'deadlift-with-accommodating-resistance-bands-chains'],
    page: 162,
  },
  {
    lift: 'Deadlift', id: 'dl-grip',
    fault: 'I pull more with straps than with chalk',
    cause: 'Grip is the weakest link. Note that more deadlifting logically will not fix this — if deadlifting fixed grip, the problem would not have arisen.',
    fix: 'Attack it directly: rack partial deadlifts near lockout held for time at a high percentage — three sets of 10-20 seconds at 90-110% of your max, building time and load over cycles. Single-arm bodyweight hangs are a good alternative when your spine has had enough compression. Crushing grippers transfer poorly; you need static holding of a very heavy bar.',
    exercises: ['rack-partial-hold', 'single-arm-bodyweight-hang-for-time'],
    page: 157,
  },
  {
    lift: 'Any', id: 'any-lockout',
    fault: 'I am specifically weak near lockout',
    cause: 'The strength curve gets easier as leverage improves, so a lockout weakness is unusual and worth targeting.',
    fix: 'Accommodating resistance — bands or chains — which load you more as you gain the advantage. Be aware the meta-analysis finds no average advantage over straight weight, so treat this as a case-by-case tool rather than a general upgrade.',
    exercises: ['squat-with-accommodating-resistance-bands-chains', 'bench-press-with-accommodating-resistance', 'deadlift-with-accommodating-resistance-bands-chains'],
    page: 161,
  },
];

/* ======================================================================
   Session-time notes: what to tell the lifter about this specific day
   ====================================================================== */

export function sessionBriefing(resolved, state) {
  const notes = [];
  const tpl = resolved.template;

  if (resolved.isDeload) {
    notes.push({
      kind: 'deload',
      title: 'This is a deload week',
      text: tpl.model === 'block'
        ? 'Week 3 repeated at two-thirds of the sets, a point lower on RPE, five percentage points lighter. The point is to shed fatigue while keeping the pattern — do not turn it into a training week.'
        : 'The lowest reps and the lightest load of the wave, at two-thirds of the sets — which is why the RPE target drops with them, to about 6 on your main lifts. It will feel easy. That is the entire point: you are here to arrive at the next cycle recovered, not to prove anything. Do not load the bar back up to chase last week\'s number.',
    });
  }

  if (resolved.isPainWeek) {
    notes.push({
      kind: 'painWeek',
      title: 'High-rep week — same effort, lighter bar',
      text: 'Aches and pains were your only flag, so this is not a deload. Volume and RPE stay exactly where they were; the reps go up to twelve and the load comes down to meet them. That keeps the training stimulus while taking the peak stress off the joint. If a movement still hurts at these reps, swap it rather than grinding it — every slot has alternatives behind the swap button.',
    });
  }

  // On the four-day this is a whole day; on the three-day the same sets are
  // folded in ahead of the heavy work. Either way the lifter needs telling that
  // these are not meant to progress.
  const techSlots = resolved.slots.filter((s) => s.slot?.technique);
  if (resolved.dayDef.role === 'technique' || techSlots.length) {
    const wholeDay = resolved.dayDef.role === 'technique';
    const named = techSlots.map((s) => s.exercise?.short).filter(Boolean).join(' and ');
    notes.push({
      kind: 'technique',
      title: wholeDay
        ? 'Technique day — stay four to six reps shy of failure'
        : `Technique work first${named ? ` — ${named}` : ''} — stay four to six reps shy of failure`,
      text: wholeDay
        ? 'RPE 5 is not a suggestion to be beaten. This day exists to build skill on the competition lifts without adding fatigue, and it is designed to stay submaximal indefinitely. If the loads here never climb, nothing is wrong.'
        : 'RPE 5 is not a suggestion to be beaten. These opening sets build skill on the competition lifts without adding fatigue, which is why they come before the heavy work rather than after it. They are designed to stay submaximal indefinitely — if the loads never climb, nothing is wrong, and coming up short here is never counted as a stall.',
    });
  }

  if (resolved.dayDef.role === 'strength') {
    notes.push({
      kind: 'strength',
      title: 'Strength day — this is where you push',
      text: 'Pick the load off your first set landing on RPE 8, then hold it. If you blast past RPE 10 by the last set you either started too heavy, under-rested, or something broke down technically.',
    });
  }

  const layoff = layoffAdvice(state);
  if (layoff) notes.push({ kind: 'layoff', title: layoff.headline, text: layoff.advice, cite: layoff.cite });

  if (resolved.week === 1 && resolved.cycle > 1 && !resolved.isDeload) {
    notes.push({
      kind: 'cycle',
      title: `Cycle ${resolved.cycle}, week 1`,
      text: 'Back to the top of the rep ranges, one increment heavier than last cycle\'s week 1. Reps are high and loads feel manageable — resist adding weight because it feels easy, because weeks 2 and 3 are built on this anchor.',
    });
  }

  const rest = tpl.days.find((d) => d.n === resolved.day)?.role === 'strength' ? 150 : 90;
  return { notes, restSeconds: rest };
}

/* ======================================================================
   Milestones — the numbers that actually feel like something
   ====================================================================== */

/**
 * A strength chart is an honest picture of progress and a poor motivator. Nobody
 * sets out to add 4.4 kg to an estimated max; they set out to pull four plates.
 * The milestones here are the round numbers and the plate-count numbers, because
 * those are the ones a lifter actually wants, and knowing one is within reach is
 * the difference between waiting for a date and going to get it.
 */
const ROUND_TARGETS = {
  kg: { squat: [60, 100, 140, 180, 200, 220], bench: [60, 80, 100, 120, 140], deadlift: [100, 140, 180, 200, 220, 250] },
  lb: { squat: [135, 225, 315, 405], bench: [135, 185, 225, 275, 315], deadlift: [225, 315, 405, 495] },
};

/**
 * Bar plus N pairs of *the* plate — "three plates", "four plates".
 *
 * Not the heaviest plate on the rack. When a lifter says four plates they mean
 * four of the big ones: the 20 kg red, or the 45 lb. A gym with 25s in it does
 * not make 170 kg "three plates" to anyone who lifts there, and naming the
 * milestone wrong is worse than not having it — the whole value of a milestone
 * is that it is the number the lifter already had in their head. Falls back to
 * the heaviest available for a gym that has no standard plate.
 */
const BIG_PLATE = { kg: 20, lb: 45 };

function plateTargets(profile) {
  const have = (profile.plates || []).filter((x) => x > 0);
  if (!have.length) return [];
  const standard = BIG_PLATE[profile.units];
  const plate = have.includes(standard) ? standard : Math.max(...have);
  const out = [];
  for (let n = 1; n <= 6; n++) out.push({ load: profile.barWeight + 2 * plate * n, plates: n });
  return out;
}

/**
 * Every milestone for the three competition lifts, nearest first.
 *
 * `done` is judged against what the lifter has actually put on a bar, not
 * against an estimate — "four plates" means you pulled it, and an app that
 * congratulates you for a number you inferred from a triple is lying to you.
 * `inRange` uses the estimate, because that is the right basis for "go and try".
 */
export function milestones(state, { perLift = 3 } = {}) {
  const profile = state.profile;
  const units = profile.units;
  const plates = plateTargets(profile);
  const out = [];

  for (const lift of ['squat', 'bench', 'deadlift']) {
    const est = bestMaxFor(state, lift) || 0;

    // The heaviest single this lifter has genuinely completed on this lift.
    let lifted = 0;
    const tpl = templateOf(state.program);
    const keys = [`test_${lift}`];
    for (const d of tpl.days) for (const sl of d.slots) if (sl.lift === lift) keys.push(sl.key);
    for (const key of keys) {
      for (const h of slotHistory(state, key)) {
        for (const set of h.sets) if (set.reps === 1 && set.load > lifted) lifted = set.load;
      }
    }

    const rate = liftRate(state, lift);
    const perWeek = rate.perWeek && rate.perWeek > 0.05 ? rate.perWeek : null;

    // Plate counts first, so that when 180 kg is both "180" and "four plates"
    // the dedupe below keeps the one a lifter would actually say.
    const targets = [
      ...plates.map((p) => ({ load: p.load, kind: 'plates', plates: p.plates })),
      ...(ROUND_TARGETS[units]?.[lift] || []).map((load) => ({ load, kind: 'round' })),
    ];

    const seen = new Set();
    const rows = [];
    for (const t of targets.slice().sort((a, b) => a.load - b.load || (a.kind === 'plates' ? -1 : 1))) {
      if (seen.has(t.load)) continue;
      seen.add(t.load);
      const done = lifted >= t.load - 1e-9;
      const away = +(t.load - est).toFixed(1);
      rows.push({
        lift,
        load: t.load,
        label: t.kind === 'plates'
          ? `${t.plates} plate${t.plates === 1 ? '' : 's'} · ${t.load} ${units}`
          : `${t.load} ${units}`,
        kind: t.kind,
        done,
        // Within one small jump of the current estimate: go and try it.
        inRange: !done && est > 0 && away <= (units === 'kg' ? 2.5 : 5),
        away: done ? 0 : away,
        weeksOff: done || !perWeek || away <= 0 ? null : Math.ceil(away / perWeek),
        perWeek,
      });
    }

    // The ones worth showing: the last one cleared, then the next few ahead.
    const doneRows = rows.filter((r) => r.done);
    const ahead = rows.filter((r) => !r.done).slice(0, perLift);
    out.push({
      lift,
      est: est ? +est.toFixed(1) : null,
      lifted: lifted || null,
      cleared: doneRows.length ? doneRows[doneRows.length - 1] : null,
      next: ahead,
    });
  }
  return out;
}

/* ======================================================================
   Training age — am I still an intermediate?
   ====================================================================== */

/**
 * The book's own classification, and it is deliberately not a strength standard
 * (p. 100):
 *
 *   "it is most useful to categorize ourselves based on the length of time it
 *    takes to improve (strength), rather than an arbitrary strength standard or
 *    the length of time we have been lifting ... some lifters have been hitting
 *    the gym for over 10 years, but functionally are still intermediates."
 *
 * So the question "are my numbers intermediate numbers?" has no answer. The
 * question that does is "how often can I still add load?" (p. 103).
 */
export const TRAINING_AGE_BANDS = [
  { age: 'novice',       label: 'Novice',       adds: 'every session', note: 'Add load workout to workout on a single progression.' },
  { age: 'intermediate', label: 'Intermediate', adds: 'every week',    note: 'Load climbs across a wave; the cycle repeats heavier.' },
  { age: 'advanced',     label: 'Advanced',     adds: 'every month',   note: 'Progress is a block-to-block question, not a weekly one.' },
];

export const TRAINING_AGE_CITE = 'Level 3, pp. 100-103 (how training age is defined); p. 245 (when to leave the intermediate program).';

/** The 28-day change in a lift's trusted estimate, and the weekly slope. */
function liftRate(state, lift) {
  const all = strengthTrend(state, lift);
  // Same exclusions trendSummary applies: a deload is light by design and a
  // set of nine does not estimate the same 1RM as a hard triple. A rate built
  // from either measures something other than strength.
  const pts = all.filter((p) => !p.deload && !p.estimatedFromHighReps);
  if (pts.length < 2) return { lift, points: pts.length, delta: null, perWeek: null, soft: all.length > pts.length };

  const end = pts[pts.length - 1].date;
  const window = pts.filter((p) => daysBetween(p.date, end) <= 28);
  const use = window.length >= 2 ? window : pts.slice(-2);
  const days = daysBetween(use[0].date, use[use.length - 1].date);

  // A rate needs a span to be a rate. Readings inside one week — or, in the
  // degenerate case, all on one date — produce a slope that is either wildly
  // over-confident or exactly zero, and neither is worth putting on a card next
  // to the words "per week".
  const spanned = days >= 7;
  return {
    lift,
    points: use.length,
    delta: +(use[use.length - 1].value - use[0].value).toFixed(1),
    days,
    perWeek: spanned ? +slopePerWeek(pts).toFixed(2) : null,
    first: use[0],
    last: use[use.length - 1],
    soft: all.length > pts.length,
  };
}

/**
 * Where the lifter sits, and how far they are from the next stage.
 *
 * The verdict is the stall criterion, not the rate. p. 245 is specific: you move
 * up when you stall on a strength-day main lift, restart 5-10% lighter with
 * halved increments, and then stall *again* — on most of those lifts. The rate
 * is shown alongside because it is the thing that tells you the current program
 * is still working, but it is not the decision rule and must not read as one.
 */
export function trainingAgeReport(state) {
  const program = state.program;
  if (!program) return null;
  const tpl = templateOf(program);

  const lifts = [
    { lift: 'squat', label: 'Squat' },
    { lift: 'bench', label: 'Bench press' },
    { lift: 'deadlift', label: 'Deadlift' },
  ].map((l) => ({ ...l, ...liftRate(state, l.lift) }));

  // Per strength-day main lift: how much of the graduation criterion is met.
  const rows = [];
  for (const day of tpl.days) {
    if (day.role !== 'strength') continue;
    for (const slot of day.slots) {
      if (slot.role !== 'main' && slot.role !== 'variation') continue;
      const st = program.slots[slot.key] || {};
      rows.push({
        slotKey: slot.key,
        label: byId(program.choices?.[slot.key])?.short || slot.slotType,
        stalls: st.stalls || 0,
        smallIncrement: !!st.smallIncrement,
        // The book's bar: stalled again *after* the increments were already cut.
        qualifies: !!st.smallIncrement && (st.stalls || 0) >= 2,
      });
    }
  }
  const have = rows.filter((r) => r.qualifies).length;
  const need = Math.ceil(rows.length / 2);

  const grad = graduationCheck(state);
  const isIntermediate = tpl.trainingAge === 'intermediate';

  let verdict, why;
  if (!isIntermediate) {
    verdict = tpl.trainingAge;
    why = `You are running an ${tpl.trainingAge} template, so the intermediate graduation test does not apply.`;
  } else if (grad.ready) {
    verdict = 'graduate';
    why = grad.text;
  } else if (have > 0) {
    verdict = 'intermediate';
    why = `${have} of your ${rows.length} strength-day main lifts have stalled twice on cut increments. The book's bar is ${need}. Keep going until then.`;
  } else {
    const stalledAny = rows.some((r) => r.stalls > 0);
    verdict = 'intermediate';
    why = stalledAny
      ? 'You have stalled, but not yet stalled a second time on already-halved increments. That second stall is the signal, not the first.'
      : 'No stalls on your strength days, and your increments have never been cut. The intermediate progression is still doing its job — moving up now would deliberately slow you down.';
  }

  return {
    age: tpl.trainingAge,
    templateName: tpl.name,
    bands: TRAINING_AGE_BANDS,
    lifts,
    rows,
    have,
    need,
    ready: !!grad.ready,
    verdict,
    why,
    cite: TRAINING_AGE_CITE,
  };
}

/* ======================================================================
   Progress read-out
   ====================================================================== */

/** e1RM series per competition lift, from every logged set of that lift. */
export function strengthTrend(state, lift) {
  const program = state.program;
  if (!program) return [];
  const tpl = templateOf(program);
  const keys = [`test_${lift}`];   // a logged single is the truest point on the chart
  for (const d of tpl.days) for (const s of d.slots) if (s.lift === lift) keys.push(s.key);

  // One chart, one axis: a session logged in pounds has to be brought into the
  // unit being displayed before its estimate can sit next to a kilo one.
  const to = state.profile?.units;

  const points = [];
  for (const s of state.sessions) {
    if (s.status !== 'done') continue;
    const from = s.units || to;
    for (const e of s.entries) {
      if (!keys.includes(e.slotKey)) continue;
      const sets = (e.sets || []).filter((x) => x.done && x.load > 0 && x.reps > 0);
      if (!sets.length) continue;
      // Only sets of about 5 reps or fewer give a trustworthy 1RM estimate.
      const usable = sets.filter((x) => x.reps <= 6);
      const pool = usable.length ? usable : sets;
      const best = Math.max(...pool.map((x) => e1RM(convertLoad(x.load, from, to), x.reps, x.rpe ?? e.targetRPE ?? 8) || 0));
      if (best > 0) points.push({ date: s.date, value: +best.toFixed(1), cycle: s.cycle, week: s.week, day: s.day, deload: s.phase === 'deload', estimatedFromHighReps: !usable.length });
    }
  }
  // Two points on the same date must compare equal, or a stable sort is asked to
  // swap them and the day's readings come out in an arbitrary order.
  return points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** How far back the trend line looks, in days. */
const TREND_WINDOW_DAYS = 35;

export function trendSummary(points) {
  if (points.length < 2) return null;

  // Two kinds of point are plotted but must not drive these stats.
  //
  // Estimates from sets above six reps are the ones the book distrusts, and they
  // are systematically off rather than merely noisy — a hard triple and a set of
  // nine do not estimate the same 1RM. Reporting a headline best or a change
  // from one puts a number on the card that the app's own fine print tells the
  // lifter to disregard.
  //
  // Deload weeks are deliberately light, so an estimate from one says nothing
  // about peak capability. Worse, leaving the dip in the regression window makes
  // the climb back out of it read as progress: on this data the slope came out
  // three times steeper than the lifter's real rate, because it was measuring
  // recovery from a deload rather than strength.
  //
  // Both stay in the chart, where the dip is honest and the caveat beneath
  // explains the loose points. If filtering leaves too little, take what there is.
  const trusted = points.filter((p) => !p.estimatedFromHighReps && !p.deload);
  const pool = trusted.length >= 2 ? trusted : points;

  const first = pool[0], last = pool[pool.length - 1];
  const delta = last.value - first.value;
  const best = pool.reduce((a, b) => (b.value > a.value ? b : a), pool[0]);
  return { delta, best, first, last, perWeek: slopePerWeek(pool), n: pool.length, nAll: points.length };
}

/**
 * Least-squares slope through recent estimates, in units per week.
 *
 * The obvious version — last reading minus the one six ago, over the days
 * between — hangs the whole figure on two noisy points, and "six readings" is
 * not a fixed amount of time: on a lift trained three times a week it spans ten
 * days, so the number lurches session to session and reads far steeper than any
 * real rate of progress. Regressing over a fixed window of time instead gives a
 * figure that means what the label says.
 */
function slopePerWeek(points) {
  if (points.length < 2) return 0;
  const end = points[points.length - 1].date;
  let window = points.filter((p) => daysBetween(p.date, end) <= TREND_WINDOW_DAYS);
  // Regress over at least three readings, however far back they sit.
  if (window.length < 3) window = points.slice(-3);
  if (window.length < 2) return 0;

  const xs = window.map((p) => daysBetween(window[0].date, p.date));
  const ys = window.map((p) => p.value);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  if (den === 0) return 0;                    // every reading landed on one day
  return (num / den) * 7;
}

function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}

/** Anything the coach wants to raise, unprompted, on the home screen. */
export function activeInsights(state) {
  const out = [];
  const program = state.program;
  if (!program) return out;

  if (program.pendingAssessment) {
    out.push({
      kind: 'assessment', priority: 1,
      title: 'Cycle finished — run the checklist',
      text: 'Three loading weeks are done. Five questions decide whether you deload or go straight into the next, heavier cycle.',
      action: 'assessment',
    });
  }

  if (program.forcedDeload && !program.pendingAssessment) {
    out.push({
      kind: 'stall', priority: 2,
      title: 'A stall was recorded this cycle',
      text: 'Finish the cycle, dropping load where you need to so every set and rep gets completed. The week-4 deload is now mandatory regardless of how the checklist scores.',
    });
  }

  const grad = graduationCheck(state);
  if (grad.ready) {
    out.push({ kind: 'graduate', priority: 1, title: 'Time to move up', text: grad.text, action: 'graduate' });
  }

  if (program.cyclesSinceDeload >= 2 && !program.pendingAssessment) {
    out.push({
      kind: 'deloadDue', priority: 3,
      title: 'Deload due after this cycle',
      text: 'You have run two cycles without one. The book\'s backstop is a deload every third mesocycle no matter what the checklist says.',
    });
  }

  const layoff = layoffAdvice(state);
  if (layoff) out.push({ kind: 'layoff', priority: 2, title: layoff.headline, text: layoff.advice });

  const meet = program.meetDate ? relDays(program.meetDate) : null;
  if (meet != null && meet >= 0 && meet <= 35) {
    out.push({
      kind: 'meet', priority: 1,
      title: `${meet} days to your meet`,
      text: meet <= 28
        ? 'You are inside the peaking window. Open the meet plan to switch the strength-day main lifts to 1-3 reps and schedule opener practice and the primer session.'
        : 'Four weeks out is where the peaking cycle starts. Get ready to switch over.',
      action: 'meet',
    });
  }

  return out.sort((a, b) => a.priority - b.priority);
}

/* ======================================================================
   Reference content for the library screen
   ====================================================================== */

export const REFERENCE = [
  {
    id: 'rpe',
    title: 'RPE, and how it sets your load',
    body: [
      'RPE here means reps in reserve, not how hard your face is. RPE 8 on a set of four means you stopped with two good reps left. That is the whole definition and it is the mechanism the entire program runs on.',
      'The listed %1RM is a reference, not the prescription. It exists to get you roughly into the right area on your first set. If 82.5% comes in at RPE 9 today, 82.5% is wrong today — the RPE is right.',
      'On this program you take the first set to the target RPE and then hold that load for the remaining sets. Later sets will drift up in RPE as you fatigue, and that is expected. What is not expected is blowing past RPE 10 — that means you opened too heavy, rested too little, or something went wrong technically.',
      'RPE takes months to get accurate. Log it on every set even when it is not setting the load, film your heavy sets, and compare what you guessed to what the bar actually did.',
    ],
    cite: 'Level 2, pp. 63-68.',
  },
  {
    id: 'volume',
    title: 'Volume — how much is enough',
    body: [
      'Volume is counted in hard sets per muscle group or movement pattern per week. Not tonnage, not reps.',
      'As an intermediate the target is 13 to 15 sets per muscle group per week, at a frequency of three to four sessions per week for each. This program lands on 15/15/15 across upper push, upper pull and lower body — squarely on target.',
      'More is better only up to a point, and that point is your recovery. The dose-response curve is an inverted U: past your limit, more sets buy you fatigue rather than adaptation.',
      'When you genuinely plateau and everything else is in order, add one to two sets per muscle group — about a 10% bump — and give it a full cycle before judging it.',
    ],
    cite: 'Level 2, pp. 45-61; p. 208.',
  },
  {
    id: 'warmup',
    title: 'Warming up',
    body: [
      'Up to five minutes of easy cardio if you want it, then a short dynamic sequence: leg swings both directions, arm circles both directions, cross-body arm slaps, walking lunges with a trunk rotation. Ten of each.',
      'For working sets of one to five reps, ramp: an optional empty-bar set, then 5 at 50%, 4 at 60%, 3 at 70%, 2 at 80%, 1 at 90% of your working weight.',
      'For working sets of six or more, a shorter ramp is enough: 8 at 50%, 4 at 70%, 2 at 90%.',
      'On static stretching: stretching a muscle group into acutely increased flexibility reduces its performance. Stretch things you are not about to train as much as you like — pecs and delts before a low-bar squat, for instance. For a muscle you are about to train, warm it up rather than stretch it out.',
    ],
    cite: 'pp. 221-224.',
  },
  {
    id: 'rest',
    title: 'Rest periods',
    body: [
      'The real rule: rest until you feel ready to perform at your best on the next set. The clock is a floor, not a target.',
      'If you know you rush, put numbers on it — at least 2.5 minutes between sets on compound lifts, at least 1.5 minutes on smaller muscle groups.',
      'Short rest periods are not a hypertrophy tool. The hormone-response argument for them does not hold up, and cutting rest costs you reps and load, which are what actually drive adaptation.',
      'If you are genuinely time-pressed, antagonist paired sets are the efficient answer — alternate an upper push with an upper pull, about two minutes between sets. Do not pair anything around squats.',
    ],
    cite: 'Level 5, pp. 171-187.',
  },
  {
    id: 'tempo',
    title: 'Tempo',
    body: [
      'Control the eccentric to some degree and drive the concentric forcefully. That is very nearly the whole of it.',
      'Deliberately slow training is inferior in most studies. Slowing the eccentric forces you to reduce load and volume, and time under tension is not the variable that matters — force is, and impulse over the set follows from it.',
      'Do not confuse a controlled eccentric with a slow one. A powerlifter dropping into a deadlift eccentric fast is not making an error; a bodybuilder throwing a curl down is.',
    ],
    cite: 'Level 6, pp. 188-202.',
  },
  {
    id: 'rom',
    title: 'Range of motion',
    body: [
      'Train with the full range of motion you actually have. Partial-range work lets you handle more weight and buys less hypertrophy for it, and strength is range-specific — full squats make you stronger at partial squats, but not the reverse.',
      'If your range is limited, build it slowly: small increases in the weight room plus stretching, just not immediately before training.',
    ],
    cite: 'Level 4, pp. 165-166.',
  },
  {
    id: 'order',
    title: 'Exercise order',
    body: [
      'Compound barbell work goes first in almost every case — it is the most complex, the most fatiguing, carries the most injury risk, and you can do more of it while fresh.',
      'The one exception is a glaring weak point that no compound in your program trains, and only when fatiguing it would not compromise the barbell work that follows.',
    ],
    cite: 'Level 4, pp. 164-167.',
  },
  {
    id: 'autoreg',
    title: 'Autoregulation',
    body: [
      'Days off: when you train four or more days a week, keep the sessions fixed and float your rest days to where you need them most. With two or three days a week, flexible training days work better.',
      'Load: your first set at the reference percentage tells you what today is worth. If it misses the target RPE, change the load — that is the system working, not you deviating.',
      'Bad day: do the easiest session you had planned for the week instead. Lifters who chose their session by readiness out-gained a fixed-order group at matched volume.',
      'Exercise selection: far from a meet you can change your main-lift variation cycle to cycle, and accessory variations session to session, as long as the pattern and muscles stay the same. As the meet approaches, converge on the competition lifts. Record your loads so you can pick a rotated exercise back up where you left it.',
    ],
    cite: 'pp. 216-218.',
  },
  {
    id: 'cutting',
    title: 'If you are cutting weight',
    body: [
      'A short or gentle cut needs no changes at all.',
      'For a longer or more aggressive cut — dropping a weight class, say — step down one volume category about a third of the way in. As an intermediate that means training at novice volumes, 10 to 12 sets per muscle group.',
      'Switch from checklist-based deloads to an automatic deload after every cycle, and lean harder on autoregulation, because performance gets more variable when you are in a deficit.',
    ],
    cite: 'p. 219.',
  },
  {
    id: 'testing',
    title: 'Testing your maxes',
    body: [
      'You do not have to test. RPE-based loading already tells you whether you are getting stronger — if the same reps at the same RPE need more weight, you got stronger.',
      'If you do test, every 6 to 12 weeks is plenty. Estimate a 1RM only from a set of about five reps or heavier; estimates from high-rep sets are close to worthless.',
      'On squats and deadlifts and their variants, take AMRAPs and singles to technical failure, never absolute failure. Done past that point they change which muscles are doing the work and add risk for nothing.',
      'You can test to RPE 8 or 9 and assume the last rep or two would have been there.',
    ],
    cite: 'pp. 115-120, 237.',
  },
];
