/* ==========================================================================
   coach.js — the book's decision rules, as functions and reference content.
   Every rule here traces to a page in Helms' Training pyramid; the page is
   cited so you can go read the argument rather than trust the app.
   ========================================================================== */

import { templateOf, graduationCheck, slotHistory, slotE1RM, volumeAudit, loadingWeeks, bestMaxFor,
         MISS_MEMORY_DAYS, isSubmaximalSlot, gradeSets, RELIABLE_E1RM_REPS,
         missedAttempts, peakStatus, PEAK_MIN_DAYS, goalFor, goalTargetFor,
         isCompetitionSlot, peakKeepsFullSets, maxBasisLabel, RECORD_BINDS_DAYS, easyMaxDetail,
         attemptsFor } from './program.js';
import { e1RM, fmtLoad, fmtLoadBare, fmtRPE, rpeFor, convertLoad } from './rpe.js';
import { byId } from './exercises.js';
import { relDays, fmtDate } from './ui.js';
import { todayISO } from './store.js';

/**
 * A max, a rate or a gap between two maxes, as text: to a tenth, never snapped.
 *
 * These are measurements, not loads. `fmtLoadBare` is for weights somebody puts
 * on a bar and prints them to the plate — it showed a schedule's 173.45 as
 * "173.45 kg", a figure that is neither a load nor a sensible way to state an
 * estimate. A load goes through `fmtLoadBare`; everything the lifter cannot
 * load goes through here. Exported so the meet sheet phrases the same numbers
 * the same way as the card in the gym.
 */
export function fmtMax(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  // Half up, with the same epsilon the load notes use: 173.45 is 173.5 on the
  // card in the gym, so it is 173.5 on the meet sheet too.
  return String(Math.round((Number(v) + 1e-9) * 10) / 10);
}

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
   Rhythm — the app knows what day it is, and used to act as if it did not
   ====================================================================== */

/**
 * How today sits against the last session actually logged.
 *
 * The cursor is a position in a program, not a position in a week: it advances
 * when a session is finished and has no opinion about when the next one should
 * happen. That is right for a lifter whose week slips — a cycle finished a few
 * days late is nothing (pp. 37-38) — and wrong in the one direction the book is
 * explicit about, which is training the two heavy competition-lift days back to
 * back. `scheduleNote` on the template says to put a rest day between them, and
 * until now that sentence sat at the bottom of the screen as decoration.
 */
export function trainingRhythm(state, { today = todayISO() } = {}) {
  const done = (state.sessions || []).filter((s) => s.status === 'done');
  if (!done.length) return { sessions: 0, last: null, gap: null };
  const last = done.reduce((a, b) => (b.date > a.date ? b : a), done[0]);
  const gap = Math.max(0, -relDays(last.date));
  const tpl = templateOf(state.program);
  const lastDef = tpl.days.find((d) => d.n === last.day) || null;
  // Named the way the lifter would name it out loud — "Day 3, your strength
  // session" — rather than by the role, which on its own reads as "you trained
  // strength yesterday".
  const lastLabel = last.phase === 'test' ? 'a test day'
    : last.phase === 'meetWeek' ? `meet week, day ${last.day}`
    : lastDef ? `day ${last.day}, your ${lastDef.label.toLowerCase()} session`
    : `day ${last.day}`;
  return {
    sessions: done.length,
    last,
    gap,
    lastRole: last.phase === 'test' ? 'test' : (lastDef?.role || null),
    lastLabel,
    todayIso: today,
  };
}

/** Days whose fatigue is the reason the book asks for a rest day between them. */
const HEAVY_ROLES = new Set(['strength', 'test', 'meet']);

/**
 * Whether today is too soon, and what to do about it.
 *
 * Deliberately advice and never a block. A lifter who has to train Thursday and
 * Friday because that is the week they have is better served by being told what
 * it will cost and which day to take the hit on than by an app that refuses.
 *
 * Returns null when the spacing is fine — including for every gap of two days
 * or more, which is the great majority of them.
 */
export function restAdvice(state, resolved, { today = todayISO() } = {}) {
  const r = trainingRhythm(state, { today });
  if (!r.last || r.gap > 1) return null;

  const todayRole = resolved?.isMeet ? 'meet' : resolved?.isTest ? 'test' : resolved?.dayDef?.role || null;
  const bothHeavy = HEAVY_ROLES.has(r.lastRole) && HEAVY_ROLES.has(todayRole);

  if (r.gap === 0) {
    return {
      level: bothHeavy ? 'bad' : 'warn',
      title: 'You have already trained today',
      text: bothHeavy
        ? `You logged ${r.lastLabel} earlier today, and this is another heavy one. Two of those in a day is one session's worth of stimulus and two sessions' worth of fatigue. Come back tomorrow — the cycle does not care what date it finishes on.`
        : `You logged ${r.lastLabel} earlier today. Doubling up is not forbidden, but the second session is the one that gets worse, so put the work you care about first.`,
      cite: 'Level 1, pp. 37-38.',
    };
  }

  // Yesterday.
  if (resolved?.peakKind === 'meet' || resolved?.peakKind === 'primer') return null;   // meet week is meant to be tight
  if (!bothHeavy) return null;

  return {
    level: 'warn',
    title: 'Two heavy days back to back',
    text: `You trained ${r.lastLabel} yesterday, and this is the other heavy one. They draw on the same recovery — squat and deadlift especially — so expect today to feel a grade harder than the bar says it is. Land the RPE honestly rather than forcing the prescribed load, or move this session to tomorrow.`,
    cite: templateOf(state.program).scheduleNote || 'Level 2, p. 208.',
  };
}

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

  // Opener and primer days are strength-shaped and are not strength days. Telling
  // a lifter to push on the day whose entire purpose is to not push would be the
  // worst-placed sentence in the app.
  const peaking = resolved.isPeak && resolved.peakKind && resolved.peakKind !== 'load';
  if (resolved.dayDef.role === 'strength' && !peaking) {
    notes.push({
      kind: 'strength',
      title: 'Strength day — this is where you push',
      text: 'Pick the load off your first set landing on RPE 8, then hold it. If you blast past RPE 10 by the last set you either started too heavy, under-rested, or something broke down technically.',
    });
  }

  if (resolved.isPeak) notes.push(...peakBriefing(resolved));

  const layoff = layoffAdvice(state);
  if (layoff) notes.push({ kind: 'layoff', title: layoff.headline, text: layoff.advice, cite: layoff.cite });

  const spacing = restAdvice(state, resolved);
  if (spacing) notes.push({ kind: 'rest', title: spacing.title, text: spacing.text, cite: spacing.cite });

  // Not during a peak: its week 1 is the opposite of an ordinary one — the reps
  // came *down* and the bar went up to meet them.
  if (resolved.week === 1 && resolved.cycle > 1 && !resolved.isDeload && !resolved.isPeak) {
    notes.push({
      kind: 'cycle',
      title: `Cycle ${resolved.cycle}, week 1`,
      text: 'Back to the top of the rep ranges, one increment heavier than last cycle\'s week 1. Reps are high and loads feel manageable — resist adding weight because it feels easy, because weeks 2 and 3 are built on this anchor.',
    });
  }

  const rest = tpl.days.find((d) => d.n === resolved.day)?.role === 'strength' ? 150 : 90;
  return { notes, restSeconds: rest };
}

/** What this particular day of the peaking block is for. */
function peakBriefing(resolved) {
  switch (resolved.peakKind) {
    case 'openers':
      return [{
        kind: 'cycle',
        title: 'Dress rehearsal, not a test',
        text: 'One single each, in meet order, at the opener. Do it in the kit you will compete in, with the commands you will hear, at roughly the time of day the meet starts. If the opener does not move like a warm-up, lower it — today is the last day changing it is free, and an opener you miss is a meet you are already losing.',
      }];
    case 'primer':
      return [{
        kind: 'deload',
        title: 'This cannot make you stronger. It can make you worse.',
        text: 'Two easy singles on squat and bench and one on the deadlift, at RPE 4, and then you leave. Nothing here is training — it exists so the platform is not the first bar you have touched in four days. The only way to get this wrong is to do more.',
      }];
    case 'meet':
      return [{
        kind: 'cycle',
        title: 'Nine attempts, three that count',
        text: 'Openers are insurance. Take the second only if the opener moved and the third only if the second did, and change any of them on the spot if the day is not going the way the numbers said. Three for three is a better meet than one for three with a bigger number on the card.',
      }];
    case 'week3':
      return [{
        kind: 'deload',
        title: 'Peak week 3 — everything but the big three comes down',
        text: 'Your variations, accessories and volume-day work deload this week; the strength-day mains and your technique singles do not. That split is the whole idea — shed the fatigue that is not making you better at squat, bench and deadlift, and keep the practice that is.',
      }];
    case 'load':
      return [{
        kind: 'cycle',
        title: 'The block is a taper, not another cycle',
        text: 'Your strength-day mains keep their sets and go up. Everything else runs at two-thirds of the sets it normally would, from today. That is the point of the four weeks: hold the heavy specific work, take the rest away, and arrive on the platform with the fitness you built and none of the fatigue you built it with.',
      }];
    case 'taper':
      return [{
        kind: 'deload',
        title: 'Meet week — the work is done',
        text: 'The competition lifts come down too now. Nothing you do this week can add strength by the weekend, and plenty of it can take some away. Sleep, eat, keep moving, and stay off the bar beyond what is written.',
      }];
    default:
      return [];
  }
}

/* ======================================================================
   A number on one lift, and what it asks of the bar in front of you
   ====================================================================== */

/**
 * Where the goal line is allowed to be drawn.
 *
 * Only inside the peaking block, and only on its loading days — the block is
 * the four weeks where the meet is close enough for the arithmetic to mean
 * anything, and its other days are the taper. Telling a lifter what they
 * "should be hitting" on the primer, on meet week, or on the opener rehearsal
 * would be the worst-placed sentence in the app: those days exist to *not*
 * push, and every one of them is a day where pushing costs the meet.
 */
const GOAL_NOTE_KINDS = new Set(['load', 'week3']);

/**
 * What the bar in front of you has to look like for a stated goal to happen.
 *
 * A lifter mid-block knows the date and knows the number and has no way to tell
 * whether today's triple is on the way to it or quietly off it. The arithmetic
 * that answers that — see `goalPace` — takes five seconds and nobody does it
 * between sets, so the app does it and puts the answer on the card being
 * logged.
 *
 * Three rules constrain what it is allowed to say, and they are the whole
 * design:
 *
 *  1. **Only on the work the block is made of.** `peakKeepsFullSets` is the
 *     same test the volume cut uses, so the note appears exactly where the peak
 *     still wants effort and nowhere else. Technique singles are RPE 5 by
 *     design and a deloaded slot is deloaded on purpose; a goal does not get to
 *     overrule either.
 *  2. **It prices a target, it does not raise the prescription.** The load on
 *     the card is chosen by autoregulation off the lifter's own anchor. This
 *     says what being on schedule would look like next to it, and where the two
 *     disagree it reports the disagreement rather than resolving it.
 *  3. **It says no.** Every note carries the rate the rest of the gap would
 *     have to close at, next to the rate the block actually adds, and when the
 *     first is more than twice the second it says plainly that training does
 *     not get there. A target that is only ever encouraging is not a target, it
 *     is a slogan — and in a taper, chasing one is how the opener goes wrong
 *     too.
 *
 * Returns one note per qualifying slot, keyed by `slotKey` for the session view.
 */
export function goalNotes(resolved, state, { today = todayISO(), loads = null } = {}) {
  const program = state?.program;
  if (!program?.peak || !resolved?.isPeak) return [];
  if (!GOAL_NOTE_KINDS.has(resolved.peakKind)) return [];

  const units = state.profile.units;
  const out = [];

  for (const slot of resolved.slots) {
    const def = slot.slot;
    if (!isCompetitionSlot(def) || def.technique || slot.slotDeload) continue;
    if (!peakKeepsFullSets(def, program)) continue;
    if (!goalFor(state, def.lift)) continue;

    // `loads` is the weight actually on the card now, by slot — the session
    // screen passes it so a lifter who has stepped the top set down to the
    // weight this line asked for is not still told the card is too heavy.
    const card = loads?.[slot.slotKey] > 0 ? { ...slot, plannedLoad: loads[slot.slotKey] } : slot;
    const t = goalTargetFor(state, card, { today });
    if (!t) continue;
    t.cardThird = attemptsFor(state, def.lift)?.third ?? null;
    out.push({ ...t, slotKey: slot.slotKey, ...goalPhrasing(t, units) });
  }
  return out;
}

const TAPER_CITE = 'Level 3, p. 140 — a taper holds intensity and removes volume. Aim at the number on your top set; do not buy it with extra sets.';

/**
 * The finding, in words, for the card it is printed on.
 *
 * Deliberately phrased as the lifter asked the question — "X for this many, if
 * you want Y on this date" — because that is the sentence they would have said
 * to themselves, and a number arrives faster when it is already in the shape
 * you were going to put it in.
 *
 * Four rules about what it may print, each from a note that printed the wrong
 * thing on a real log:
 *
 *  - **Loads to the plate, maxes to a tenth.** The target, the card's weight
 *    and the goal are loads, and go through `fmtLoadBare`. The max behind them,
 *    the line it is measured against, the gap between the two and the weekly
 *    rates are measurements, and go through `fmtMax` — the schedule's 173.45
 *    was being printed as though it were a weight somebody could load.
 *  - **A heavy card outranks the pace.** When the card's own load reads heavy
 *    by the session banner's test (`cardHeavy` — `readsHeavy` against
 *    `heavyCheckMax`, in program.js), that is said first, in the warning tone,
 *    with the weight to take the top set down to. It used to fall through to
 *    the "behind" wording and tell a lifter whose card was the problem that
 *    "your card is already 10 kg past it" and "-2.25 kg over the max behind
 *    it". A goal that is in hand does not change it either: a reached goal over
 *    a heavy card is still a warning, because the extra weight buys nothing the
 *    goal needs and costs fatigue in a taper. What it does *not* do is repeat
 *    the banner. The banner sits directly above this strip and already says
 *    what the weight reads against which max and what to do about it; the
 *    strip's half is the goal's — that the heavier set is not what the goal
 *    needs — and it points at the same weight (`rpeLoad`, which is the banner's
 *    `cardDropLoad`), so the two blocks read as one piece of advice, not two.
 *  - **No rate that is not a rate.** With nothing left to find, "0 kg a week"
 *    is noise; inside the final week the gap is due by meet day, not "a week"
 *    (`goalPace` stops dividing it by a fraction); and a block that claims no
 *    weekly gain is not quoted as adding "0 kg".
 *  - **A standing miss is named.** `goalPace` will not call a goal reached
 *    while a recent miss at or above it stands (`goalMiss`). When that miss is
 *    the only thing between the arithmetic and "reached", the note says so —
 *    otherwise the card reads "ahead of the line" and "not yet" side by side,
 *    and the lifter is left to guess which half is wrong.
 *
 * "Already" is kept for the one note that means it: a goal the max carries,
 * with no miss against it.
 */
function goalPhrasing(t, units) {
  const p = t.pace;
  const lift = t.lift;
  const when = fmtDate(p.meetDate);
  const shape = `${fmtLoadBare(t.load)} ${units} × ${t.sets}×${t.reps}`;
  const basis = maxBasisLabel(p.detail, lift) || `your ${lift} max`;
  /** A load, which has to be loadable. */
  const L = (v) => `${fmtLoadBare(v)} ${units}`;
  /** A max, a rate or a gap between maxes: a measurement, and shown as one. */
  const M = (v) => `${fmtMax(v)} ${units}`;
  const forReps = t.reps === 1 ? 'as a single' : `for ${t.reps}`;
  const hasCard = t.planned > 0;
  const heavy = t.verdict === 'cardHeavy';

  /** The weight the card comes down to, and what it is — the banner's number, in the goal's terms. */
  const dropTo = `${L(t.rpeLoad)} — ${t.reps === 1 ? 'a single' : `${t.reps}`} at RPE ${fmtRPE(t.rpe)} against ${basis}`;

  // A recent miss at or above the goal, which `goalPace` holds against it.
  const miss = p.goalMiss;
  const missed = miss ? `the ${L(miss.load)} you loaded on ${fmtDate(miss.date)} did not move` : null;

  if (p.reached) {
    // "Reached" means the max behind the attempt card carries the goal as a
    // third — not that the lifter has lifted it. A 152.5 goal on a recorded 150
    // is a PR attempt, and calling it "a weight you own" was simply untrue.
    const card = heavy
      ? `, and your card asks ${L(t.planned)}. Nothing about ${L(p.goal)} needs the heavier set: ${L(t.rpeLoad)} `
        + `holds it with room to spare, and in a taper the extra is fatigue you carry onto the platform. `
      : hasCard ? `, and your card says ${L(t.planned)}. ` : '. ';
    return {
      tone: heavy ? 'warn' : 'good',
      title: `${L(p.goal)} is your third attempt on ${when}`,
      text: `On ${basis}, ${L(p.goal)} is your third attempt on ${when}: the max behind it carries it. Today's `
          + `${t.sets}×${t.reps} only has to be ${L(t.load)} to hold it${card}`
          + `The job from here is arriving fresh enough to show it.`,
      cite: TAPER_CITE,
    };
  }

  // The headline is always the number the lifter came for. Whether the goal
  // behind it is realistic is the more important fact, but it does not change
  // between sessions, and a heading that says the same worrying thing twelve
  // times in four weeks stops being read by about the third. So it goes in the
  // body, where it is still said plainly and still said every time.
  // Except on a card that reads heavy: there the banner and this strip both
  // name the weight to come down to, and a headline naming a third weight
  // (the line's) is the one instruction nobody on the screen is giving.
  const title = !heavy ? `${shape} today, for ${L(p.goal)} on ${when}`
    : t.load <= t.rpeLoad ? `${L(t.rpeLoad)} × ${t.sets}×${t.reps} covers ${L(p.goal)} today`
    : `The line asks ${L(t.load)} ${forReps} today, for ${L(p.goal)} on ${when}`;

  const vsCard = !hasCard ? `There is no weight on your card to set it beside`
    : t.delta === 0 ? `That is exactly what is on your card — today the prescription and the pace agree`
    : t.delta < 0 ? `Your card is ${L(-t.delta)} heavier than that`
    : `That is ${L(t.delta)} over the ${L(t.planned)} on your card`;

  let todayLine;
  if (heavy) {
    // The banner above has already said what the card's weight reads and what
    // to do about it. This says what it means for the goal, and names the same
    // weight: where the line sits under it, coming down costs the goal nothing,
    // and saying so is what makes the advice easy to take.
    todayLine = Math.abs(t.load - t.rpeLoad) < 1e-9
      ? `The heavier set on your card is not what ${L(p.goal)} needs: the line asks ${L(t.load)} ${forReps} today, `
        + `which is ${t.reps === 1 ? 'a single' : `${t.reps}`} at RPE ${fmtRPE(t.rpe)} against ${basis}. Taking the top set `
        + `to ${L(t.rpeLoad)} costs the goal nothing.`
      : t.load < t.rpeLoad
      ? `The heavier set on your card is not what ${L(p.goal)} needs: the line only asks ${L(t.load)} ${forReps} `
        + `today, and ${dropTo} — covers that. Taking the top set to ${L(t.rpeLoad)} costs the goal nothing.`
      : `The heavier set on your card does not buy ${L(p.goal)} anything today. The line's ${L(t.load)} ${forReps} `
        + `is about RPE ${fmtRPE(t.impliedRPE)} against ${basis}, and closing that gap is the rest of the block's `
        + `job, not today's top set — ${L(t.rpeLoad)} is the weight that keeps it at RPE ${fmtRPE(t.rpe)}.`;
  } else if (t.verdict === 'ahead') {
    todayLine = `${vsCard}. You are ahead of the line this week needs — ${M(p.have)} against the ${M(p.needNow)} `
      + `the schedule asks for — so take the prescription as written and let the first set decide the rest.`;
  } else if (t.verdict === 'close') {
    // Landing exactly on the card is the good case and reads badly if it is
    // phrased as a target to reach for — there is nothing to reach for.
    todayLine = hasCard && t.delta <= 0
      ? `${vsCard}. Against ${basis}, that is about RPE ${fmtRPE(t.impliedRPE)}. Take it as written and log what `
        + `the first set actually felt like: the line holds for as long as that number is honest.`
      : `${vsCard}, and against ${basis}, it is about RPE ${fmtRPE(t.impliedRPE)} — inside the tolerance this set `
        + `is written with. So it is there: aim at it on your top set, and if the first one lands under `
        + `RPE ${fmtRPE(t.rpe)} you have it.`;
  } else {
    // Behind: `onTrack` is false, so `gap` is the positive distance from the
    // max on file to the one this week's line assumes.
    todayLine = `${vsCard}, and it assumes a max ${M(p.gap)} above the one behind it: against ${basis}, `
      + `${L(t.load)} ${forReps} is about RPE ${fmtRPE(t.impliedRPE)} rather than the ${fmtRPE(t.rpe)} this day is `
      + `written at. Take your top set to the heavy end of the range and log what you actually felt. Putting `
      + `${L(t.load)} on every set instead is how you arrive on ${when} strong and cooked.`;
  }

  // And the part today's bar cannot say on its own: the rate the rest of the
  // gap would have to close at. Always stated, because it is the size of the
  // ask and the lifter is the one deciding whether to accept it — except when
  // there is no gap left, where a rate of nothing is not a size of anything.
  // Gated on the figure as printed: 0.04 kg a week is not a rate, it is "0".
  const rate = +Number(p.requiredPerWeek).toFixed(1) > 0
    ? `${L(p.goal)} needs ${M(p.requiredPerWeek)} ${p.inFinalWeek ? 'more by meet day' : 'a week from here'}`
      + (!(p.perWeek > 0) ? ''
        : p.inFinalWeek ? `, where the block adds about ${M(p.perWeek)} in a whole week`
        : `, against the ${M(p.perWeek)} the block adds`)
    : null;

  let paceLine;
  if (!rate) {
    // Level on paper and still not reached: the only way here is a miss. It
    // lands exactly level more often than not, because the miss itself holds
    // the working max one platform step under it — which is `maxNeeded`.
    const level = Math.abs(p.have - p.maxNeeded) < 0.05
      ? `${M(p.have)} is exactly what a ${L(p.goal)} third needs`
      : `${M(p.have)} is past the ${M(p.maxNeeded)} a ${L(p.goal)} third needs`;
    paceLine = ` On paper the max behind it is enough: ${level}.`
      + (missed ? ` But ${missed}, and until a rep at that weight answers it, ${L(p.goal)} is your third attempt `
        + `on ${when}, not a weight you have.` : '');
  } else if (p.frozen) {
    // The max behind the card is the one the lifter recorded, which a taper
    // does not move — so a weekly rate is the wrong way to state the gap.
    paceLine = ` About the number itself: a ${L(p.goal)} third needs a ${M(p.maxNeeded)} max, and the one you `
      + `recorded is ${M(p.have)} — ${M(p.toGo)} short. Training in a taper does not move a recorded number; a test `
      + `day does, or a new max you record in Settings.`
      + (t.cardThird ? ` The card's third is ${L(t.cardThird)}; ${L(p.goal)} comes into it only if the second moves well on the day.` : '');
    if (missed) paceLine += ` And ${missed}: until a rep at that weight answers it, it counts against the goal.`;
  } else {
    // Chosen from the pace, not the verdict: a card that reads heavy says
    // nothing about whether the number fits, and a 0.7 kg a week gap against a
    // block that adds 1.7 is not "a stretch" because today's set is too heavy.
    paceLine = p.onTrack
      ? ` And the number itself fits: ${rate}.`
      : p.outsized
        ? ` About the number itself: ${rate} — training alone does not get there.`
          + (t.cardThird ? ` The card's third is ${L(t.cardThird)}; ${L(p.goal)} is not this meet's number unless the `
            + `second moves well on ${when} and the board says so.`
            : ` It is not this meet's number unless the second moves well on ${when}.`)
        : ` About the number itself: ${rate}. That is a stretch rather than a wall, and it is the stretch a peak `
          + `exists to cover — the bar on ${when} is lifted by someone who has not trained through fatigue for a week.`;
    if (missed) paceLine += ` And ${missed}: until a rep at that weight answers it, it counts against the goal.`;
  }

  return {
    tone: heavy || p.outsized ? 'warn' : t.verdict === 'ahead' && !miss ? 'good' : 'info',
    title,
    text: todayLine + paceLine,
    cite: TAPER_CITE,
  };
}

/* ======================================================================
   Test readiness — is today the day to find out?
   ====================================================================== */

/** How hard a logged session actually was, on the RPE the lifter reported. */
function sessionEffort(ses) {
  const rpes = [];
  let target = 0, n = 0;
  for (const e of ses.entries || []) {
    if (e.targetRPE != null) { target += e.targetRPE; n++; }
    for (const x of e.sets || []) if (x.done && x.rpe != null) rpes.push(x.rpe);
  }
  return {
    rpe: rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null,
    target: n ? target / n : null,
  };
}

/** A session hard enough that a max two days later would be measuring fatigue. */
const HARD_RPE = 7.5;

/**
 * Whether today is a good day to find out what you can lift.
 *
 * A one-rep max measures two things at once — how strong you are and how tired
 * you are — and only one of them is the thing you wanted to know. Every factor
 * here is about separating them: time since real work, where you sit in the
 * wave, whether recent sessions have been coming in above their target, and
 * whether the last deload actually deloaded anything.
 *
 * It never blocks. A lifter who wants to go and pull something today is allowed
 * to; the job of this is to make sure they know what they are walking into, and
 * to say when the better day would have been.
 */
export function testReadiness(state, { today = todayISO() } = {}) {
  const done = (state.sessions || []).filter((x) => x.status === 'done').sort((a, b) => (a.date < b.date ? -1 : 1));
  const factors = [];
  let score = 100;

  const bad = (label, detail, cost) => { factors.push({ label, detail, verdict: 'bad' }); score -= cost; };
  const ok = (label, detail, cost = 0) => { factors.push({ label, detail, verdict: cost ? 'ok' : 'good' }); score -= cost; };

  if (!done.length) {
    return {
      score: null, level: 'unknown',
      headline: 'Nothing logged yet.',
      factors: [{ label: 'No training history', detail: 'Work up by feel and stop at the first grinder.', verdict: 'ok' }],
      window: null, targets: [],
    };
  }

  /* --- 1. time since real work ------------------------------------- */
  const lastAny = done[done.length - 1].date;
  const sinceAny = daysBetween(lastAny, today);
  const hard = done.filter((x) => {
    const e = sessionEffort(x);
    return (e.rpe ?? e.target ?? 0) >= HARD_RPE;
  });
  const lastHard = hard.length ? hard[hard.length - 1].date : null;
  const sinceHard = lastHard ? daysBetween(lastHard, today) : 99;

  // Graded rather than banded: the whole use of this number is to answer "should
  // I go today or wait", and a score that reads the same on Tuesday and Friday
  // cannot answer it.
  if (sinceHard <= 1) bad('One day off a hard session', 'A single taken now measures yesterday\'s fatigue as much as your strength. Two or three more days changes the number on the bar.', 35);
  else if (sinceHard === 2) ok('Two days off a hard session', 'Workable, but you are still paying for the last session. One more day is worth real weight.', 15);
  else if (sinceHard === 3) ok('Three days off a hard session', 'Enough for a genuine attempt. Another two days would be better.', 8);
  else if (sinceHard <= 5) ok(`${sinceHard} days off a hard session`, 'Well placed for a single.', 3);
  else if (sinceHard <= 21) ok(`${sinceHard} days off a hard session`, 'Fully recovered from your last heavy work.');
  else ok(`${sinceHard} days since anything hard`, 'Rested, but a long way from heavy work — expect the first attempt to feel unfamiliar.', 8);

  if (sinceAny === 0) bad('You already trained today', 'Test on a day of its own.', 25);

  /* --- 2. where you sit in the wave -------------------------------- */
  const cur = state.program?.cursor;
  const weeks = state.program ? loadingWeeks(state.program) : 3;
  const lastPhase = done[done.length - 1].phase;
  if (lastPhase === 'deload' && cur?.week === 1) {
    ok('Post-deload, cycle not started', 'The freshest point the program ever puts you at. This is the window.');
  } else if (cur?.phase === 'deload') {
    ok('Mid-deload', 'Fatigue is on its way down. Good, and better at the end of the week.', 5);
  } else if (cur?.week === 1) {
    ok('Week 1 of the wave', 'Still light on accumulated fatigue.', 5);
  } else if (cur?.week >= weeks) {
    bad(`Week ${cur.week} of ${weeks}`, 'The most fatigued week of the cycle by design. This is the worst week of the wave to test in.', 25);
  } else {
    ok(`Week ${cur?.week} of ${weeks}`, 'Mid-wave. Some fatigue banked.', 12);
  }

  /* --- 3. have recent sessions been coming in hot? ------------------ */
  // Loading weeks only. A deload's own drift is the next factor's job, and
  // counting it here charges the lifter twice for one bad week — while a deload
  // target of RPE 6 is routinely exceeded by half a point without meaning
  // anything at all.
  const recent = done.filter((x) => x.phase === 'load').slice(-3)
    .map(sessionEffort).filter((e) => e.rpe != null && e.target != null);
  if (recent.length) {
    const drift = recent.reduce((a, e) => a + (e.rpe - e.target), 0) / recent.length;
    if (drift >= 0.5) bad('Recent sessions running hot', `Your last ${recent.length} sessions came in about ${drift.toFixed(1)} RPE above target. Prescribed loads feeling heavier than they should is the clearest fatigue signal you have.`, 20);
    // This compares the calls with the *targets*, and a lifter whose calls run
    // light matches the targets perfectly while lifting harder than them — so
    // when the calibration says so, this says so too, rather than two cards on
    // one screen telling him opposite things about the same numbers.
    else {
      const light = rpeCalibration(state).some((c) => c.light && (c.gap >= CALIBRATION_MIN_GAP || c.badCalls >= CALIBRATION_BAD_CALLS));
      if (drift <= -0.5 && !light) ok('Recent sessions running easy', 'Prescribed loads have been feeling lighter than the target. That is what recovered looks like.');
      else if (light) ok('Logged RPE matches the targets', 'Though your calls have been running light against the maxes you recorded (see the Coach card), so this reads the ratings, not the bar.');
      else ok('Recent effort on target', 'Logged RPE is tracking what was prescribed.');
    }
  }

  /* --- 4. did the last deload actually deload? ---------------------- */
  const lastDeload = [...done].reverse().find((x) => x.phase === 'deload');
  if (lastDeload) {
    const week = done.filter((x) => x.phase === 'deload' && daysBetween(x.date, lastDeload.date) <= 10);
    const hotDays = week.filter((x) => {
      const e = sessionEffort(x);
      return e.rpe != null && e.target != null && e.rpe - e.target >= 1.5;
    });
    // A deload week with a training session inside it did not shed the fatigue
    // it was there to shed, whatever the calendar says about it.
    if (hotDays.length) {
      // Fatigue from a bad deload decays like any other fatigue, so the penalty
      // has to decay with it. A hot day six days back is most of the way gone;
      // one from yesterday is not.
      const since = daysBetween(hotDays[hotDays.length - 1].date, today);
      const cost = Math.round(18 * Math.max(0, 1 - since / 10));
      if (cost > 0) {
        bad(`Last deload ran hot on ${hotDays.length} day${hotDays.length === 1 ? '' : 's'}`,
          `${hotDays.map((x) => `Day ${x.day}`).join(', ')} came in well above target ${since} day${since === 1 ? '' : 's'} ago, so that week shed less fatigue than a deload should. Treat yourself as less rested than the calendar says.`, cost);
      } else {
        ok('Last deload ran hot, but a while back', 'Long enough ago that it no longer counts against you.');
      }
    }
  }

  /* --- 5. today's own readiness answers ----------------------------- */
  const todayReadiness = (state.readiness || []).find((r) => r.date === today);
  if (todayReadiness) {
    const vals = READINESS_QUESTIONS.map((q) => Number(todayReadiness[q.key])).filter((v) => v >= 1);
    if (vals.length) {
      const pct = Math.round((vals.reduce((a, b) => a + b, 0) / (vals.length * 5)) * 100);
      if (pct <= 40) bad(`Readiness ${pct}%`, 'You said you feel bad today. Believe yourself.', 30);
      else if (pct <= 60) ok(`Readiness ${pct}%`, 'Middling. Fine to train, marginal for a max.', 10);
      else ok(`Readiness ${pct}%`, 'You feel good.');
    }
  } else {
    ok('Readiness not logged today', 'Answer the five questions on Today and this gets sharper.', 3);
  }

  score = Math.max(0, Math.min(100, score));
  const level = score >= 85 ? 'prime' : score >= 65 ? 'good' : score >= 45 ? 'fair' : 'poor';

  /* --- what is even worth testing ----------------------------------- */
  const targets = milestones(state, { perLift: 2 })
    .flatMap((m) => m.next.filter((n) => n.inRange).map((n) => ({ ...n, lift: m.lift })));

  // The cheapest thing that would move the number.
  let window = null;
  if (sinceHard <= 4) {
    const wait = 5 - sinceHard;
    window = { days: wait, text: `${wait} more rest day${wait === 1 ? '' : 's'} and you would be taking this attempt at your best.` };
  } else if (cur?.week >= weeks) {
    window = { days: null, text: 'After this cycle\'s deload you will be far better placed than you are now.' };
  }

  const headline = level === 'prime' ? 'As ready as you get.'
    : level === 'good' ? 'Good day for it.'
    : level === 'fair' ? 'You can, but you will not see your best.'
    : 'Not today.';

  return { score, level, headline, factors, window, targets, sinceHard, sinceAny };
}

/**
 * Should the home screen be *asking* for a test day?
 *
 * The milestone card is the most actionable thing the app has, which is exactly
 * why it has to be able to shut up. Promoted to the top with a button on it, it
 * reads as an instruction, and an instruction that appears every single time the
 * app is opened stops being read at all — and worse, an app that asks for a max
 * every few days is asking for something no program wants. A tested single is a
 * rare event: it costs a training day, it is only honest when the lifter is
 * fresh, and when a meet is on the calendar it is the meet's job entirely.
 *
 * So the information stays visible always and the *ask* is rationed. Returns
 * `{ promote, reason, detail }`; `reason` is why it is staying quiet.
 */
export const TEST_PROMPT_QUIET_DAYS = 21;

export function testPromotion(state, { today = todayISO() } = {}) {
  const rows = milestones(state, { perLift: 2, today });
  const ready = rows.flatMap((r) => r.next.filter((n) => n.inRange).map((n) => ({ ...n, lift: r.lift })));
  const quiet = (reason, detail) => ({ promote: false, reason, detail, ready, rows });

  if (!ready.length) {
    const missed = rows.flatMap((r) => r.next.filter((n) => n.missed).map((n) => ({ ...n, lift: r.lift })));
    if (missed.length) {
      const m = missed[0];
      return quiet('missed', `You went for ${m.label} ${m.missed.daysAgo} day${m.missed.daysAgo === 1 ? '' : 's'} ago and did not get it. It stays on the board — the app just is not going to keep asking until either three weeks have passed or your estimate clears it outright.`);
    }
    return quiet('nothingInRange', null);
  }

  // A meet outranks everything. The block ends on a platform with three judges
  // on it; nobody needs a test day nine days beforehand as well.
  const peak = peakStatus(state, { today });
  if (peak && (peak.kind === 'running' || peak.kind === 'nextWeek' || peak.kind === 'waiting')) {
    return quiet('meet', peak.kind === 'running'
      ? 'You are inside your peaking block. The meet is the test — everything in range gets answered on the platform.'
      : `Your meet is ${peak.out} days out and the peaking block will take over. Save the attempt for the platform.`);
  }

  const snoozed = state.settings?.testPromptSnoozedUntil;
  if (snoozed && snoozed > today) return quiet('snoozed', null);

  // Something already answered the question recently.
  const lastTest = (state.sessions || [])
    .filter((x) => x.status === 'done' && (x.phase === 'test' || x.phase === 'meetWeek'))
    .map((x) => x.date).sort().pop();
  if (lastTest && daysBetween(lastTest, today) < TEST_PROMPT_QUIET_DAYS) {
    const ago = daysBetween(lastTest, today);
    return quiet('recentlyTested', `You tested ${ago} day${ago === 1 ? '' : 's'} ago. Estimates move faster than maxes do; give it a few weeks of training before you go again.`);
  }

  // The app's own readiness score already says whether today is the day. Asking
  // for a max on a day it scores as "not today" is the app arguing with itself.
  const readiness = testReadiness(state, { today });
  if (readiness.score != null && readiness.score < 65) {
    return quiet('notReady', `${readiness.headline} ${readiness.window?.text || ''}`.trim());
  }

  return { promote: true, reason: null, detail: null, ready, rows, readiness };
}

/* ======================================================================
   Test blocks — three lifts, spaced so each one gets a fair attempt
   ====================================================================== */

/** Systemic cost. Squat and deadlift compete for the same recovery; bench does not. */
const HEAVY_SYSTEMIC = new Set(['squat', 'deadlift']);

/**
 * Lay three test days out over a calendar.
 *
 * Two rules, both from what the lift costs rather than from a schedule template:
 * squat and deadlift draw on the same recovery, so they never sit adjacent;
 * bench barely does, so it can go anywhere. And the lift the lifter most wants
 * goes first, while they are freshest — testing your priority lift last, after
 * two limit singles, is how you find out what you can do while tired.
 */
export function planTestBlock(state, { lifts = ['squat', 'bench', 'deadlift'], start = todayISO() } = {}) {
  const ms = milestones(state, { perLift: 1 });
  const gapOf = (lift) => {
    const m = ms.find((x) => x.lift === lift);
    const next = m?.next?.[0];
    return next ? next.away : Infinity;
  };
  // The freshest day goes to the attempt that most needs it: one that is
  // marginal (the target sits at or above the current estimate, so a few kilos
  // of fatigue decide it) and systemically expensive. A squat 16 kg inside the
  // estimate is a formality and can wait; bench is cheap to recover from and
  // suffers least from going last.
  const order = [...lifts].sort((a, b) => {
    const ha = HEAVY_SYSTEMIC.has(a) ? 1 : 0, hb = HEAVY_SYSTEMIC.has(b) ? 1 : 0;
    if (ha !== hb) return hb - ha;
    return gapOf(b) - gapOf(a);        // more marginal first
  });

  const addDays = (iso, n) => {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };

  const placed = [];
  let offset = 0;
  for (const lift of order) {
    if (placed.length) {
      const lastHeavy = [...placed].reverse().find((p) => HEAVY_SYSTEMIC.has(p.lift));
      const need = HEAVY_SYSTEMIC.has(lift) && lastHeavy ? 2 : 1;   // rest days between
      const from = HEAVY_SYSTEMIC.has(lift) && lastHeavy ? lastHeavy.offset : placed[placed.length - 1].offset;
      offset = Math.max(offset + 1, from + need + 1);
    }
    const m = ms.find((x) => x.lift === lift);
    placed.push({
      lift, offset, date: addDays(start, offset),
      attempts: null,
      target: m?.next?.[0] || null,
    });
  }

  // Fill the gaps so the plan reads as days rather than as a list of lifts.
  const span = placed[placed.length - 1].offset;
  const days = [];
  for (let i = 0; i <= span; i++) {
    const hit = placed.find((p) => p.offset === i);
    days.push(hit ? { ...hit, kind: 'test' } : { kind: 'rest', offset: i, date: addDays(start, i) });
  }
  return { days, order, span };
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

/**
 * How long a missed attempt keeps a milestone off the "go and get it" list.
 *
 * The same window the working max uses to hold a recently-failed weight over the
 * estimate, and deliberately the same number: a miss either still counts as
 * evidence or it does not, and the chart and the prescription must not disagree
 * about which. It is a suppression, not a verdict — the milestone still shows,
 * with the date on it.
 */
export { MISS_MEMORY_DAYS } from './program.js';

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
export function milestones(state, { perLift = 3, today = todayISO() } = {}) {
  const profile = state.profile;
  const units = profile.units;
  const plates = plateTargets(profile);
  const step = units === 'kg' ? 2.5 : 5;
  const out = [];

  for (const lift of ['squat', 'bench', 'deadlift']) {
    const est = bestMaxFor(state, lift) || 0;
    const misses = missedAttempts(state, { lift }).filter((m) => daysBetween(m.date, today) <= MISS_MEMORY_DAYS);

    // The heaviest single this lifter has genuinely completed on this lift, and
    // — separately — the heaviest bar they have completed a rep with at all,
    // with the date on it. The second is what answers a missed attempt: a set of
    // three at the weight you once failed for a single is proof you have moved
    // past it in a way an estimate is not.
    let lifted = 0;
    let bestCompleted = [];
    const tpl = templateOf(state.program);
    const keys = [`test_${lift}`];
    for (const d of tpl.days) for (const sl of d.slots) if (sl.lift === lift) keys.push(sl.key);
    for (const key of keys) {
      for (const h of slotHistory(state, key)) {
        for (const set of h.sets) {
          if (set.reps === 1 && set.load > lifted) lifted = set.load;
          if (set.reps >= 1) bestCompleted.push({ load: set.load, date: h.date });
        }
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

      // Something you loaded and did not lift is not "in range", however
      // flattering the estimate is about it. The memory expires, and it expires
      // early if the estimate has since climbed clear of the weight — that is
      // the difference between a bad day and a wall.
      // Deliberately not "the estimate has since climbed past it". The estimate
      // that put a weight in range is the same estimate that was wrong about it
      // — a 185 kg e1RM taken off a set of five is exactly what made 180 look
      // available on the day it was missed, and letting that same number
      // overrule the miss puts the app straight back to suggesting it. Only a
      // completed rep at the weight, logged after the miss, counts.
      // The comparison runs downward, not upward. A failed 180 says nothing at
      // all about 100 — but it says a great deal about 180 and about 200. So the
      // miss that binds a target is the *heaviest* one at or below it; matching
      // the other way round had one missed deadlift mark every milestone the
      // lifter owned as unavailable.
      const hit = misses
        .filter((m) => m.load <= t.load + 1e-9)
        .reduce((a, b) => (a == null || b.load > a.load ? b : a), null);
      const outgrown = hit && bestCompleted.some((c) => c.load >= hit.load - 1e-9 && c.date > hit.date);
      const missed = hit && !outgrown
        ? { date: hit.date, load: hit.load, daysAgo: daysBetween(hit.date, today) }
        : null;

      rows.push({
        lift,
        load: t.load,
        label: t.kind === 'plates'
          ? `${t.plates} plate${t.plates === 1 ? '' : 's'} · ${t.load} ${units}`
          : `${t.load} ${units}`,
        kind: t.kind,
        done,
        missed,
        // Within one small jump of the current estimate: go and try it.
        inRange: !done && !missed && est > 0 && away <= step,
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
      const raw = (e.sets || []).filter((x) => x.done && x.load > 0 && x.reps > 0);
      if (!raw.length) continue;
      // Read through the same grading the engine uses, or the chart and the
      // prescription disagree about what a session was worth — and the chart is
      // the one the lifter looks at when deciding whether to believe the app.
      const sets = gradeSets(raw, e);
      // Only sets of about 5 reps or fewer give a trustworthy 1RM estimate.
      const usable = sets.filter((x) => x.reps <= 6);
      const pool = usable.length ? usable : sets;
      const best = Math.max(...pool.map((x) => e1RM(convertLoad(x.load, from, to), x.reps, x.effRPE) || 0));
      if (best > 0) points.push({ date: s.date, value: +best.toFixed(1), cycle: s.cycle, week: s.week, day: s.day,
                                  deload: s.phase === 'deload', submax: isSubmaximalSlot(state, e.slotKey),
                                  estimatedFromHighReps: !usable.length });
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
  // Technique and primer work is excluded for the deload's reason, in the other
  // direction. Prescribed at RPE 5, its estimate is the RPE guess divided by
  // 0.786, so a call half a point light lands 1.6% high and a call three points
  // light lands 13% high — which is how a day written to be easy produced a
  // squat "PR" of 165.4 against a tested 150 and a deadlift best above a weight
  // that had been loaded and missed the week before.
  //
  // All of them stay in the chart, where the dip is honest and the caveat
  // beneath explains the loose points. If filtering leaves too little, take what
  // there is.
  const trusted = points.filter((p) => !p.estimatedFromHighReps && !p.deload && !p.submax);
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

/* ======================================================================
   RPE calibration — does what you call an 8 weigh what an 8 weighs?
   ====================================================================== */

/** At least this many rated sets before the app is willing to claim a pattern. */
const CALIBRATION_MIN_SETS = 4;
/** An average gap this big, in RPE points, is a habit worth naming. */
const CALIBRATION_MIN_GAP = 1;
/** A single call this far out is a mistake rather than a habit... */
const CALIBRATION_BAD_CALL = 2;
/** ...and this many mistakes is also worth naming, however good the average looks. */
const CALIBRATION_BAD_CALLS = 2;
/** How far back to look. Long enough to cover a cycle, short enough to be current. */
const CALIBRATION_DAYS = 35;

/**
 * How this lifter's RPE calls compare with what the bar actually weighs.
 *
 * The whole program is autoregulated off RPE, which means every load in it rests
 * on the lifter's own judgement of how close a set was to failure. That
 * judgement is a skill, it is learned, and it is systematically wrong in one
 * direction for most people before it is right — which the app can measure,
 * because it also holds a weight that lifter demonstrably could and could not
 * do on a given day.
 *
 * So: for every rated set on a competition lift, what RPE does the lifter's
 * recorded max say that weight and that rep count *was*, and what did they call
 * it? The gap is `calls light` when they rate sets easier than the bar says
 * they were.
 *
 * The max it reads against is the one in `state.maxes` — the lifter's own
 * number, from a test day, onboarding or Settings, whatever its `source` and
 * whether or not it carries a date — and never the working max. The working
 * max is inferred from these same RPE calls, so measuring the calls against it
 * is circular: a lifter who calls every set two points light raises the
 * estimate until the sets read as called, and the gap comes out zero however
 * far off the calls are. The recorded max does not absorb the calls it is
 * judging — it moves only when somebody records a new one — which is the only
 * property the comparison needs.
 *
 * This used to require `source === 'tested'`, on the theory that anything else
 * was the same kind of guess. In practice it meant the finding never reached
 * the lifter it was built for: the Update maxes sheet saved every lift as
 * `estimated` (a 150 squat tested the same week included), so the gate was
 * shut on a log whose technique triples were called RPE 5 and were RPE 8. And
 * it computed against the working max while printing the tested one, so the
 * sentence named one number and the arithmetic used another. It is now one
 * number throughout, and it is the same one easy days and meet attempts are
 * built from (`easyMaxDetail`) whenever it is the lower of the two — so "RPE 8
 * against your 150" here is the same 150 the technique day is a percentage of.
 *
 * Only sets inside `RELIABLE_E1RM_REPS` are read this way, for the reason that
 * constant exists: the table stops describing individuals past about six reps,
 * where rep endurance varies far more between lifters than strength does. A set
 * of nine the lifter settled on by feel reads as RPE 4 against a max derived
 * from their triples, and folding that into the average hides the calls this is
 * looking for.
 *
 * Returns, per lift and biggest gap first:
 *   { lift, sets, gap, worst, badCalls, contradictions, light, max, recordedDate, source }
 * where `max` is the recorded figure every `was` in it was computed against.
 */
export function rpeCalibration(state, { today = todayISO(), lifts = ['squat', 'bench', 'deadlift'] } = {}) {
  const tpl = templateOf(state.program);
  const out = [];

  for (const lift of lifts) {
    const rec = state.maxes?.[lift];
    const max = Number(rec?.value) > 0 ? Number(rec.value) : null;
    if (!max) continue;

    const keys = tpl.days.flatMap((d) => d.slots).filter((x) => x.lift === lift).map((x) => x.key);
    const gaps = [];
    const contradictions = [];
    let badCalls = 0;
    let worst = null;

    for (const key of keys) {
      // Work prescribed to be easy is not excluded here, and should not be:
      // a technique triple called RPE 5 that was really an 8 is the single most
      // legible case of the thing this function is looking for.
      const submax = isSubmaximalSlot(state, key);
      for (const h of slotHistory(state, key)) {
        if (h.phase === 'deload' || h.phase === 'meetWeek') continue;
        if (daysBetween(h.date, today) > CALIBRATION_DAYS) continue;
        // A record is evidence about a call only near the day it was recorded
        // — the same `RECORD_BINDS_DAYS` window in which it holds the easy max
        // down. Rated against a max months old, an honest lifter who has simply
        // got stronger reads as calling everything light; an undated record
        // has no "near" at all, so it rates nothing.
        const rated = !!rec.date && Math.abs(daysBetween(h.date, rec.date)) <= RECORD_BINDS_DAYS;
        for (const set of rated ? h.sets : []) {
          if (set.rpe == null) continue;               // never guess at an unrated set
          if (set.reps > RELIABLE_E1RM_REPS) continue; // and never argue off a set of nine
          const was = rpeFor(max, set.load, set.reps);
          if (was == null) continue;
          const gap = was - set.rpe;
          gaps.push(gap);
          if (gap >= CALIBRATION_BAD_CALL) badCalls++;
          if (!worst || gap > worst.gap) {
            worst = { gap, date: h.date, load: set.load, reps: set.reps, called: set.rpe, was, slotKey: key, submax };
          }
        }

        // The other kind of evidence, and the more certain one: two sets at the
        // same bar in the same session, rated differently. No max is needed to
        // know one of those calls is wrong — fatigue only goes one way, so a
        // later set at the same weight cannot have been the easier of the two.
        // `gradeSets` already refuses to estimate off the flattering reading;
        // this is what says so to the lifter.
        for (let i = 1; i < h.sets.length; i++) {
          for (let j = 0; j < i; j++) {
            const a = h.sets[j], b = h.sets[i];
            if (a.rpe == null || b.rpe == null) continue;
            if (b.load < a.load - 1e-9 || b.rpe >= a.rpe) continue;
            contradictions.push({ date: h.date, load: b.load, reps: b.reps, first: a.rpe, then: b.rpe, slotKey: key });
          }
        }
      }
    }

    if (gaps.length < CALIBRATION_MIN_SETS) continue;
    const gap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    out.push({ lift, sets: gaps.length, gap: +gap.toFixed(2), worst, badCalls, contradictions,
               light: gap > 0, max, recordedDate: rec.date || null, source: rec.source || null });
  }

  return out.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
}

/** "yesterday" / "9 days ago" / the date, for quoting one set back at the lifter. */
function whenAgo(iso) {
  const d = -relDays(iso);
  if (d == null || Number.isNaN(d)) return iso;
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return d <= 60 ? `${d} days ago` : `on ${iso}`;
}

/** The calibration finding, phrased for the home screen — or null if there is nothing to say. */
function calibrationInsight(state) {
  // Either a standing habit, or a handful of calls that were simply wrong. The
  // second matters on its own: an average hides it, and "sometimes" is exactly
  // how a lifter describes it.
  const worthSaying = rpeCalibration(state)
    .filter((c) => c.gap >= CALIBRATION_MIN_GAP || c.badCalls >= CALIBRATION_BAD_CALLS || c.contradictions.length);
  if (!worthSaying.length) return null;
  const units = state.profile.units;
  // A load read back out of the log may have been logged in the other unit and
  // converted; printed as a load it would come out as "330.69 lb". On the grid
  // it is a load, and off it it is a measurement, and each is printed as one.
  const asLoad = (v) => (Math.abs(v * 2 - Math.round(v * 2)) < 1e-6 ? fmtLoadBare(v) : fmtMax(v));

  const habit = worthSaying.filter((x) => x.gap >= CALIBRATION_MIN_GAP);
  const clash = worthSaying.flatMap((x) => x.contradictions);
  // The clearest call is the worst one on any lift, not the worst on whichever
  // lift has the largest average — a squat triple called 5 that was an 8 is
  // clearer than a deadlift one that was a 7.5.
  const worstOf = worthSaying.filter((x) => x.worst).sort((a, b) => b.worst.gap - a.worst.gap)[0] || null;
  const w = worstOf?.worst || null;

  const parts = [];
  if (habit.length) {
    parts.push(`Against the maxes you recorded, the sets you have rated lately were harder than you called them — `
             + `${habit.map((x) => `${x.lift} by ${x.gap.toFixed(1)}`).join(', ')} on average.`);
  }
  const badCall = w && w.gap >= CALIBRATION_BAD_CALL;
  if (badCall) {
    // The number printed is the number `was` was computed from — see
    // `rpeCalibration` for what happened when those were two different maxes.
    parts.push(`The clearest call: ${asLoad(w.load)} ${units} × ${w.reps} on your ${worstOf.lift} ${whenAgo(w.date)}, `
             + `logged RPE ${fmtRPE(w.called)}, which is RPE ${fmtRPE(w.was)} against the ${worstOf.lift} max you `
             + `recorded, ${fmtMax(worstOf.max)} ${units}.`);
  }
  if (clash.length) {
    const k = clash[0];
    parts.push(`${parts.length ? 'And ' : ''}${clash.length === 1 ? 'Once' : `${clash.length} times`} you rated the same `
             + `bar twice in one session and called the second one easier — ${asLoad(k.load)} ${units} × ${k.reps} `
             + `${whenAgo(k.date)}, RPE ${fmtRPE(k.first)} and then RPE ${fmtRPE(k.then)}. Fatigue only runs one way, so `
             + `the app reads the harder of the two.`);
    if (parts.length > 1) parts[parts.length - 1] = parts[parts.length - 1].replace(/^And Once/, 'And once');
  }
  // What a light call costs, stated as narrowly as it is true. Easy days and
  // attempts come off `easyMaxDetail`. Where that is the recorded max, a light
  // call costs nothing there; where the app's working max is the lower figure
  // (a record above it, or one older than RECORD_BINDS_DAYS), the calls do
  // reach them — but never past the lifter's own recent number. Heavy days and
  // the progression read the calls either way.
  const recordedEverywhere = worthSaying.every((x) => easyMaxDetail(state, x.lift)?.basis === 'recorded');
  const cost = recordedEverywhere
    ? `your easy days and meet attempts are built from the max you recorded, not from these ratings, so a light call `
      + `costs you no weight on the bar there.`
    : `your easy days and meet attempts are built from the lower of the max you recorded and the app's working max, `
      + `so a light call can never push them past your own recent number.`;
  // And RPE 5 is defined here the way the picker defines it — exactly five
  // reps left, RPE = 10 − RIR — with the book's technique band beside it.
  parts.push(`Nothing is broken and nothing needs undoing: ${cost} They are still worth getting right, because heavy `
           + `days read them, and so does the app when it decides you are ready for more. RPE 5 means five more good `
           + `reps were there — technique work sits four to six shy of failure (p. 242) — so if five more were not `
           + `there, it was not a 5.`);

  const title = habit.length || badCall ? 'Your RPE calls are running light' : 'Some of your calls contradict each other';
  return { kind: 'rpeCalibration', priority: 2, title, text: parts.join(' ') };
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

  const calibration = calibrationInsight(state);
  if (calibration) out.push(calibration);

  const peak = peakStatus(state);
  if (peak) out.push(...meetInsights(state, peak));

  return out.sort((a, b) => a.priority - b.priority);
}

const PEAK_WEEKS_LABEL = 4;

/**
 * What the peaking block has to say for itself, by where it is.
 *
 * The app switches into and out of the peak on its own, so these are status
 * rather than instructions — with two exceptions, and both are cases where the
 * app cannot know something and has to ask: a meet that is too close to peak
 * for, and a meet date that has come and gone without a platform session logged.
 */
function meetInsights(state, peak) {
  const out = [];
  const days = peak.out;

  if (peak.kind === 'running') {
    const wk = peak.week;
    const text = wk === 1 ? 'Peak week 1 of 4. Your strength-day mains are triples now instead of sets of five — the load goes up to meet the reps coming down. Everything else drops to two-thirds of its sets: this is a taper, and volume is the thing that comes off.'
      : wk === 2 ? 'Peak week 2 of 4. Doubles on the strength days, and the rest of the work stays thinned. This is the last genuinely hard week; after it everything goes down and stays down.'
      : wk === 3 ? 'Peak week 3 of 4. Everything the block is not made of deloads this week, and the last day is replaced by one opener single on each lift in meet order. Treat that day as a dress rehearsal — same kit, same order, same timing.'
      : 'Meet week. The competition lifts come down too. The second-to-last day is your primer, 24 to 48 hours out; the last one is the meet.';
    out.push({ kind: 'meet', priority: 1, title: days >= 0 ? `${days} days out · peak week ${wk} of ${PEAK_WEEKS_LABEL}` : `Peak week ${wk}`, text, action: 'meet' });

    // The meet date has passed and no platform session was logged. The block
    // cannot end itself on a date — only on a session — so this is the way out.
    if (days < 0) {
      out.push({
        kind: 'meetStale', priority: 0,
        title: 'Your meet date has passed',
        text: 'Nothing was logged for meet day, so the peaking block is still running and still tapering you. If you competed, log the attempts; if you did not, close the block and a normal cycle starts — back at the top of your rep ranges, at the loads an ordinary cycle would have reached.',
        action: 'closePeak',
      });
    }
    return out;
  }

  if (peak.kind === 'pending') {
    out.push({
      kind: 'meet', priority: 0,
      title: `${days} days out — start the peaking block?`,
      text: 'Four weeks of work with a date on the end of it: triples, then doubles, then openers, then the platform. Everything that is not a competition lift thins out and then stops. Say yes and it starts now; say not yet and you carry on as you are and get asked again at the end of next week.',
      action: 'peakPrompt',
    });
    return out;
  }

  if (peak.kind === 'declined') {
    out.push({
      kind: 'meet', priority: 1,
      title: `${days} days to your meet`,
      text: `You have put the peaking block off ${peak.declined === 1 ? 'once' : `${peak.declined} times`}. That is a decision, not a mistake — but the block needs ${PEAK_MIN_DAYS} days to fit, so there are about ${Math.max(0, days - PEAK_MIN_DAYS)} left to change your mind. You will be asked again at the end of this training week, or you can start it now.`,
      action: 'startPeak',
    });
    return out;
  }

  if (peak.kind === 'nextWeek') {
    out.push({
      kind: 'meet', priority: 1,
      title: `${days} days to your meet`,
      text: 'Inside four weeks. At the end of this training week the app will offer you the peaking block — you do not have to switch anything now, and you should not try to bring it forward by going heavy in the meantime. Finish the week as written.',
      action: 'meet',
    });
  } else if (peak.kind === 'waiting' && days <= 42) {
    out.push({
      kind: 'meet', priority: 2,
      title: `${days} days to your meet`,
      text: `Normal training until four weeks out, then the peaking block starts on its own at the next week boundary — about ${peak.startsIn} day${peak.startsIn === 1 ? '' : 's'} from now. Nothing to do but train.`,
      action: 'meet',
    });
  } else if (peak.kind === 'tooLate') {
    out.push({
      kind: 'meet', priority: 1,
      title: `${days} days to your meet`,
      text: `That is inside the ${PEAK_MIN_DAYS} days a peaking block needs, so the app is not going to start one — a truncated peak tapers you for a meet you never trained heavy for, which is worse than no peak at all. Train normally, then take the last four or five days easy and open conservatively.`,
      action: 'meet',
    });
  }
  return out;
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
