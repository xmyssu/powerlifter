/* ==========================================================================
   ask.js — the conversational coach: the brief, its tools, and the loop
   --------------------------------------------------------------------------
   Claude writes the words; this file is where every number it is allowed to
   say comes from. The model never does arithmetic on a load. It asks a tool,
   and each tool is a thin wrapper over the same engine call the rest of the
   app already makes — `load_for_rpe` is the Library calculator, line for line,
   so the coach and the calculator cannot hand back two different weights.

   The tools run here, on the phone, against the state the lifter logged into.
   Only the conversation goes out, through the lifter's own Apps Script, which
   holds the API key (see server/appsscript/Code.gs › ask_). So there is no
   second copy of the training log to drift out of date, and nothing secret in
   a public repository.

   Nothing in here touches the DOM, so it runs under node for the tests.
   ========================================================================== */

import { todayISO } from './store.js';
import { pctOf1RM, loadFor, rpeFor, e1RM, roundToLoadable, loadStep, plateBreakdown, normalizeRPE,
         repsLeftWords, RPE_MIN, RPE_MAX } from './rpe.js';
import { workingMaxDetail, easyMaxDetail, attemptsFor, missedAttempts, goalFor, goalPace, peakStatus,
         daysUntil, loadOptsFor, competitionChoice, resolveDay, templateOf, liftSlotKeys,
         RELIABLE_E1RM_REPS } from './program.js';
import { strengthTrend, trendSummary, rpeCalibration, REFERENCE, PLATEAU_TREE, FAULTS, PAIN_PROTOCOL,
         STICKING_POINT_PREAMBLE } from './coach.js';
import { SLOT_DEFAULTS, byId } from './exercises.js';

export const LIFTS = ['squat', 'bench', 'deadlift'];

/** Round-trips through the API cap: one question may take this many tool rounds before the coach must answer. */
export const MAX_ROUNDS = 8;

/* ---- the brief --------------------------------------------------------- */

/**
 * The system prompt. It must not change between requests — not even a date —
 * because it is the front of the cached prefix; today's date travels with each
 * question instead (`contextLine`).
 */
export const SYSTEM = `You are the coach inside a powerlifting app that one lifter, Daniel, uses on his phone, usually between sets. The app runs a program built on Eric Helms' "The Muscle & Strength Pyramid: Training" (2nd ed.), and its rules carry that book's page numbers.

Everything you know about Daniel's training comes from the tools. Call them; do not assume. If a tool returns nothing for what you need, say so and ask him — never fill a gap in his history with a plausible guess.

Numbers are the part he acts on, so they have rules:
- Every load, max, percentage and RPE you state must come from a tool result in this conversation or from his own message. Do not do arithmetic on loads yourself; if you need a weight, call load_for_rpe, rate_set or meet_attempts.
- Tool loads are already rounded to what he can actually put on that bar or machine. Repeat them exactly. Never adjust one by hand, and never give a load he cannot build (no 158.8 on a 2.5 kg grid).
- Say what kind of number each one is: one he logged, a max he recorded, the app's estimate (inferred from RPE, not lifted), or a calculated prescription. Give loads as a percentage of the max they were built from too — he reasons in "% of my 150".
- Estimates are not maxes. A recorded tested max and, above all, a missed attempt outrank any estimate: a bar he loaded and did not lift is the strongest evidence in the app.

About Daniel specifically:
- He rates sets easier than they were, and has asked the app not to trust him on it. On technique and easy days his calls have run two to three points light; on near-maximal deadlifts about one. Never draw a conclusion from logged RPE alone — check it against his recorded maxes, his misses and rpe_calibration.
- His meet is in the overview. In a peaking block, the program is a taper: volume comes down, intensity holds. Do not suggest adding volume close to a meet.
- When he says "this feels wrong" about a number, treat it as a possible finding, not a misunderstanding. He has been right before.

Evidence:
- search_book searches the full text of the books in his library (the Pyramid book, and any he adds), and returns passages with the page number printed in the book. Use it for what a book actually says, and cite the book and page, e.g. (Pyramid, p. 121). Quote at most a sentence; summarise the rest in your own words.
- search_library searches the app's own short summaries of the Pyramid book's rules, each with its page. It is quicker and always available; use it first for the app's rules, and search_book when he wants detail or the reasoning behind a rule.
- If neither has it, say it is general coaching knowledge rather than something from his sources. Never invent a study, an author, a quote or a page number. If search_book says the library is unavailable, say you could only check the app's summaries.
- Distinguish what is well established, what is a coaching heuristic, and what is your guess. Where reasonable sources disagree, say so instead of picking one silently.
- A pattern in his own log is a correlation over a few weeks of one person. Say how much data it rests on and do not present it as a cause.

Notes: the notes at the top of a question are standing preferences, goals and decisions he has kept for you. Follow them, and if one conflicts with what a tool shows, point out the conflict. Use remember only when he asks you to remember something, or states a preference or agrees a decision meant to hold beyond today — and say in your answer what you saved. Never save numbers the tools compute (maxes, loads, estimates); those must come fresh from the tools each time.

Pain: anything sharp, worsening or lasting — he should stop that movement and see a physio or sports doctor who works with lifters. Do not diagnose.

Style: he is reading this on a phone with a bar loaded. Lead with the answer in a line or two, then the short reasons. Plain sentences; bold only the number to load. No headings, no tables.`;

/**
 * The line that goes in front of each question: the date (which the cached
 * system prompt cannot carry) and whether he is mid-session.
 */
export function contextLine(state, { today = todayISO() } = {}) {
  const active = (state.sessions || []).find((s) => s.id === state.activeSessionId && s.status === 'active');
  const line = `[Today is ${today}. Units: ${state.profile?.units || 'kg'}. ${active ? 'He is in a session right now.' : 'No session in progress.'}]`;
  const notes = (state.coachNotes || []).filter((n) => n?.text);
  if (!notes.length) return line;
  return `${line}\n[His notes for the coach:\n${notes.map((n) => `- ${n.text} (${n.by === 'coach' ? 'saved by you' : 'written by him'}, ${n.date})`).join('\n')}]`;
}

/** Notes are short standing instructions, not a second training log. */
export const MAX_NOTES = 30;
export const MAX_NOTE_CHARS = 300;

/* ---- tool definitions -------------------------------------------------- */

const LIFT = { type: 'string', enum: LIFTS, description: 'Competition lift.' };

export const TOOLS = [
  {
    name: 'get_overview',
    description: 'His recorded maxes, the app\'s working and easy maxes with what each rests on, meet date and goals, peaking status, units and plates. Call this first for almost any question about loads, maxes, progress or the meet.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_today',
    description: 'The session in progress (prescriptions and every set logged so far), or if none, the next planned day with its prescribed loads. Call this for anything about today, the next set, or whether to change the session.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_sessions',
    description: 'Finished sessions, newest first, with every set (load, reps, RPE, missed) and his notes. Use for history and progress questions. Filter by lift to keep it short.',
    input_schema: {
      type: 'object',
      properties: {
        lift: { ...LIFT, description: 'Only sessions with work on this lift (main and variations).' },
        since: { type: 'string', description: 'ISO date, inclusive.' },
        until: { type: 'string', description: 'ISO date, inclusive.' },
        limit: { type: 'integer', minimum: 1, maximum: 30, description: 'Default 10.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'load_for_rpe',
    description: 'The weight to load for a number of reps at a target RPE, from the app\'s RPE table, rounded to what he can actually load. Same calculation as the app\'s calculator. Uses the max the app builds easy days from unless you pass one.',
    input_schema: {
      type: 'object',
      properties: {
        lift: LIFT,
        reps: { type: 'integer', minimum: 1, maximum: 12 },
        rpe: { type: 'number', minimum: RPE_MIN, maximum: RPE_MAX },
        max: { type: 'number', description: 'Only if he gave a different max to work from.' },
        basis: { type: 'string', enum: ['easy', 'working'], description: '"easy" (default): the lower of his recorded max and the working max — what easy and technique days use. "working": what heavy days progress from.' },
      },
      required: ['lift', 'reps', 'rpe'],
      additionalProperties: false,
    },
  },
  {
    name: 'rate_set',
    description: 'What a set was against his max: the RPE the table gives a weight × reps, and the percentage of max. If he logged an RPE for it, also the e1RM that call implies — an estimate.',
    input_schema: {
      type: 'object',
      properties: {
        lift: LIFT,
        load: { type: 'number', minimum: 0 },
        reps: { type: 'integer', minimum: 1, maximum: 12 },
        logged_rpe: { type: 'number', minimum: RPE_MIN, maximum: RPE_MAX },
        max: { type: 'number', description: 'Only if he gave a different max.' },
      },
      required: ['lift', 'load', 'reps'],
      additionalProperties: false,
    },
  },
  {
    name: 'meet_attempts',
    description: 'Opener, second and third for a lift, rounded to the platform\'s 2.5 kg steps, with the app\'s reasoning.',
    input_schema: { type: 'object', properties: { lift: LIFT }, required: ['lift'], additionalProperties: false },
  },
  {
    name: 'missed_attempts',
    description: 'Every weight he loaded and did not lift, newest first.',
    input_schema: {
      type: 'object',
      properties: { lift: LIFT, since: { type: 'string', description: 'ISO date.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'strength_trend',
    description: 'Estimated-1RM points per session for a lift and the app\'s trend summary. These are estimates from logged RPE, so read them with rpe_calibration.',
    input_schema: { type: 'object', properties: { lift: LIFT }, required: ['lift'], additionalProperties: false },
  },
  {
    name: 'rpe_calibration',
    description: 'Where his logged RPE calls disagree with his recorded maxes, and by how much. Call before trusting any RPE-based conclusion.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_book',
    description: 'Search the full text of the books in his library (the Pyramid book, plus any he has added). Returns the best passages with book, chapter and printed page number. Needs signal; slower than search_library.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 2, description: 'Keywords, e.g. "taper volume before a meet".' },
        limit: { type: 'integer', minimum: 1, maximum: 8, description: 'Default 5.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'remember',
    description: 'Save a short standing note — a preference, goal, constraint or agreed decision — that every later conversation will see. Only when he asks you to remember something or clearly states something lasting. Not for numbers the tools compute.',
    input_schema: {
      type: 'object',
      properties: { note: { type: 'string', minLength: 3, maxLength: MAX_NOTE_CHARS, description: 'One sentence, in the third person, e.g. "Prefers paused bench on technique days."' } },
      required: ['note'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_library',
    description: 'Search the app\'s training library — the Pyramid book\'s principles, plateau checklist, technique faults and fixes, and pain protocol — each passage with its page citation.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 2 } },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

/* ---- tool implementations ---------------------------------------------- */

/** Round for the wire: the model reads 157.5, not 157.49999999. */
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : v ?? null);

/** Make an engine result safe and short enough to hand to the model. */
export function slim(v, depth = 0) {
  if (v == null) return v ?? null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'function') return undefined;
  if (depth > 5) return undefined;
  if (Array.isArray(v)) return v.slice(0, 40).map((x) => slim(x, depth + 1)).filter((x) => x !== undefined);
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    const s = slim(x, depth + 1);
    if (s !== undefined) out[k] = s;
  }
  return out;
}

function maxSummary(d) {
  if (!d) return null;
  return {
    value: r1(d.value),
    basis: d.basis ?? null,
    estimate: r1(d.estimate?.value ?? d.estimate),
    working: r1(d.working),
    cappedBy: d.cappedBy ?? null,
  };
}

/** The bar, plates or stack a lift's competition exercise is loaded on. */
function gridFor(state, lift) {
  return loadOptsFor(state, competitionChoice(state, lift) || SLOT_DEFAULTS[lift] || null);
}

function needLift(lift) {
  if (!LIFTS.includes(lift)) throw new Error(`lift must be one of ${LIFTS.join(', ')}.`);
}

/** The max a calculation works from, and which one it was. */
function maxToUse(state, lift, { max, basis = 'easy', today }) {
  if (Number(max) > 0) return { value: Number(max), source: 'given by the lifter' };
  const d = basis === 'working' ? workingMaxDetail(state, lift, { today }) : easyMaxDetail(state, lift, { today });
  if (!(d?.value > 0)) throw new Error(`No ${lift} max on file. Ask him for one.`);
  const source = basis === 'working' ? `working max (${d.basis})`
    : d.basis === 'recorded' ? 'his recorded max (lower than the working max, and recent enough to bind)'
    : `working max (${d.basis}) — the lower of it and his recorded max`;
  return { value: d.value, source };
}

function entryLift(state, entry) {
  const tpl = templateOf(state.program);
  for (const d of tpl.days) for (const s of d.slots) if (s.key === entry.slotKey) return s.lift || null;
  if (entry.slotKey?.startsWith('test_')) return entry.slotKey.slice(5);
  // A session logged on an earlier program still trained the lift it trained.
  return LIFTS.find((lift) => liftSlotKeys(lift).includes(entry.slotKey)) || null;
}

function sessionOut(state, ses) {
  return {
    date: ses.date,
    status: ses.status,
    phase: ses.phase,
    cycle: ses.cycle, week: ses.week, day: ses.day,
    units: ses.units || state.profile.units,
    sessionRPE: ses.sessionRPE ?? null,
    notes: ses.notes || null,
    corrected: ses.corrections?.length ? ses.corrections.length : 0,
    entries: (ses.entries || []).map((e) => ({
      exercise: byId(e.exerciseId)?.name || e.exerciseId,
      lift: entryLift(state, e),
      target: `${e.targetSets}×${e.targetReps}${e.targetRPE != null ? ` @ RPE ${e.targetRPE}` : ''}`,
      prescribedLoad: r1(e.plannedLoad ?? e.prescribedLoad),
      note: e.note || null,
      sets: (e.sets || []).filter((s) => s.done).map((s) => (s.failed
        ? { load: r1(s.load), missed: true }
        : { load: r1(s.load), reps: s.reps, rpe: s.rpe ?? null })),
    })),
  };
}

const IMPL = {
  get_overview(state, _in, { today }) {
    const p = state.profile || {};
    const program = state.program || {};
    const lifts = {};
    for (const lift of LIFTS) {
      const rec = state.maxes?.[lift];
      const pace = goalPace(state, lift, { today });
      lifts[lift] = {
        recorded: rec?.value > 0 ? { value: r1(Number(rec.value)), date: rec.date || null, source: rec.source || null } : null,
        workingMax: maxSummary(workingMaxDetail(state, lift, { today })),
        easyMax: maxSummary(easyMaxDetail(state, lift, { today })),
        goal: goalFor(state, lift) ?? null,
        goalPace: pace ? slim(pace) : null,
      };
    }
    return {
      today,
      units: p.units,
      bar: p.barWeight,
      plates: p.plates,
      microplates: !!p.microplates,
      bodyweight: p.bodyweight ?? null,
      program: templateOf(program)?.name || null,
      cursor: program.cursor || null,
      meetDate: program.meetDate || null,
      daysToMeet: program.meetDate ? daysUntil(program.meetDate, today) : null,
      peak: slim(peakStatus(state, { today })),
      lifts,
      note: 'workingMax is what heavy days progress from; easyMax is what easy days, technique work and attempts are built from. "recorded" with source "estimated" was typed in, not lifted.',
    };
  },

  get_today(state, _in, { today }) {
    const active = (state.sessions || []).find((s) => s.id === state.activeSessionId && s.status === 'active');
    if (active) return { inProgress: true, ...sessionOut(state, active) };
    if (!state.program) return { inProgress: false, planned: null };
    const day = resolveDay(state, {});
    return {
      inProgress: false,
      date: today,
      planned: {
        label: day.label,
        phase: day.phase,
        slots: (day.slots || []).map((s) => ({
          exercise: s.exercise?.name || s.exerciseId,
          lift: s.slot?.lift || null,
          sets: s.sets, reps: s.reps,
          targetRPE: s.targetRPE ?? null,
          rpeRange: s.rpeRange ?? null,
          load: r1(s.plannedLoad),
          loadRange: s.loadRange ? { low: r1(s.loadRange.low), high: r1(s.loadRange.high) } : null,
          pctOfMax: r1(s.pct),
          deload: !!s.slotDeload,
          // Accessories and variations have no prescribed load: the lifter
          // picks it from what they did last time, which is this.
          ...(s.plannedLoad == null && s.lastTime ? { noSetWeight: true, lastTime: {
            date: s.lastTime.date,
            sets: s.lastTime.sets.map((x) => `${r1(x.load)}x${x.reps}${x.rpe != null ? `@${x.rpe}` : ''}`),
          } } : {}),
        })),
      },
    };
  },

  get_sessions(state, input) {
    const limit = Math.min(30, Math.max(1, Number(input.limit) || 10));
    if (input.lift) needLift(input.lift);
    const out = [];
    // Two sessions can share a date; the one finished later is the newer.
    const at = (s) => `${s.date}|${s.endedAt || s.startedAt || ''}`;
    const done = (state.sessions || []).filter((s) => s.status === 'done')
      .map((s, i) => ({ s, i, k: at(s) }))
      .sort((a, b) => (a.k < b.k ? 1 : a.k > b.k ? -1 : b.i - a.i))
      .map((x) => x.s);
    for (const ses of done) {
      if (input.since && ses.date < input.since) continue;
      if (input.until && ses.date > input.until) continue;
      const s = sessionOut(state, ses);
      if (input.lift) {
        s.entries = s.entries.filter((e) => e.lift === input.lift
          || (e.exercise || '').toLowerCase().includes(input.lift === 'bench' ? 'bench' : input.lift));
        if (!s.entries.length) continue;
      }
      out.push(s);
      if (out.length >= limit) break;
    }
    return { count: out.length, sessions: out };
  },

  load_for_rpe(state, input, { today }) {
    needLift(input.lift);
    const reps = Number(input.reps);
    if (!Number.isInteger(reps) || reps < 1 || reps > 12) throw new Error('reps must be a whole number from 1 to 12.');
    const typed = Number(input.rpe);
    if (!(typed >= RPE_MIN && typed <= RPE_MAX)) throw new Error(`rpe must be from ${RPE_MIN} to ${RPE_MAX}.`);
    const rpe = normalizeRPE(typed);
    const max = maxToUse(state, input.lift, { max: input.max, basis: input.basis, today });
    const grid = gridFor(state, input.lift);
    // The Library calculator's loadResult, as data.
    const pct = pctOf1RM(reps, rpe);
    const exact = loadFor(max.value, reps, rpe);
    const load = roundToLoadable(exact, grid);
    const after = rpeFor(max.value, load, reps);
    let lighter = null;
    if (after != null && after > rpe) {
      const l = roundToLoadable(load - loadStep(grid), grid);
      if (l < load) lighter = l;
    }
    const plates = plateBreakdown(load, grid);
    return {
      kind: 'calculated prescription',
      lift: input.lift,
      reps, rpe,
      load,
      units: state.profile.units,
      pctOfMax: r1(pct),
      maxUsed: r1(max.value),
      maxSource: max.source,
      unroundedLoad: r1(exact),
      rpeAfterRounding: after != null && after !== rpe ? after : null,
      lighterOption: lighter,
      repsLeft: repsLeftWords(rpe),
      platesPerSide: plates?.ok ? plates.perSide.map((x) => `${x.count}×${x.plate}`).join(' + ') || 'empty bar' : null,
    };
  },

  rate_set(state, input, { today }) {
    needLift(input.lift);
    const load = Number(input.load);
    const reps = Number(input.reps);
    if (!(load > 0) || !Number.isInteger(reps) || reps < 1 || reps > 12) throw new Error('Need a positive load and whole reps from 1 to 12.');
    const max = maxToUse(state, input.lift, { max: input.max, today });
    const used = (load / max.value) * 100;
    const overMax = used > pctOf1RM(reps, RPE_MAX) + 1e-9;
    const tooLight = used < pctOf1RM(reps, RPE_MIN) - 1e-9;
    const rpe = overMax ? null : rpeFor(max.value, load, reps);
    const out = {
      kind: 'calculated rating',
      set: `${r1(load)} × ${reps}`,
      maxUsed: r1(max.value),
      maxSource: max.source,
      pctOfMax: r1(used),
      tableRPE: overMax ? null : tooLight ? `${RPE_MIN} or lighter` : rpe,
      repsLeft: overMax || tooLight ? null : repsLeftWords(rpe),
      overMax,
      overMaxMeaning: overMax ? 'More than this max allows for these reps: if he did it, the max is out of date.' : null,
      highRepCaveat: reps > RELIABLE_E1RM_REPS ? `Above ${RELIABLE_E1RM_REPS} reps the table is a loose guide.` : null,
    };
    if (input.logged_rpe != null) {
      const logged = normalizeRPE(Number(input.logged_rpe));
      out.loggedRPE = logged;
      out.e1rmFromLoggedRPE = { kind: 'estimate', value: r1(e1RM(load, reps, logged)) };
      if (!overMax && !tooLight && rpe != null) out.callVsTable = r1(logged - rpe);
    }
    return out;
  },

  meet_attempts(state, input) {
    needLift(input.lift);
    const a = attemptsFor(state, input.lift, { platform: true });
    if (!a) throw new Error(`No ${input.lift} max to build attempts from.`);
    return { kind: 'calculated attempts', lift: input.lift, ...slim(a) };
  },

  missed_attempts(state, input) {
    if (input.lift) needLift(input.lift);
    const list = missedAttempts(state, { lift: input.lift || null, since: input.since || null });
    return {
      count: list.length,
      misses: list.slice(0, 20).map((m) => ({ date: m.date, lift: m.lift, exercise: byId(m.exerciseId)?.name || m.exerciseId,
        load: r1(m.load), targetReps: m.targetReps ?? null, phase: m.phase })),
    };
  },

  strength_trend(state, input) {
    needLift(input.lift);
    const points = strengthTrend(state, input.lift);
    return {
      kind: 'estimates from logged RPE',
      lift: input.lift,
      points: points.slice(-20).map((p) => ({ date: p.date, e1rm: p.value, deload: p.deload, submax: p.submax,
        fromHighReps: p.estimatedFromHighReps })),
      summary: slim(trendSummary(points)),
    };
  },

  rpe_calibration(state, _in, { today }) {
    return { results: slim(rpeCalibration(state, { today })) };
  },

  async search_book(_state, input, { searchBook }) {
    const query = String(input.query || '').trim();
    if (query.length < 2) throw new Error('query is too short.');
    if (!searchBook) throw new Error('The book library is unavailable here; only search_library can be used.');
    const res = await searchBook(query, { limit: Math.min(8, Math.max(1, Number(input.limit) || 5)) });
    if (!res?.configured) {
      return { count: 0, passages: [], note: 'No books are in his library yet (Drive folder "Powerlifter library"). Use search_library.' };
    }
    return {
      count: (res.passages || []).length,
      passages: (res.passages || []).map((p) => ({ book: p.source, edition: p.edition || null, page: p.page, chapter: p.chapter, text: p.text })),
    };
  },

  remember(state, input, { remember, today }) {
    const text = String(input.note || '').replace(/\s+/g, ' ').trim();
    if (text.length < 3) throw new Error('note is empty.');
    if (text.length > MAX_NOTE_CHARS) throw new Error(`note is longer than ${MAX_NOTE_CHARS} characters; shorten it.`);
    if (!remember) throw new Error('Notes cannot be saved from here.');
    const notes = state.coachNotes || [];
    if (notes.length >= MAX_NOTES) throw new Error(`He already has ${MAX_NOTES} notes; ask him to delete one in the Ask tab's Notes first.`);
    if (notes.some((n) => String(n?.text ?? '').toLowerCase() === text.toLowerCase())) return { saved: false, reason: 'Already in his notes.' };
    remember({ text, date: today, by: 'coach' });
    return { saved: true, note: text };
  },

  search_library(_state, input) {
    const hits = searchLibrary(String(input.query || ''));
    return { count: hits.length, passages: hits, source: 'App library: summaries of Helms, The Muscle & Strength Pyramid: Training, 2nd ed.' };
  },
};

/**
 * Run one tool call. Inputs come from the model, so they are checked here
 * rather than trusted; a bad one comes back as an error the model can read.
 */
export function runTool(state, name, input, { today = todayISO(), searchBook = null, remember = null } = {}) {
  if (!TOOL_NAMES.has(name)) throw new Error(`Unknown tool: ${name}`);
  if (input != null && typeof input !== 'object') throw new Error('Tool input must be an object.');
  return IMPL[name](state, input || {}, { today, searchBook, remember });
}

/* ---- library search ---------------------------------------------------- */

const STOP = new Set(('a an the and or of to in on for with is are was be it my i me you your do does how what why when '
  + 'should can could would at by as this that from not if than then so about into over').split(' '));

const words = (s) => String(s).toLowerCase().normalize('NFKD').match(/[a-z0-9]+/g)?.filter((w) => !STOP.has(w)) || [];

/** Crude stemming, enough that "stalled" finds "stall" and "plateaus" finds "plateau". */
const stem = (w) => w.replace(/(ing|ed|es|s)$/, '') || w;

let corpus = null;
function buildCorpus() {
  const docs = [];
  for (const r of REFERENCE) docs.push({ title: r.title, text: r.body.join(' '), cite: r.cite });
  for (const q of PLATEAU_TREE) docs.push({ title: 'Plateau checklist', text: `${q.q} ${q.ifNo}`, cite: q.cite });
  for (const f of FAULTS) {
    docs.push({ title: `${f.lift} fault: ${f.fault}`, text: `Cause: ${f.cause} Fix: ${f.fix}`, cite: f.page ? `p. ${f.page}` : null });
  }
  docs.push({ title: STICKING_POINT_PREAMBLE.title, text: STICKING_POINT_PREAMBLE.points.join(' '), cite: STICKING_POINT_PREAMBLE.cite || null });
  docs.push({
    title: PAIN_PROTOCOL.title,
    text: [PAIN_PROTOCOL.intro, ...PAIN_PROTOCOL.chain.map((c) => `${c.step} ${c.detail}`), PAIN_PROTOCOL.jointOnly,
      PAIN_PROTOCOL.escalate].filter(Boolean).join(' '),
    cite: PAIN_PROTOCOL.cite,
  });
  for (const d of docs) d.terms = words(`${d.title} ${d.title} ${d.text}`).map(stem);
  const df = new Map();
  for (const d of docs) for (const t of new Set(d.terms)) df.set(t, (df.get(t) || 0) + 1);
  return { docs, df, n: docs.length };
}

/** Best passages for a query, by summed tf-idf over the query's terms. */
export function searchLibrary(query, { limit = 4 } = {}) {
  corpus ||= buildCorpus();
  const q = [...new Set(words(query).map(stem))];
  if (!q.length) return [];
  const scored = corpus.docs.map((d) => {
    let score = 0;
    for (const t of q) {
      const tf = d.terms.filter((x) => x === t).length;
      if (tf) score += (1 + Math.log(tf)) * Math.log(1 + corpus.n / corpus.df.get(t));
    }
    return { d, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ d }) => ({ title: d.title, text: d.text, cite: d.cite }));
}

/* ---- the loop ---------------------------------------------------------- */

/**
 * Ask one question.
 *
 * `history` is the conversation so far, exactly as the API returned it —
 * thinking blocks and all, because the model's earlier reasoning is only
 * valid if it comes back unedited. `send(request)` posts {system, tools,
 * messages} and resolves to the API message ({content, stop_reason, ...}).
 *
 * `searchBook(query, {limit})` reaches the book library and `remember(note)`
 * saves a coach note; without them those two tools report themselves
 * unavailable to the model.
 *
 * Resolves to { ok, messages, text, tools, saved, unchecked } — or { ok: false,
 * error } with the history untouched, so a failed question can simply be asked
 * again. `saved` is the notes the coach kept while answering.
 */
export async function ask({ state, history = [], question, send, today = todayISO(), onStep = () => {},
  searchBook = null, remember = null }) {
  const messages = [...history, { role: 'user', content: [{ type: 'text', text: `${contextLine(state, { today })}\n\n${question}` }] }];
  const used = [];
  const saved = [];
  // Notes saved mid-answer count against the limit and the duplicate check.
  const live = { ...state, coachNotes: [...(state.coachNotes || [])] };
  const keep = remember && ((note) => { live.coachNotes.push(note); saved.push(note.text); remember(note); });
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let msg;
    try {
      msg = await send({ system: SYSTEM, tools: TOOLS, messages });
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
    if (msg.stop_reason === 'refusal') {
      return { ok: false, error: 'The model declined to answer that one. Try rephrasing it.' };
    }
    messages.push({ role: 'assistant', content: msg.content });
    const calls = (msg.content || []).filter((b) => b.type === 'tool_use');

    if (msg.stop_reason !== 'tool_use' || !calls.length) {
      const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n\n').trim();
      if (!text) return { ok: false, error: 'The coach came back with nothing to say. Try again.' };
      return {
        ok: true,
        messages,
        text,
        tools: used,
        saved,
        truncated: msg.stop_reason === 'max_tokens',
        unchecked: uncheckedLoads(text, messages),
      };
    }

    // Every call in a turn is answered in one user message, errors included.
    // Run in order, not in parallel: two remember calls must see each other.
    const results = [];
    for (const c of calls) {
      used.push(c.name);
      try {
        const out = await runTool(live, c.name, c.input, { today, searchBook, remember: keep });
        results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out) });
      } catch (err) {
        results.push({ type: 'tool_result', tool_use_id: c.id, is_error: true, content: String(err.message || err) });
      }
    }
    onStep(calls.map((c) => c.name));
    messages.push({ role: 'user', content: results });
  }
  return { ok: false, error: 'That took too many steps. Try a narrower question.' };
}

/* ---- the number check -------------------------------------------------- */

/** Every number in a value: JSON numbers, and digits inside strings ("155 / 157.5"). */
function numbersIn(v, out) {
  if (v == null) return out;
  if (typeof v === 'number') { if (Number.isFinite(v)) out.add(Math.round(v * 10) / 10); return out; }
  if (typeof v === 'string') {
    for (const m of v.matchAll(/\d+(?:[.,]\d+)?/g)) out.add(Math.round(Number(m[0].replace(',', '.')) * 10) / 10);
    return out;
  }
  if (Array.isArray(v)) { for (const x of v) numbersIn(x, out); return out; }
  if (typeof v === 'object') for (const x of Object.values(v)) numbersIn(x, out);
  return out;
}

/** Weights below this are increments and plate sizes, not loads; not worth flagging. */
const CHECK_FROM = 20;

/**
 * Weights the coach stated that no tool returned and he did not type.
 *
 * The prompt already tells the model to take every load from a tool; this is
 * the check that it did. A flagged number is shown to him as unchecked rather
 * than hidden — it may be fine (a difference, a figure from the book), but he
 * should not load it on the coach's word alone.
 */
export function uncheckedLoads(text, messages) {
  const known = new Set();
  for (const m of messages) {
    if (m.role !== 'user') continue;
    for (const b of m.content || []) {
      if (b.type === 'text') numbersIn(b.text, known);
      if (b.type === 'tool_result' && !b.is_error) {
        let v = b.content;
        try { v = JSON.parse(b.content); } catch (e) { /* plain text result */ }
        numbersIn(v, known);
      }
    }
  }
  const out = [];
  for (const m of String(text).matchAll(/(\d+(?:[.,]\d+)?)\s?(kg|kgs|kilos?|lb|lbs)\b/gi)) {
    const n = Math.round(Number(m[1].replace(',', '.')) * 10) / 10;
    if (n >= CHECK_FROM && !known.has(n) && !out.includes(m[0])) out.push(m[0]);
  }
  return out;
}
