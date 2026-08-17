/* ==========================================================================
   sync.test.mjs — what the cloud sync layer actually puts on the wire.
   Run: node js/sync.test.mjs
   No framework; exits non-zero on failure.

   The point of these is the payload contract. The Apps Script on the other end
   keys rows off `key`, charts off the `*Kg` columns and dedupes Discord posts
   off `sessionId`, so a silent change to any of those breaks a sheet that is
   already full of history. Also pinned here: the token never leaves the device,
   and a failed push keeps its sessions queued instead of dropping them.
   ========================================================================== */

// --- browser shims ------------------------------------------------------
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
globalThis.document = { dispatchEvent() {}, addEventListener() {}, visibilityState: 'visible' };
globalThis.window = { addEventListener() {} };
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o); } };
// node defines navigator as getter-only, so replace the property outright.
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true, storage: {} }, writable: true, configurable: true,
});

// --- a fetch we can inspect ---------------------------------------------
let sent = null;
let reply = { ok: true, sets: 8, sessions: 2, discord: 1, sheetUrl: 'https://sheet/FAKE' };
let httpBody = null;    // set to a string to answer with something other than JSON
globalThis.fetch = async (url, opts) => {
  sent = { url, opts, body: JSON.parse(opts.body) };
  return { ok: true, status: 200, text: async () => httpBody ?? JSON.stringify(reply) };
};

const store = await import('./store.js');
const sync = await import('./sync.js');

let pass = 0, fail = 0;
const problems = [];
function ok(cond, label, extra) {
  if (cond) { pass++; } else { fail++; problems.push(label + (extra ? `  [${extra}]` : '')); }
}
const eq = (a, b, label) => ok(a === b, label, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const near = (a, b, label, tol = 0.01) => ok(Math.abs(a - b) <= tol, label, `got ${a}, want ~${b}`);
const hr = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`);

const SQUAT = 'back-squat-low-bar';
const BENCH = 'bench-press';

/** A completed session: three squat sets, one bench set logged without an RPE. */
function session(id, date, load, units = 'kg') {
  const startedAt = `${date}T17:00:00.000Z`;
  return {
    id, date, startedAt,
    endedAt: new Date(new Date(startedAt).getTime() + 65 * 60e3).toISOString(),
    status: 'done', templateId: 'intermediatePL', units,
    cycle: 1, week: 2, day: 1, phase: 'load',
    entries: [
      {
        slotKey: 'd3_squat', exerciseId: SQUAT, targetSets: 3, targetReps: 5,
        targetRPE: 8, rpeRange: null, plannedLoad: load, pct: null, note: 'brace harder',
        sets: [
          { load, reps: 5, rpe: 8, done: true, ts: startedAt },
          { load, reps: 5, rpe: 8.5, done: true, ts: startedAt },
          { load, reps: 4, rpe: 9.5, done: true, ts: startedAt },
        ],
      },
      {
        slotKey: 'd3_bench', exerciseId: BENCH, targetSets: 2, targetReps: 6,
        targetRPE: 7.5, rpeRange: null, plannedLoad: 90, pct: null, note: '',
        sets: [
          { load: 90, reps: 6, rpe: null, done: true, ts: startedAt },
          { load: 90, reps: null, rpe: null, done: false, ts: null },   // never happened
        ],
      },
    ],
    sessionRPE: 4, notes: 'Slept badly, still moved fine.', readiness: null,
  };
}

function seed(sessions) {
  const base = store.defaultState();
  store.replaceState({
    ...base,
    onboarded: true,
    program: { templateId: 'intermediatePL', slots: {}, choices: {}, cursor: { cycle: 1, week: 2, day: 1, phase: 'load' } },
    maxes: {
      squat: { value: 170, date: '2026-08-01', source: 'estimate', reps: 5 },
      bench: { value: 115, date: '2026-08-01', source: 'estimate', reps: 5 },
      deadlift: { value: null, date: null, source: null, reps: null },
    },
    readiness: [{ date: '2026-08-15', sleep: 2, stress: 3, soreness: 3, motivation: 4, score: 3 }],
    bodyweightLog: [{ date: '2026-08-10', value: 84.2 }],
    sessions,
  });
  sync.configure({ endpoint: 'https://script.google.com/macros/s/AKfycb/exec', token: 'tok', enabled: true });
}

/* ======================================================================
   1. The rows
   ====================================================================== */
hr('1. Set and session rows');
{
  seed([session('ses_old', '2026-08-10', 140), session('ses_new', '2026-08-15', 147.5)]);
  eq(sync.enqueueAll(), 2, 'enabling sync queues the whole back catalogue');

  const res = await sync.flush({ force: true });
  ok(res.ok, 'the push succeeds');
  const b = sent.body;

  eq(b.kind, 'push', 'it is a push');
  eq(b.v, sync.PROTOCOL, 'it declares the protocol version');
  eq(sent.opts.headers['Content-Type'], 'text/plain;charset=utf-8',
     'sent as text/plain so no CORS preflight is triggered');

  eq(b.sets.length, 8, 'only logged sets are sent (the unlogged bench set is dropped)');
  eq(new Set(b.sets.map((s) => s.key)).size, 8, 'every set row has a distinct key');
  ok(b.sets.every((s) => /^ses_[a-z]+:d3_(squat|bench):\d$/.test(s.key)),
     'keys are session:slot:index, so a resync updates rather than duplicates');
  ok(b.sets.every((s) => s.exercise && s.exercise !== s.exerciseId),
     'exercise ids are resolved to readable names');
  eq(b.sets[0].exercise, 'Low-Bar Back Squat', 'and resolved via the real library');

  const scored = b.sets.filter((s) => s.rpe !== null);
  const unscored = b.sets.filter((s) => s.rpe === null);
  eq(unscored.length, 2, 'the two RPE-less sets are still sent');
  ok(unscored.every((s) => s.e1rmKg === null),
     'but carry no estimated max — a guessed one would skew every trend line');
  ok(scored.every((s) => s.e1rmKg > 0), 'scored sets do carry one');

  const row = b.sessions.find((s) => s.key === 'ses_new');
  eq(b.sessions.length, 2, 'one summary row per session');
  eq(row.sets, 4, 'the summary counts logged sets');
  eq(row.reps, 20, 'and reps');
  eq(row.tonnage, 147.5 * 14 + 90 * 6, 'tonnage is load times reps');
  eq(row.minutes, 65, 'duration comes from the timestamps');
  eq(row.bodyweight, 84.2, 'the most recent weigh-in on or before the session is joined on');
  eq(row.readiness, 3, 'the readiness score for that date is joined on');
  eq(b.sessions.find((s) => s.key === 'ses_old').readiness, null,
     'and left null on a day with no readiness check-in');
  ok(/W2 · Day 1/.test(row.label), 'the label names the week and day', row.label);
  eq(b.maxes.length, 2, 'only maxes that have a value are sent');
}

/* ======================================================================
   2. Units — the whole point of the second column
   ====================================================================== */
hr('2. Pounds normalise onto the kilo axis');
{
  seed([session('ses_lb', '2026-08-16', 315, 'lb')]);
  sync.enqueueAll();
  await sync.flush({ force: true });

  const set = sent.body.sets[0];
  eq(set.unit, 'lb', 'the unit it was logged in is recorded');
  eq(set.load, 315, 'the native number is preserved exactly');
  near(set.loadKg, 142.882, 'and a kg column is derived for charting');

  const row = sent.body.sessions[0];
  eq(row.tonnage, 315 * 14 + 90 * 6, 'session tonnage stays native');
  near(row.tonnageKg, (315 * 14 + 90 * 6) * 0.45359237, 'with a kg column beside it', 1);
  eq(sent.body.discord[0].unit, 'lb', 'Discord reports the unit actually lifted');
}

/* ======================================================================
   3. Personal records are as-of the session, not as-of now
   ====================================================================== */
hr('3. PR detection');
{
  seed([session('ses_old', '2026-08-10', 140), session('ses_new', '2026-08-15', 147.5)]);
  sync.enqueueAll();
  await sync.flush({ force: true });

  const older = sent.body.discord.find((d) => d.sessionId === 'ses_old');
  const newer = sent.body.discord.find((d) => d.sessionId === 'ses_new');
  eq(older.prs.length, 0, 'the first session of a lift claims no record');
  eq(newer.prs.length, 1, 'the heavier later session does');
  ok(newer.prs[0].gain > 0, 'and the gain is positive');
  eq(newer.prs[0].exercise, 'Low-Bar Back Squat', 'named by exercise');

  // Flushing a backlog must not credit an old session with a record it never had.
  seed([session('ses_old', '2026-08-10', 140), session('ses_new', '2026-08-15', 147.5)]);
  store.update((s) => { s.sync.queue = ['ses_old']; });
  await sync.flush({ force: true });
  eq(sent.body.discord[0].sessionId, 'ses_old', 'pushing only the older session');
  eq(sent.body.discord[0].prs.length, 0,
     'it still claims no record, even though a heavier session already exists locally');
}

/* ======================================================================
   4. What Discord gets
   ====================================================================== */
hr('4. The Discord card');
{
  seed([session('ses_new', '2026-08-15', 147.5)]);
  sync.enqueueAll();
  await sync.flush({ force: true });

  const card = sent.body.discord[0];
  eq(card.sessionId, 'ses_new', 'carries the session id the script dedupes on');
  eq(card.lines.length, 2, 'one line per exercise that was actually worked');
  eq(card.lines[0].detail, '147.5×5@8, 147.5×5@8.5, 147.5×4@9.5', 'sets read as load×reps@rpe');
  eq(card.lines[0].note, 'brace harder', 'exercise notes come along');
  eq(card.lines[1].detail, '90×6', 'a set with no RPE simply omits it');
  eq(card.sessionRPE, 4, 'how the session felt is included');
  ok(/Slept badly/.test(card.notes), 'as are the session notes');
}

/* ======================================================================
   5. The token stays on the device
   ====================================================================== */
hr('5. Secrets');
{
  seed([session('ses_new', '2026-08-15', 147.5)]);
  sync.enqueueAll();
  await sync.flush({ force: true });

  const snap = JSON.parse(sent.body.snapshot);
  eq(snap.sync.token, '', 'the snapshot uploaded to Drive carries no token');
  ok(snap.sync.endpoint.endsWith('/exec'), 'but keeps the endpoint, so a restore only needs the token retyped');
  eq(snap.sessions.length, 1, 'and it is a real full-state backup');

  eq(JSON.parse(store.exportJSON()).sync.token, '', 'a downloaded backup file carries no token either');
  eq(store.getState().sync.token, 'tok', 'while the device itself keeps it');
}

/* ======================================================================
   6. Failure must never lose a session
   ====================================================================== */
hr('6. Offline, backoff and misdeploys');
{
  seed([session('ses_new', '2026-08-15', 147.5)]);
  sync.enqueueAll();

  navigator.onLine = false;
  const off = await sync.flush({ force: true });
  eq(off.skipped, 'offline', 'an offline flush reports why it did nothing');
  eq(sync.pendingCount(), 1, 'and keeps the session queued');
  navigator.onLine = true;

  // The classic misdeploy: access set to anything but "Anyone", so Google
  // answers with a sign-in page instead of JSON.
  httpBody = '<html><body>Sign in</body></html>';
  const bad = await sync.flush({ force: true });
  ok(!bad.ok, 'a login page is treated as a failure');
  ok(/Redeploy/.test(bad.error), 'with an error that says how to fix it', bad.error);
  eq(sync.pendingCount(), 1, 'the session is still queued');
  ok(!!store.getState().sync.nextAttemptAt, 'and a backoff window is armed');

  const skipped = await sync.flush();
  eq(skipped.skipped, 'backoff', 'an unforced retry inside that window is skipped');

  // A rejection from the script itself.
  httpBody = JSON.stringify({ ok: false, error: 'Bad token.' });
  const rejected = await sync.flush({ force: true });
  ok(!rejected.ok && /Bad token/.test(rejected.error), 'the script\'s own error is surfaced verbatim');
  eq(sync.pendingCount(), 1, 'still queued');

  // Recovery.
  httpBody = null;
  const good = await sync.flush({ force: true });
  ok(good.ok, 'and it goes up once the endpoint works');
  eq(sync.pendingCount(), 0, 'clearing the queue only on success');
  eq(store.getState().sync.failures, 0, 'and resetting the failure count');
  ok(!store.getState().sync.lastError, 'and the error message');
}

/* ======================================================================
   7. Nothing is pushed without being configured
   ====================================================================== */
hr('7. Guards');
{
  seed([session('ses_new', '2026-08-15', 147.5)]);
  sync.configure({ enabled: false });
  sync.enqueue('ses_new');
  sent = null;
  const res = await sync.flush({ force: true });
  eq(res.skipped, 'not-configured', 'sync off means no request at all');
  eq(sent, null, 'literally nothing was sent');

  sync.configure({ endpoint: '', token: '', enabled: true });
  eq((await sync.flush({ force: true })).skipped, 'not-configured', 'nor with a blank endpoint');

  seed([session('ses_new', '2026-08-15', 147.5)]);
  eq((await sync.flush()).skipped, 'nothing-queued', 'an empty queue is a no-op, not a request');
}

/* ======================================================================
   8. Restore
   ====================================================================== */
hr('8. Restore from the sheet');
{
  seed([session('ses_new', '2026-08-15', 147.5)]);
  const backup = store.exportJSON();

  reply = { ok: true, snapshot: backup, savedAt: '2026-08-16T09:00:00.000Z', sessions: 1 };
  const got = await sync.pullLatest();
  ok(got.ok, 'the snapshot comes back');
  eq(got.sessions, 1, 'with a session count to confirm before overwriting anything');
  eq(sent.body.kind, 'pull', 'via a pull request');

  store.resetAll();
  eq(store.getState().sessions.length, 0, 'local state wiped, as if on a new phone');
  const imported = store.importJSON(got.text);
  ok(imported.ok, 'and the snapshot imports');
  eq(store.getState().sessions.length, 1, 'restoring the history');
  eq(store.getState().maxes.squat.value, 170, 'and the maxes');
  eq(store.getState().sync.queue.length, 0, 'with an empty queue');
  eq(store.getState().sync.syncing, false, 'and no stale in-flight flag');

  // The snapshot carried the endpoint but not the token, so a restored phone
  // knows where its sheet is and only needs the secret typed back in.
  ok(store.getState().sync.endpoint.endsWith('/exec'), 'the restored state knows its endpoint');
  eq(store.getState().sync.token, '', 'but not its token');

  sync.configure({ token: 'tok', enabled: true });
  reply = { ok: true, snapshot: null };
  const empty = await sync.pullLatest();
  ok(!empty.ok && /no snapshot/.test(empty.error), 'a sheet with nothing in it says so plainly', empty.error);
  reply = { ok: true, sheetUrl: 'https://sheet/FAKE' };
}

/* ======================================================================
   9. Backfill must not flood Discord
   ====================================================================== */
hr('9. Backfill suppression');
{
  seed([session('ses_new', '2026-08-15', 147.5)]);
  sync.enqueueAll();
  await sync.flush({ force: true });
  ok(!!sent.body.discord[0].endedAt,
     'the card carries endedAt, which is what the script judges freshness on');

  // The suppression itself lives in the Apps Script. Pull the function out of
  // the real file and exercise it, rather than trusting a comment: switching
  // sync on pushes the whole back catalogue at once, and without this every
  // historical session would be announced as if it had just happened.
  const { readFileSync } = await import('node:fs');
  const gs = readFileSync(new URL('../../server/appsscript/Code.gs', import.meta.url), 'utf8');
  const src = gs.match(/var FRESH_HOURS[\s\S]*?function isFresh_\(card\) \{[\s\S]*?\n\}/);
  ok(!!src, 'found isFresh_ in Code.gs');
  const isFresh = new Function(`${src[0]}; return isFresh_;`)();

  const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  ok(isFresh({ endedAt: hoursAgo(1) }), 'a session finished an hour ago is news');
  ok(isFresh({ endedAt: hoursAgo(23) }), 'and one from yesterday evening still is');
  ok(!isFresh({ endedAt: hoursAgo(25) }), 'but one from two days ago is not');
  ok(!isFresh({ endedAt: hoursAgo(24 * 90) }), 'nor is a session from three months of history');
  ok(!isFresh({ endedAt: null, date: null }), 'a card with no timestamp is treated as backfill');
  ok(!isFresh({ endedAt: 'not a date' }), 'so is an unparseable one');
  ok(isFresh({ endedAt: null, date: new Date().toISOString().slice(0, 10) }),
     'falling back to the date when endedAt is missing');
}

/* ======================================================================
   done
   ====================================================================== */
console.log(`\n\x1b[1m${fail ? '\x1b[31mFAILED' : '\x1b[32mPASSED'}\x1b[0m  ${pass} passed, ${fail} failed`);
if (problems.length) {
  console.log('\nFailures:');
  for (const p of problems) console.log('  ✗ ' + p);
}
process.exit(fail ? 1 : 0);
