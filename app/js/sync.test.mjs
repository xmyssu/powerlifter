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
// The Discord card links to the dashboard, derived from the page URL rather than
// configured, so the module needs a location to derive it from.
Object.defineProperty(globalThis, 'location', {
  value: { href: 'https://xmyssu.github.io/powerlifter/#/today', origin: 'https://xmyssu.github.io' },
  writable: true, configurable: true,
});
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

/** The same session, but every prescribed set logged at the prescribed reps. */
function cleanSession(id, date, load, units = 'kg') {
  const ses = session(id, date, load, units);
  ses.entries[0].sets = ses.entries[0].sets.map((x) => ({ ...x, reps: 5 }));
  ses.entries[1].sets = ses.entries[1].sets.map((x) => ({ ...x, reps: 6, rpe: 7.5, done: true }));
  return ses;
}

function seed(sessions) {
  const base = store.defaultState();
  store.replaceState({
    ...base,
    onboarded: true,
    profile: { ...base.profile, name: 'Daniel Orlov', units: 'kg', bodyweight: 84 },
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
   10. The public projection — an allowlist, not a redaction
   ====================================================================== */
hr('10. What the public dashboard is allowed to see');
{
  seed([session('ses_old', '2026-08-10', 140), session('ses_new', '2026-08-15', 147.5)]);
  sync.enqueueAll();
  await sync.flush({ force: true });

  const pub = sent.body.public;
  const wire = JSON.stringify(pub);
  ok(!!pub, 'a public projection rides along with every push');

  // --- the things that must never get out -------------------------------
  // Canaries planted in the fixture: a session note, an exercise note, a
  // readiness score and a full surname. If any of these appear the allowlist
  // has sprung a leak, and it will have sprung it into a public URL.
  ok(!/Slept badly/.test(wire), 'session notes never reach the public file');
  ok(!/brace harder/.test(wire), 'nor do per-exercise notes');
  ok(!/"notes"/.test(wire), 'there is no notes field at all');
  ok(!/"readiness"/.test(wire), 'readiness check-ins are absent entirely');
  ok(!/"sleep"|"stress"|"soreness"|"motivation"/.test(wire), 'and so is every readiness component');
  ok(!/"sessionRPE"/.test(wire), 'the session difficulty rating stays private');
  ok(!/Orlov/.test(wire), 'the surname never leaves the device');
  ok(!/"token"|supersecret|\/exec/.test(wire), 'no credentials or endpoints');
  ok(!/"queue"|"lastError"|"endpoint"/.test(wire), 'and none of the sync plumbing');
  eq(pub.athlete.firstName, 'Daniel', 'just a first name');

  // --- the things that must be there ------------------------------------
  eq(pub.unit, 'kg', 'everything is stated in kilos');
  eq(pub.totals.sessions, 2, 'the totals count sessions');
  eq(pub.totals.sets, 8, 'and logged sets only');
  ok(pub.totals.tonnage > 0, 'and total tonnage');
  eq(pub.totals.firstDate, '2026-08-10', 'with the date the log starts');

  eq(pub.lifts.length, 3, 'all three competition lifts get a block');
  const squat = pub.lifts.find((l) => l.lift === 'squat');
  ok(squat.e1rm > 0, 'squat has a headline estimated max', squat.e1rm);
  eq(squat.trend.length, 2, 'with one trend point per session');
  ok(squat.trend.every((p) => typeof p.value === 'number' && 'deload' in p && 'soft' in p),
     'and each point says whether it is trustworthy');
  eq(squat.tested, 170, 'the tested max comes along for reference');

  ok(pub.prs.length > 0, 'there is a PR table');
  ok(pub.prs.every((p, i, a) => i === 0 || a[i - 1].e1rm >= p.e1rm), 'sorted strongest first');
  ok(pub.prs.every((p) => p.exercise && p.date && p.reps && p.load > 0), 'each row is complete');
  ok(pub.prs.some((p) => p.exercise === 'Low-Bar Back Squat'), 'named by exercise, not id');

  eq(pub.lastSession.date, '2026-08-15', 'the last session is the most recent one');
  eq(pub.lastSession.lifts.length, 2, 'with a line per exercise worked');
  ok(/147\.5×5@8/.test(pub.lastSession.lifts[0].detail), 'showing loads, reps and RPE');
  eq(pub.sessions.length, 2, 'and every session gets a summary row');
  ok(pub.sessions[0].date < pub.sessions[1].date, 'in chronological order');
  ok(pub.sessions[1].avgRPE > 0 && pub.sessions[1].avgTargetRPE > 0,
     'each carrying actual and prescribed RPE, so calibration is chartable');

  eq(pub.bodyweight.length, 1, 'bodyweight is included, as chosen');
  eq(pub.bodyweight[0].kg, 84.2, 'in kilos');
}

/* ======================================================================
   11. Pounds must not leak into a kilo file
   ====================================================================== */
hr('11. The public file is kilos, whatever you lifted in');
{
  seed([session('ses_lb', '2026-08-16', 315, 'lb')]);
  store.update((s) => { s.profile.units = 'lb'; });
  sync.enqueueAll();
  await sync.flush({ force: true });

  const pub = sent.body.public;
  eq(pub.unit, 'kg', 'still declares kilos');
  eq(pub.displayUnit, 'lb', 'while recording what the lifter thinks in');
  const squat = pub.lifts.find((l) => l.lift === 'squat');
  ok(squat.e1rm > 150 && squat.e1rm < 200,
     'a 315lb triple reads as a ~175kg estimate, not a 385 one', squat.e1rm);
  const top = pub.lastSession.lifts[0].topKg;
  eq(top, 142.9, 'top set converted to kilos, rounded for display');
  near(pub.bodyweight[0].kg, 38.2, 'bodyweight converted too', 0.2);
  ok(pub.prs.every((p) => p.load < 200), 'PR loads are kilos, not raw pounds');
}


/* ======================================================================
   12. A forgotten Finish tap must not become a 10-hour workout
   ====================================================================== */
hr('12. Session duration sanity');
{
  const late = session('ses_late', '2026-08-15', 140);
  // Started in the evening, finished the following afternoon — the lifter went
  // home and tapped Finish the next day. Real, and common enough to matter.
  late.endedAt = '2026-08-16T14:00:00.000Z';
  seed([late]);
  sync.enqueueAll();
  await sync.flush({ force: true });

  eq(sent.body.sessions[0].minutes, null, 'an implausible duration is reported as unknown, not as fact');
  eq(sent.body.public.sessions[0].minutes, null, 'and the public dashboard never sees it either');
  eq(sent.body.discord[0].minutes, null, 'nor does Discord');
  ok(sent.body.sessions[0].sets > 0, 'while everything else about the session is kept');

  // The boundary either side, so the clamp is not silently swallowing real ones.
  const long = session('ses_long', '2026-08-15', 140);
  long.endedAt = new Date(new Date(long.startedAt).getTime() + 470 * 60e3).toISOString();
  seed([long]);
  sync.enqueueAll();
  await sync.flush({ force: true });
  eq(sent.body.sessions[0].minutes, 470, 'a genuinely long session is still reported');

  const backwards = session('ses_back', '2026-08-15', 140);
  backwards.endedAt = '2026-08-14T10:00:00.000Z';
  seed([backwards]);
  sync.enqueueAll();
  await sync.flush({ force: true });
  eq(sent.body.sessions[0].minutes, null, 'and a negative one is dropped rather than shown');
}


/* ======================================================================
   13. Version skew between the app and the Apps Script
   ====================================================================== */
hr('13. Stale-script detection');
{
  seed([session('ses_new', '2026-08-15', 147.5)]);

  reply = { ok: true, sheetUrl: 'https://sheet/FAKE', discordConfigured: true, publishConfigured: true, scriptVersion: sync.EXPECTED_SCRIPT_VERSION };
  let res = await sync.test();
  ok(res.ok && !res.stale, 'a current script is not flagged');
  ok(res.publish, 'and reports that publishing is configured');

  reply = { ok: true, sheetUrl: 'https://sheet/FAKE', scriptVersion: sync.EXPECTED_SCRIPT_VERSION - 1 };
  res = await sync.test();
  ok(res.stale, 'an older script IS flagged, so a stale paste is diagnosable');

  // The first release did not report a version at all; absence means ancient.
  reply = { ok: true, sheetUrl: 'https://sheet/FAKE' };
  res = await sync.test();
  eq(res.scriptVersion, 1, 'a script that reports no version is treated as v1');
  ok(res.stale, 'and therefore as stale');

  reply = { ok: true, sets: 8, sessions: 2, discord: 1, sheetUrl: 'https://sheet/FAKE' };
}

/* ---- the Code.gs in this repo must match what the app expects ---------- */
{
  const { readFileSync } = await import('node:fs');
  const gs = readFileSync(new URL('../../server/appsscript/Code.gs', import.meta.url), 'utf8');
  const m = gs.match(/var SCRIPT_VERSION = (\d+);/);
  ok(!!m, 'Code.gs declares a SCRIPT_VERSION');
  eq(+m[1], sync.EXPECTED_SCRIPT_VERSION,
     'and it matches the app — bump both together, or the app will call a fresh paste stale');
  ok(/function publishPublic_/.test(gs), 'Code.gs still contains the publishing step');
  ok(/function diagnosePublish/.test(gs), 'and the diagnostic the setup notes point at');
}


/* ======================================================================
   14. The Discord card: marks, sparklines, stalls, corrections
   ====================================================================== */
hr('14. Discord card');
{
  seed([session('ses_a', '2026-08-03', 140), session('ses_b', '2026-08-10', 145), session('ses_c', '2026-08-15', 147.5)]);
  sync.enqueueAll();
  await sync.flush({ force: true });

  const card = sent.body.discord.find((d) => d.sessionId === 'ses_c');
  ok(!!card.url && /dash\.html$/.test(card.url), 'the card links to the dashboard', card.url);
  // Three squat sets prescribed at 8 and one logged bench set at 7.5:
  // (8·3 + 7.5·1) / 4 = 7.875. Weighted by set, not by exercise.
  eq(card.avgTargetRPE, 7.875, 'it carries the prescribed RPE beside the actual one');

  // Coloured squares tie the message to the dashboard's series colours.
  const squat = card.lines.find((l) => /Squat/.test(l.exercise));
  eq(squat.mark, '🟧', 'the squat line is marked with the dashboard orange');
  eq(card.lines.find((l) => /Bench/.test(l.exercise)).mark, '🟦', 'bench with the blue');
  ok(card.lines.every((l) => 'mark' in l), 'every line has a mark field, blank for accessories');

  const spark = card.sparks.find((s) => s.lift === 'squat');
  ok(!!spark, 'a sparkline is built for the squat');
  eq(spark.spark.length, 3, 'one block per session in the window');
  ok(/^[▁▂▃▄▅▆▇█]+$/.test(spark.spark), 'made of block characters only', spark.spark);
  eq(spark.spark[0], '▁', 'the oldest of a rising series is the lowest block');
  eq(spark.spark[spark.spark.length - 1], '█', 'and the newest is the highest');
  ok(spark.change > 0, 'the change over the window is positive', spark.change);
  eq(spark.mark, '🟧', 'and it is marked to match');

  eq(card.correctedAt, null, 'an untouched session reports no correction');

  // The standing fixture deliberately drops a rep on the last squat set and
  // leaves a bench set unlogged, so it SHOULD read as short of the prescription.
  ok(card.stalled.length > 0, 'the fixture, which drops a rep, reads as short');

  seed([cleanSession('ses_ok', '2026-08-15', 147.5)]);
  sync.enqueueAll();
  await sync.flush({ force: true });
  eq(sent.body.discord[0].stalled.length, 0, 'a session that meets its prescription is not flagged');
}

/* ---- a session that fell short is flagged, unless it was technique work --- */
{
  const short = session('ses_short', '2026-08-15', 147.5);
  // Prescribed 5 reps, only got 3 on the last set: the book's definition of
  // coming up short.
  short.entries[0].sets[2].reps = 3;
  seed([short]);
  sync.enqueueAll();
  await sync.flush({ force: true });
  const card = sent.body.discord[0];
  ok(card.stalled.length > 0, 'falling short of the prescription is flagged', JSON.stringify(card.stalled));
  ok(/Squat/.test(card.stalled[0]), 'naming the lift', card.stalled[0]);

  // The same shortfall on a deload must not be flagged — deloads are light by design.
  const dl = session('ses_dl', '2026-08-15', 100);
  dl.phase = 'deload';
  dl.entries[0].sets[2].reps = 3;
  seed([dl]);
  sync.enqueueAll();
  await sync.flush({ force: true });
  eq(sent.body.discord[0].stalled.length, 0, 'coming up short on a deload is not a stall');
  ok(sent.body.discord[0].deload, 'and the card says it was a deload');
}

/* ---- a corrected session tells the script to rewrite its message -------- */
{
  seed([session('ses_fix', '2026-08-15', 147.5)]);
  store.update((s) => {
    s.sessions[0].corrections = [{ at: '2026-08-16T09:00:00.000Z', slotKey: 'd3_squat', setIndex: 0, field: 'load', from: 1475, to: 147.5 }];
    s.sync.queue = ['ses_fix'];
  });
  await sync.flush({ force: true });
  eq(sent.body.discord[0].correctedAt, '2026-08-16T09:00:00.000Z',
     'the card carries when it was corrected, so the posted message can be re-rendered');
}

/* ======================================================================
   15. The weekly rollup
   ====================================================================== */
hr('15. Weekly rollup');
{
  // Two full weeks, ending in the week before the current one.
  const thisMonday = (() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  })();
  // Local components, not toISOString: the rollup buckets by local dates, and a
  // UTC conversion moved every session one day and broke the week boundary.
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const day = (offset) => iso(new Date(thisMonday.getTime() + offset * 864e5));

  const built = [];
  for (const [i, off] of [-14, -12, -10, -8, -7, -5, -3, -1].entries()) {
    built.push(session(`w_${i}`, day(off), 140 + i * 2.5));
  }
  seed(built);
  sync.enqueueAll();
  await sync.flush({ force: true });

  const w = sent.body.weekly;
  ok(!!w, 'a rollup is included');
  eq(w.weekKey, day(-7), 'it covers the week that just finished, not the current one');
  eq(w.sessions, 4, 'counting that week\'s sessions only');
  ok(w.planned > 0, 'against how many the program prescribes', w.planned);
  ok(w.tonnage > 0, 'with the week\'s tonnage in kg');
  ok(w.prevTonnage > 0, 'and the previous week\'s, so the delta is computable');
  // Up to six weeks, but never a week from before the log existed — an empty
  // week rendered as the lowest block reads as a very light week, which is a lie.
  eq(w.volumeSpark.length, w.volumeWeeks, 'the spark has one block per week reported');
  eq(w.volumeWeeks, 2, 'and only the two weeks this fixture could have trained in');
  ok(w.volumeWeeks <= 6, 'capped at six weeks of context');
  ok(w.avgRPE > 0 && w.avgTargetRPE > 0, 'actual and prescribed RPE for the week');
  // Only lifts with a trend appear; the fixture never deadlifts.
  eq(w.maxes.length, 2, 'where each competition lift with history stands');
  ok(!w.maxes.some((m) => m.lift === 'deadlift'), 'a lift never trained is omitted rather than shown as zero');
  ok(w.maxes.every((m) => m.value > 0 && m.mark), 'each with a value and a mark');
  ok(!!w.url, 'linking to the dashboard');
  ok(!w.deloadWeek, 'not flagged as a deload');

  // Nothing to report when the previous week was empty.
  seed([session('only_now', day(1), 140)]);
  sync.enqueueAll();
  await sync.flush({ force: true });
  eq(sent.body.weekly, null, 'a week with no sessions produces no rollup');
}

/* ---- the rollup must not leak private fields either -------------------- */
{
  seed([session('w1', '2026-08-03', 140), session('w2', '2026-08-10', 145)]);
  sync.enqueueAll();
  await sync.flush({ force: true });
  const wire = JSON.stringify(sent.body.weekly);
  ok(!/Slept badly/.test(wire), 'no session notes in the rollup');
  ok(!/"readiness"/.test(wire), 'no readiness data');
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
