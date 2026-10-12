/* ==========================================================================
   ask.test.mjs — the coach's tools, its number check, and its loop
   Run: node js/ask.test.mjs
   No framework, no network: the model is a scripted fake. What is under test
   is everything on this side of the API — that every weight the coach can be
   handed is the calculator's, on the grid, and that the conversation goes back
   to the API exactly as it came.
   ========================================================================== */

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

import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const store = await import('./store.js');
const { buildProgram, startSession, completeSession, easyMaxDetail, loadOptsFor, competitionChoice } = await import('./program.js');
const { loadFor, roundToLoadable, rpeFor } = await import('./rpe.js');
const { INTERMEDIATE_PL } = await import('./templates.js');
const { SLOT_DEFAULTS } = await import('./exercises.js');
const { TOOLS, SYSTEM, runTool, ask, uncheckedLoads, searchLibrary, contextLine, MAX_ROUNDS, MAX_NOTES } = await import('./ask.js');

let pass = 0, fail = 0;
const problems = [];
function ok(cond, label, extra) {
  if (cond) pass++;
  else { fail++; problems.push(label + (extra ? `  [${extra}]` : '')); }
}
function eq(a, b, label) { ok(a === b, label, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function throws(fn, re, label) {
  try { fn(); ok(false, label, 'did not throw'); } catch (e) { ok(re.test(e.message), label, e.message); }
}
const hr = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);

const TODAY = '2026-10-12';

/* ---- a lifter shaped like the real one -------------------------------- */
store.resetAll();
store.update((s) => {
  s.profile.units = 'kg';
  s.profile.barWeight = 20;
  s.profile.plates = [25, 20, 15, 10, 5, 2.5, 1.25];
  s.maxes.squat = { value: 150, date: '2026-10-01', source: 'tested', reps: 1 };
  s.maxes.bench = { value: 95, date: '2026-10-01', source: 'tested', reps: 1 };
  s.maxes.deadlift = { value: 170, date: '2026-10-01', source: 'tested', reps: 1 };
  s.program = buildProgram({ templateId: INTERMEDIATE_PL.id, startDate: '2026-08-03' });
  s.program.meetDate = '2026-10-16';
  s.onboarded = true;
});

/** Log one session as prescribed, with a missed 180 deadlift tacked on if asked. */
function train({ missDeadlift = false } = {}) {
  const s0 = store.getState();
  const ses = startSession(s0, { ...s0.program.cursor });
  for (const e of ses.entries) {
    e.sets = e.sets.map(() => ({ load: e.plannedLoad ?? 60, reps: e.targetReps, rpe: e.targetRPE ?? 8, done: true, ts: 'x' }));
  }
  if (missDeadlift) {
    const dl = ses.entries.find((e) => e.exerciseId === 'deadlift') || ses.entries[0];
    dl.sets.push({ load: 180, reps: 0, rpe: null, done: true, failed: true, ts: 'x' });
  }
  ses.date = TODAY;
  store.update((s) => { s.sessions.push(ses); s.activeSessionId = ses.id; });
  store.update((s) => { completeSession(s, ses.id); s.activeSessionId = null; });
  return ses;
}
for (let i = 0; i < 3; i++) train();
const missed = train({ missDeadlift: true });
const st = store.getState();

/* ======================================================================
   1. Tool definitions
   ====================================================================== */
hr('1. Tool definitions');
eq(new Set(TOOLS.map((t) => t.name)).size, TOOLS.length, 'tool names are unique');
for (const t of TOOLS) {
  ok(t.description.length > 30, `${t.name} says when to call it`);
  eq(t.input_schema.type, 'object', `${t.name} takes an object`);
  eq(t.input_schema.additionalProperties, false, `${t.name} rejects unknown fields`);
}
throws(() => runTool(st, 'make_up_a_number', {}), /Unknown tool/, 'an unknown tool is refused, not guessed at');
ok(!/\d{4}-\d{2}-\d{2}/.test(SYSTEM), 'the system prompt carries no date, so it caches');
ok(contextLine(st, { today: TODAY }).includes(TODAY), 'the date travels with the question instead');

/* ======================================================================
   2. load_for_rpe is the Library calculator
   ====================================================================== */
hr('2. load_for_rpe is the calculator, on the grid');
{
  // The case that started this: "I squat 150, what's RPE 5 for 3×2" — 122.5, not 130.
  const r = runTool(st, 'load_for_rpe', { lift: 'squat', reps: 2, rpe: 5, max: 150 }, { today: TODAY });
  eq(r.load, 122.5, '2 reps @ RPE 5 off a 150 squat is 122.5');
  eq(r.maxUsed, 150, 'and it says which max it used');
  eq(r.kind, 'calculated prescription', 'and what kind of number it is');

  const grid = loadOptsFor(st, competitionChoice(st, 'deadlift') || SLOT_DEFAULTS.deadlift);
  const easy = easyMaxDetail(st, 'deadlift', { today: TODAY }).value;
  let same = true, onGrid = true;
  for (let reps = 1; reps <= 12; reps++) {
    for (let rpe = 4; rpe <= 10; rpe += 0.5) {
      const out = runTool(st, 'load_for_rpe', { lift: 'deadlift', reps, rpe }, { today: TODAY });
      if (out.load !== roundToLoadable(loadFor(easy, reps, rpe), grid)) same = false;
      if (Math.abs(out.load / 2.5 - Math.round(out.load / 2.5)) > 1e-9) onGrid = false;
    }
  }
  ok(same, 'every reps × RPE gives exactly the calculator\'s weight off the easy max');
  ok(onGrid, 'and every one of them sits on the 2.5 kg grid');

  throws(() => runTool(st, 'load_for_rpe', { lift: 'squat', reps: 0, rpe: 8 }), /reps/, 'zero reps is refused');
  throws(() => runTool(st, 'load_for_rpe', { lift: 'squat', reps: 3, rpe: 11 }), /rpe/, 'RPE 11 is refused, not clamped');
  throws(() => runTool(st, 'load_for_rpe', { lift: 'curl', reps: 3, rpe: 8 }), /lift/, 'a lift the app has no max for is refused');
}

/* ======================================================================
   3. rate_set
   ====================================================================== */
hr('3. rate_set');
{
  const r = runTool(st, 'rate_set', { lift: 'squat', load: 130, reps: 3, max: 150, logged_rpe: 5 });
  eq(r.tableRPE, rpeFor(150, 130, 3), '130 × 3 against 150 reads the table\'s RPE');
  ok(r.callVsTable < 0, 'and a call of 5 on it shows up as light');
  eq(r.e1rmFromLoggedRPE.kind, 'estimate', 'the e1RM from his call is labelled an estimate');
  const over = runTool(st, 'rate_set', { lift: 'squat', load: 160, reps: 3, max: 150 });
  ok(over.overMax && over.tableRPE === null, 'a set past the max is called out, not read as RPE 10');
}

/* ======================================================================
   4. History tools tell the truth about misses
   ====================================================================== */
hr('4. History');
{
  const m = runTool(st, 'missed_attempts', {});
  ok(m.misses.some((x) => x.load === 180), 'the missed 180 is in missed_attempts');
  const s = runTool(st, 'get_sessions', { limit: 1 });
  eq(s.sessions[0].date, missed.date, 'newest session first');
  ok(s.sessions[0].entries.some((e) => e.sets.some((x) => x.missed && x.load === 180)), 'and the miss shows as missed, not as a 0-rep set');
  ok(s.sessions.every((x) => x.entries.every((e) => e.sets.every((y) => !y.missed || y.reps === undefined))), 'a miss carries no reps to misread');

  const o = runTool(st, 'get_overview', {}, { today: TODAY });
  eq(o.daysToMeet, 4, 'overview counts down to the meet');
  eq(o.lifts.deadlift.recorded.value, 170, 'and carries the recorded max with its source');
  const t = runTool(st, 'get_today', {}, { today: TODAY });
  ok(t.planned && t.planned.slots.length > 0, 'get_today returns the next planned day when no session is open');
  ok(runTool(st, 'strength_trend', { lift: 'squat' }).kind.includes('estimate'), 'the trend is labelled as estimates');
  ok(Array.isArray(runTool(st, 'rpe_calibration', {}).results), 'rpe_calibration runs');
  ok(runTool(st, 'meet_attempts', { lift: 'deadlift' }).kind === 'calculated attempts', 'meet_attempts runs');
}

/* ======================================================================
   5. Library search
   ====================================================================== */
hr('5. Library search');
{
  const p = searchLibrary('my bench has stalled, plateau');
  ok(p.length > 0 && p.every((x) => x.cite), 'a plateau question finds passages, each with a citation');
  ok(searchLibrary('my knee hurts, pain').some((x) => /hurt/i.test(x.title)), 'a pain question finds the pain protocol');
  eq(searchLibrary('the and of').length, 0, 'stopwords alone find nothing rather than everything');
}

/* ======================================================================
   6. The number check
   ====================================================================== */
hr('6. Weights no tool gave');
{
  const msgs = [
    { role: 'user', content: [{ type: 'text', text: 'I squat 150, what for 2 @ 5?' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'load_for_rpe', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify({ load: 122.5, platesPerSide: '1×25 + 1×20 + 1×5 + 1×1.25' }) }] },
  ];
  eq(uncheckedLoads('Load **122.5 kg**.', msgs).length, 0, 'a weight the calculator returned passes');
  eq(uncheckedLoads('Your 150 kg max.', msgs).length, 0, 'a weight he typed passes');
  eq(uncheckedLoads('Try 158.8 kg.', msgs)[0], '158.8 kg', 'an invented weight is flagged');
  eq(uncheckedLoads('Add 5 kg next week.', msgs).length, 0, 'an increment is not a load and is not flagged');
  eq(uncheckedLoads('Pull 182,5 kg.', msgs)[0], '182,5 kg', 'a comma decimal is read, not skipped');
}

/* ======================================================================
   7. The loop, against a scripted model
   ====================================================================== */
hr('7. The loop');

function fakeModel(script) {
  const seen = [];
  const send = async (req) => {
    seen.push(JSON.parse(JSON.stringify(req)));
    const next = script.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { send, seen };
}

{
  const thinking = { type: 'thinking', thinking: '', signature: 'sig-1' };
  const { send, seen } = fakeModel([
    { stop_reason: 'tool_use', content: [thinking,
      { type: 'tool_use', id: 'a', name: 'load_for_rpe', input: { lift: 'squat', reps: 2, rpe: 5, max: 150 } },
      { type: 'tool_use', id: 'b', name: 'load_for_rpe', input: { lift: 'squat', reps: 0, rpe: 5 } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Load **122.5 kg** — 81.7% of your 150.' }] },
  ]);
  const steps = [];
  const res = await ask({ state: st, history: [], question: 'What for 3×2 @ RPE 5?', send, today: TODAY, onStep: (n) => steps.push(n) });
  ok(res.ok, 'a two-round question resolves');
  eq(res.text, 'Load **122.5 kg** — 81.7% of your 150.', 'with the model\'s words');
  eq(res.unchecked.length, 0, 'and its load passes the check');
  eq(res.tools.join(','), 'load_for_rpe,load_for_rpe', 'and it reports what it checked');
  eq(steps.length, 1, 'progress is reported once per tool round');

  const second = seen[1].messages;
  eq(second.length, 3, 'question, model turn, tool results');
  eq(second[1].content[0].signature, 'sig-1', 'the thinking block goes back unedited');
  eq(second[2].content.length, 2, 'both tool results go back in one message');
  eq(second[2].content.map((b) => b.tool_use_id).join(','), 'a,b', 'each answering its own call');
  ok(second[2].content[1].is_error && /reps/.test(second[2].content[1].content), 'a bad call comes back as an error the model can read');
  eq(seen[1].system, SYSTEM, 'the system prompt is the same on every round');

  // A follow-up builds on the history without touching it.
  const before = JSON.stringify(res.messages);
  const { send: send2, seen: seen2 } = fakeModel([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Yes.' }] }]);
  const res2 = await ask({ state: st, history: res.messages, question: 'Sure?', send: send2, today: TODAY });
  ok(res2.ok, 'a follow-up resolves');
  eq(JSON.stringify(seen2[0].messages.slice(0, res.messages.length)), before, 'the earlier conversation is resent byte for byte');
}

{
  const hist = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }, { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }];
  const frozen = JSON.stringify(hist);
  const refused = await ask({ state: st, history: hist, question: 'x', today: TODAY,
    send: fakeModel([{ stop_reason: 'refusal', content: [] }]).send });
  ok(!refused.ok && /declined/.test(refused.error), 'a refusal is reported, not shown as an empty answer');
  const down = await ask({ state: st, history: hist, question: 'x', today: TODAY,
    send: fakeModel([new Error('Could not reach the sheet')]).send });
  ok(!down.ok && /reach/.test(down.error), 'a network failure is reported as one');
  eq(JSON.stringify(hist), frozen, 'and neither touches the conversation, so the question can be asked again');

  const loop = Array.from({ length: MAX_ROUNDS + 2 }, (_, i) => ({ stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: `l${i}`, name: 'get_overview', input: {} }] }));
  const runaway = await ask({ state: st, history: [], question: 'x', send: fakeModel(loop).send, today: TODAY });
  ok(!runaway.ok && /too many steps/.test(runaway.error), `a model that never stops is cut off after ${MAX_ROUNDS} rounds`);
}

/* ======================================================================
   8. The script keeps the key and the cost on its side
   ====================================================================== */
hr('8. Apps Script relay');
{
  const gs = readFileSync(new URL('../../server/appsscript/Code.gs', import.meta.url), 'utf8');
  ok(/case 'ask': return ok\(ask_\(body\)\);/.test(gs), 'the script answers ask requests');
  ok(/function ask_\(body\)[\s\S]*requireToken|requireToken\(body\.token\);[\s\S]*case 'ask'/.test(gs), 'behind the same token as sync');
  ok(/model: prop\('ANTHROPIC_MODEL'\) \|\| ASK_MODEL/.test(gs), 'the script picks the model, not the phone');
  ok(/max_tokens: ASK_MAX_TOKENS/.test(gs), 'and the output cap');
  ok(/countAsk_\(\);/.test(gs), 'and counts calls against a daily limit');
  const askFn = gs.slice(gs.indexOf('function ask_('), gs.indexOf('function countAsk_('));
  ok(!/return[\s\S]*\bkey\b/.test(askFn.slice(askFn.lastIndexOf('return {'))), 'the key never goes back in a reply');
}


/* ======================================================================
   9. The book library and the coach's notes
   ====================================================================== */
hr('9. Book search and notes');
{
  const calls = [];
  const searchBook = async (query, opts) => {
    calls.push({ query, opts });
    return { configured: true, sources: ['Pyramid'], passages: [{ source: 'Pyramid', edition: '2nd ed.', page: 121, chapter: 'PROGRESSION', text: 'If you make no progress over 8–12 weeks…' }] };
  };
  const hit = await runTool(st, 'search_book', { query: 'advanced lifter stall' }, { today: TODAY, searchBook });
  eq(hit.passages[0].page, 121, 'a book passage comes back with its printed page');
  eq(hit.passages[0].book, 'Pyramid', 'and the book it is from');
  eq(calls[0].opts.limit, 5, 'five passages unless the model asks for more');
  await runTool(st, 'search_book', { query: 'x y', limit: 50 }, { today: TODAY, searchBook });
  eq(calls[1].opts.limit, 8, 'and never more than eight');
  const empty = await runTool(st, 'search_book', { query: 'taper' }, { today: TODAY, searchBook: async () => ({ configured: false, passages: [] }) });
  ok(empty.count === 0 && /search_library/.test(empty.note), 'an empty library says so and points to the summaries');
  let threw = null;
  try { await runTool(st, 'search_book', { query: 'taper' }, { today: TODAY }); } catch (e) { threw = e.message; }
  ok(/unavailable/.test(threw || ''), 'without a connection to the library the tool says it is unavailable');

  // Notes.
  const kept = [];
  const remember = (n) => kept.push(n);
  const r = runTool(st, 'remember', { note: '  Prefers  paused bench on technique days. ' }, { today: TODAY, remember });
  ok(r.saved && kept[0].text === 'Prefers paused bench on technique days.', 'a note is saved, tidied');
  eq(kept[0].by, 'coach', 'marked as saved by the coach');
  eq(kept[0].date, TODAY, 'and dated');
  throws(() => runTool(st, 'remember', { note: 'x'.repeat(301) }, { remember }), /longer/, 'an essay is refused');
  throws(() => runTool(st, 'remember', { note: 'Likes paused bench.' }, {}), /cannot be saved/, 'without a store the tool says so');
  const full = { ...st, coachNotes: Array.from({ length: MAX_NOTES }, (_, i) => ({ id: `n${i}`, text: `note ${i}`, date: TODAY, by: 'you' })) };
  throws(() => runTool(full, 'remember', { note: 'One more thing.' }, { remember }), /delete one/, `the notes stop at ${MAX_NOTES}`);
  const dup = runTool({ ...st, coachNotes: [{ id: 'a', text: 'Likes paused bench.', date: TODAY, by: 'you' }] }, 'remember', { note: 'likes paused bench.' }, { remember: () => ok(false, 'a duplicate is not saved') });
  eq(dup.saved, false, 'a note he already has is not saved twice');

  const withNotes = { ...st, coachNotes: [{ id: 'a', text: 'Keep accessories to 2 sets in the peak.', date: '2026-10-10', by: 'you' }] };
  const line = contextLine(withNotes, { today: TODAY });
  ok(line.includes('Keep accessories to 2 sets in the peak.') && line.includes('written by him'), 'his notes travel in front of every question');
  ok(!contextLine(st, { today: TODAY }).includes('notes'), 'and with no notes there is no notes line');
  ok(!SYSTEM.includes('Keep accessories'), 'notes never go in the cached system prompt');

  // The loop: two remember calls in one turn see each other, and the answer reports what was saved.
  const saved = [];
  const { send } = fakeModel([
    { stop_reason: 'tool_use', content: [
      { type: 'tool_use', id: 'm1', name: 'remember', input: { note: 'Competes in the 83 kg class.' } },
      { type: 'tool_use', id: 'm2', name: 'remember', input: { note: 'competes in the 83 kg class.' } },
      { type: 'tool_use', id: 'm3', name: 'search_book', input: { query: 'weight class' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Noted: you compete at 83 kg.' }] },
  ]);
  const before = JSON.stringify(st.coachNotes || []);
  const res = await ask({ state: st, history: [], question: 'Remember I compete in the 83 kg class.', send, today: TODAY,
    searchBook, remember: (n) => saved.push(n) });
  ok(res.ok, 'a question that saves a note resolves');
  eq(saved.length, 1, 'the same note twice in one turn is saved once');
  eq(res.saved.join('|'), 'Competes in the 83 kg class.', 'and the answer reports what it saved');
  eq(JSON.stringify(st.coachNotes || []), before, 'the state handed in is not mutated behind the store\'s back');
  eq(res.unchecked.length, 0, 'a weight he typed is not flagged');
}

/* ---- the script's book search ----------------------------------------- */
{
  const gs = readFileSync(new URL('../../server/appsscript/Code.gs', import.meta.url), 'utf8');
  ok(/case 'book': return ok\(book_\(body\)\);/.test(gs), 'the script answers book searches, behind the token');
  const ctx = vm.createContext({});
  vm.runInContext(gs, ctx);
  const book = { title: 'Test Book', authors: 'A. Author', passages: [
    { id: 0, page: 10, chapter: 'VOLUME', text: 'Volume is the number of hard sets per muscle per week.' },
    { id: 1, page: 56, chapter: 'PROGRESSION', text: 'A taper reduces volume by 40 to 60 percent while keeping intensity high before a meet.' },
    { id: 2, page: 57, chapter: 'PROGRESSION', text: 'Tapering for one to two weeks lets fatigue dissipate.' },
    { id: 3, page: 90, chapter: 'TEMPO', text: 'Lifting tempo matters less than intent.' },
  ] };
  const hits = ctx.searchPassages_([book], 'how long should my taper be before the meet', 3);
  eq(hits[0]?.page, 56, 'the passage that matches best comes first');
  ok(hits.every((h) => h.source === 'Test Book' && h.text), 'each passage says which book it is from');
  ok(!hits.some((h) => h.page === 90), 'passages that do not match are left out');
  eq(ctx.searchPassages_([book], 'the and of', 3).length, 0, 'a query of only stopwords finds nothing');
  eq(ctx.searchPassages_([], 'taper', 3).length, 0, 'an empty library finds nothing');
  // The real index is copyrighted and never in the repo, so this runs only on the machine that built it.
  const real = new URL('../../private/muscle-strength-pyramid-training.json', import.meta.url);
  if (existsSync(real)) {
    const idx = JSON.parse(readFileSync(real, 'utf8'));
    const t = ctx.searchPassages_([idx], 'taper volume before a meet', 5);
    ok(t.length === 5 && t.some((h) => /taper/i.test(h.text)), 'on the real book, a taper question finds taper passages');
  }
}

/* ---- report ----------------------------------------------------------- */
console.log(`\n${fail ? '\x1b[31mFAILED' : '\x1b[32mPASSED'}\x1b[0m  ${pass} passed, ${fail} failed`);
if (fail) { for (const p of problems) console.log('  ✗ ' + p); process.exit(1); }
