/* ==========================================================================
   sync.js — push every logged session to a cloud sheet, and pull it back
   --------------------------------------------------------------------------
   Two jobs, one request. The sheet gets flat rows worth charting, and it gets
   a full state snapshot so a wiped phone restores exactly. Neither job is ever
   on the critical path of logging a set: sets land in localStorage first
   (store.js), finished sessions queue here, and the queue drains whenever the
   network happens to be around.

   The endpoint is a Google Apps Script web app — see server/appsscript/Code.gs
   and the setup notes beside it. Requests are deliberately "simple" (text/plain
   body, no custom headers) because Apps Script cannot answer a CORS preflight,
   so anything that triggers one fails before it leaves the browser.

   The Discord webhook URL lives in the script's properties, never here. The
   phone holds one secret: the shared token, typed in once in Settings.
   ========================================================================== */

import * as store from './store.js';
import { convertLoad, e1RM, fmtLoadBare, fmtRPE } from './rpe.js';
import { templateOf, slotHistory } from './program.js';
import { strengthTrend } from './coach.js';
import { nameOf } from './exercises.js';

/** Bumped when the payload shape changes in a way the script must know about. */
export const PROTOCOL = 1;

/**
 * The Code.gs version this build expects.
 *
 * The script lives in a Google Apps Script editor, so updating the app does not
 * update it — they drift, silently, and the symptom is a feature that does
 * nothing rather than an error. The connection test compares this against what
 * the script reports so a stale paste is diagnosable instead of mysterious.
 */
export const EXPECTED_SCRIPT_VERSION = 2;

const TIMEOUT_MS = 25000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;

/* ---- config ----------------------------------------------------------- */

export function config() { return store.getState().sync; }

export function isConfigured() {
  const c = config();
  return !!(c.enabled && c.endpoint && c.token);
}

export function pendingCount() { return config().queue.length; }

/** Persist a patch to the sync block without triggering a full app redraw. */
function patch(fields) {
  store.update((s) => { Object.assign(s.sync, fields); }, { silent: true });
  emit();
}

export function configure({ endpoint, token, enabled }) {
  const next = {};
  if (endpoint !== undefined) next.endpoint = endpoint.trim();
  if (token !== undefined) next.token = token.trim();
  if (enabled !== undefined) next.enabled = !!enabled;
  // A changed endpoint or token invalidates whatever the last failure was about.
  next.lastError = null;
  next.failures = 0;
  next.nextAttemptAt = null;
  patch(next);
}

/* ---- status subscribers (the Settings panel) --------------------------- */

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit() {
  for (const fn of subs) {
    try { fn(config()); } catch (e) { console.error('[sync] subscriber threw', e); }
  }
}

/* ---- the queue -------------------------------------------------------- */

export function enqueue(sessionId) {
  if (!sessionId) return;
  store.update((s) => {
    if (!s.sync.queue.includes(sessionId)) s.sync.queue.push(sessionId);
  }, { silent: true });
  emit();
}

/** Queue the entire back catalogue — used the first time sync is switched on. */
export function enqueueAll() {
  store.update((s) => {
    const ids = s.sessions.filter((x) => x.status === 'done').map((x) => x.id);
    s.sync.queue = [...new Set([...s.sync.queue, ...ids])];
  }, { silent: true });
  emit();
  return pendingCount();
}

function dequeue(ids) {
  const done = new Set(ids);
  store.update((s) => { s.sync.queue = s.sync.queue.filter((id) => !done.has(id)); }, { silent: true });
}

/* ---- flush ------------------------------------------------------------ */

let inFlight = null;

/**
 * Drain the queue. Safe to call from anywhere, as often as you like: overlapping
 * calls share one request, and a backoff window is respected unless forced.
 *
 * Resolves {ok, skipped?, error?, pushed?} and never rejects — callers are
 * fire-and-forget event handlers.
 */
export function flush({ force = false, reason = '' } = {}) {
  if (inFlight) return inFlight;
  if (!isConfigured()) return Promise.resolve({ ok: false, skipped: 'not-configured' });
  if (!navigator.onLine) return Promise.resolve({ ok: false, skipped: 'offline' });

  const c = config();
  if (!force && c.nextAttemptAt && Date.now() < new Date(c.nextAttemptAt).getTime()) {
    return Promise.resolve({ ok: false, skipped: 'backoff' });
  }
  if (!force && !c.queue.length) return Promise.resolve({ ok: true, skipped: 'nothing-queued' });

  inFlight = run(reason).finally(() => { inFlight = null; });
  return inFlight;
}

async function run(reason) {
  const st = store.getState();
  const ids = [...st.sync.queue];
  patch({ syncing: true });

  try {
    const res = await post(buildPayload(st, ids, reason));
    dequeue(ids);
    patch({
      syncing: false,
      lastSyncAt: new Date().toISOString(),
      lastError: null,
      failures: 0,
      nextAttemptAt: null,
      lastResult: {
        sessions: res.sessions ?? ids.length,
        sets: res.sets ?? null,
        discord: res.discord ?? 0,
        sheetUrl: res.sheetUrl || st.sync.lastResult?.sheetUrl || null,
      },
    });
    return { ok: true, pushed: ids.length };
  } catch (err) {
    const failures = (config().failures || 0) + 1;
    // Exponential, capped: a broken endpoint must not mean a request per minute
    // for the rest of the week, but a flaky gym connection should recover fast.
    const wait = Math.min(MAX_BACKOFF_MS, 30000 * 2 ** (failures - 1));
    patch({
      syncing: false,
      failures,
      lastError: String(err.message || err),
      nextAttemptAt: new Date(Date.now() + wait).toISOString(),
    });
    return { ok: false, error: String(err.message || err) };
  }
}

async function post(payload) {
  const { endpoint } = config();
  const ctl = new AbortController();
  const bail = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      // text/plain keeps this a "simple request", so the browser sends it
      // without a preflight. Apps Script would 405 the OPTIONS.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: ctl.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Timed out reaching the sheet.');
    throw new Error('Could not reach the sheet — check the web app URL.');
  } finally {
    clearTimeout(bail);
  }

  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (e) {
    // A login page instead of JSON is the classic misdeploy: the web app was
    // published to "Only myself" rather than "Anyone".
    throw new Error(res.ok
      ? 'The endpoint answered with a page, not data. Redeploy it with access set to "Anyone".'
      : `Sheet returned HTTP ${res.status}.`);
  }
  if (!body.ok) throw new Error(body.error || 'The script rejected the request.');
  return body;
}

/* ---- connection test -------------------------------------------------- */

export async function test() {
  if (!config().endpoint || !config().token) return { ok: false, error: 'Fill in the URL and the token first.' };
  try {
    const res = await post({ app: 'powerlifter', v: PROTOCOL, kind: 'ping', token: config().token });
    patch({ lastError: null, failures: 0, nextAttemptAt: null, lastResult: { ...config().lastResult, sheetUrl: res.sheetUrl || null } });
    return {
      ok: true,
      sheetUrl: res.sheetUrl || null,
      discord: !!res.discordConfigured,
      publish: !!res.publishConfigured,
      scriptVersion: res.scriptVersion || 1,
      stale: (res.scriptVersion || 1) < EXPECTED_SCRIPT_VERSION,
    };
  } catch (err) {
    patch({ lastError: String(err.message || err) });
    return { ok: false, error: String(err.message || err) };
  }
}

/* ---- restore ---------------------------------------------------------- */

/** Fetch the newest snapshot the sheet holds. Returns {ok, text, savedAt}. */
export async function pullLatest() {
  if (!config().endpoint || !config().token) return { ok: false, error: 'Fill in the URL and the token first.' };
  try {
    const res = await post({ app: 'powerlifter', v: PROTOCOL, kind: 'pull', token: config().token });
    if (!res.snapshot) return { ok: false, error: 'The sheet has no snapshot yet.' };
    return { ok: true, text: res.snapshot, savedAt: res.savedAt || null, sessions: res.sessions ?? null };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/* ---- payload ---------------------------------------------------------- */

function buildPayload(st, ids, reason) {
  const sessions = ids
    .map((id) => st.sessions.find((s) => s.id === id))
    .filter((s) => s && s.status === 'done');

  return {
    app: 'powerlifter',
    v: PROTOCOL,
    kind: 'push',
    token: st.sync.token,
    reason,
    clientAt: new Date().toISOString(),
    profileUnits: st.profile.units,
    sets: sessions.flatMap((ses) => setRows(st, ses)),
    sessions: sessions.map((ses) => sessionRow(st, ses)),
    readiness: (st.readiness || []).map((r) => ({
      date: r.date, sleep: r.sleep, stress: r.stress, soreness: r.soreness,
      motivation: r.motivation, score: r.score,
    })),
    bodyweight: (st.bodyweightLog || []).map((b) => ({ date: b.date, value: b.value, unit: st.profile.units })),
    maxes: ['squat', 'bench', 'deadlift'].map((lift) => ({
      lift,
      value: st.maxes[lift]?.value ?? null,
      unit: st.profile.units,
      valueKg: toKg(st.maxes[lift]?.value, st.profile.units),
      date: st.maxes[lift]?.date || null,
      source: st.maxes[lift]?.source || null,
      reps: st.maxes[lift]?.reps ?? null,
    })).filter((m) => m.value != null),
    discord: sessions.map((ses) => discordCard(st, ses)),
    public: publicSnapshot(st),
    snapshot: snapshotJSON(),
  };
}

/**
 * The whole state, minus the credential that got it here — same rule as
 * store.exportJSON: a snapshot sitting in a Drive folder must not hand over
 * write access to the sheet it is sitting in.
 */
function snapshotJSON() {
  return store.exportJSON();
}

const toKg = (v, unit) => (v == null ? null : round3(convertLoad(v, unit, 'kg')));
const round3 = (n) => Math.round(n * 1000) / 1000;

function labelFor(st, ses) {
  const tpl = templateOf({ templateId: ses.templateId });
  const day = tpl.days?.find((d) => d.n === ses.day);
  const focus = day?.label ? ` · ${day.label}` : '';
  if (ses.phase === 'deload') return `Deload · Day ${ses.day}${focus}`;
  return `C${ses.cycle} W${ses.week} · Day ${ses.day}${focus}`;
}

function setRows(st, ses) {
  const unit = ses.units || st.profile.units;
  const rows = [];
  for (const e of ses.entries) {
    (e.sets || []).forEach((s, i) => {
      if (!s.done) return;
      const rpe = s.rpe ?? null;
      rows.push({
        key: `${ses.id}:${e.slotKey}:${i}`,
        date: ses.date,
        sessionId: ses.id,
        label: labelFor(st, ses),
        cycle: ses.cycle, week: ses.week, day: ses.day, phase: ses.phase,
        slotKey: e.slotKey,
        exerciseId: e.exerciseId,
        exercise: nameOf(e.exerciseId),
        setIndex: i + 1,
        load: s.load ?? null,
        unit,
        loadKg: toKg(s.load, unit),
        reps: s.reps ?? null,
        rpe,
        // Left blank rather than guessed: an e1RM invented from a default RPE
        // would sit in the same column as measured ones and skew every chart.
        e1rmKg: rpe != null && s.load > 0 && s.reps > 0 ? round3(e1RM(convertLoad(s.load, unit, 'kg'), s.reps, rpe)) : null,
        targetReps: e.targetReps ?? null,
        targetRPE: e.targetRPE ?? null,
        plannedLoad: e.plannedLoad ?? null,
        loggedAt: s.ts || null,
        note: e.note || '',
      });
    });
  }
  return rows;
}

/**
 * Elapsed time, or nothing.
 *
 * Forgetting to tap Finish until the next day is a real and unremarkable thing
 * to do, and it produces a "session" of 600-odd minutes. Left alone that number
 * lands in the public dashboard as fact and wrecks the axis of anything plotting
 * duration, so past the point where it stops being a workout we report nothing
 * rather than something false.
 */
const MAX_SESSION_MINUTES = 480;

function durationMinutes(ses) {
  if (!ses.startedAt || !ses.endedAt) return null;
  const mins = Math.round((new Date(ses.endedAt) - new Date(ses.startedAt)) / 60000);
  if (!(mins >= 0) || mins > MAX_SESSION_MINUTES) return null;
  return mins;
}

function stats(st, ses) {
  const unit = ses.units || st.profile.units;
  const sets = ses.entries.flatMap((e) => (e.sets || []).filter((s) => s.done));
  const scored = sets.filter((s) => s.rpe != null);
  const tonnage = sets.reduce((n, s) => n + (s.load || 0) * (s.reps || 0), 0);
  return {
    unit,
    sets: sets.length,
    reps: sets.reduce((n, s) => n + (s.reps || 0), 0),
    tonnage: Math.round(tonnage),
    tonnageKg: Math.round(convertLoad(tonnage, unit, 'kg')),
    avgRPE: scored.length ? round3(scored.reduce((n, s) => n + s.rpe, 0) / scored.length) : null,
    minutes: durationMinutes(ses),
  };
}

function sessionRow(st, ses) {
  const s = stats(st, ses);
  const readiness = (st.readiness || []).find((r) => r.date === ses.date) || null;
  const bw = (st.bodyweightLog || []).filter((b) => b.date <= ses.date).slice(-1)[0] || null;
  return {
    key: ses.id,
    date: ses.date,
    label: labelFor(st, ses),
    templateId: ses.templateId,
    cycle: ses.cycle, week: ses.week, day: ses.day, phase: ses.phase,
    exercises: ses.entries.filter((e) => (e.sets || []).some((x) => x.done)).length,
    sets: s.sets,
    reps: s.reps,
    tonnage: s.tonnage,
    unit: s.unit,
    tonnageKg: s.tonnageKg,
    avgRPE: s.avgRPE,
    sessionRPE: ses.sessionRPE ?? null,
    minutes: s.minutes,
    readiness: readiness?.score ?? null,
    bodyweight: bw?.value ?? null,
    startedAt: ses.startedAt || null,
    endedAt: ses.endedAt || null,
    notes: ses.notes || '',
  };
}

/**
 * Personal records as of this session, not as of now — flushing a backlog must
 * not credit an old session with beating a lift it was later beaten by.
 */
function prsFor(st, ses) {
  const startedAt = (id) => st.sessions.find((x) => x.id === id)?.startedAt || '';
  const mine = startedAt(ses.id);
  const unit = st.profile.units;
  const out = [];
  for (const e of ses.entries) {
    if (!(e.sets || []).some((s) => s.done)) continue;
    const hist = slotHistory(st, e.slotKey);
    const before = hist.filter((h) => h.sessionId !== ses.id && startedAt(h.sessionId) < mine);
    const now = hist.find((h) => h.sessionId === ses.id);
    if (!now || !before.length) continue;
    const prev = Math.max(...before.map((h) => h.best1RM || 0));
    if (prev > 0 && now.best1RM > prev) {
      out.push({ exercise: nameOf(e.exerciseId), gain: round3(now.best1RM - prev), e1rm: round3(now.best1RM), unit });
    }
  }
  return out;
}

/** What Discord should say. Formatted here, where the domain vocabulary lives. */
function discordCard(st, ses) {
  const s = stats(st, ses);
  const lines = ses.entries.map((e) => {
    const done = (e.sets || []).filter((x) => x.done);
    if (!done.length) return null;
    const detail = done.map((x) => `${fmtLoadBare(x.load)}×${x.reps ?? '?'}${x.rpe != null ? `@${fmtRPE(x.rpe)}` : ''}`).join(', ');
    return { exercise: nameOf(e.exerciseId), detail, note: e.note || '' };
  }).filter(Boolean);

  return {
    sessionId: ses.id,
    date: ses.date,
    // The script uses this to tell a session that just happened from history
    // being backfilled, so switching sync on does not replay months to Discord.
    endedAt: ses.endedAt || null,
    title: labelFor(st, ses),
    unit: s.unit,
    sets: s.sets,
    reps: s.reps,
    tonnage: s.tonnage,
    avgRPE: s.avgRPE,
    sessionRPE: ses.sessionRPE ?? null,
    minutes: s.minutes,
    lines,
    prs: prsFor(st, ses),
    notes: ses.notes || '',
  };
}

/* ---- the public projection --------------------------------------------- */

/**
 * What the world is allowed to see.
 *
 * This is an allowlist, not a redaction pass, and that direction is the whole
 * point: a field only becomes public because it is named here. Adding something
 * to the log can never quietly widen what is published, and the tests assert the
 * excluded fields by name so a future edit that leaks one fails CI.
 *
 * Out, deliberately: session and exercise notes (free text, unpredictable),
 * readiness check-ins (sleep, stress, soreness — health data), the session
 * difficulty rating, and everything in `profile` except a first name.
 *
 * Every number is kilos. A lifter who logs one lift in pounds still gets one
 * continuous axis, and the dashboard converts for display if asked.
 */
export function publicSnapshot(st) {
  const done = st.sessions.filter((s) => s.status === 'done').sort(byDate);
  const from = st.profile.units;
  const kg = (v) => (v == null ? null : round1(convertLoad(v, from, 'kg')));

  return {
    v: 1,
    generatedAt: new Date().toISOString(),
    athlete: { firstName: (st.profile.name || '').trim().split(/\s+/)[0] || null },
    unit: 'kg',
    displayUnit: from,
    totals: totals(st, done),
    lifts: LIFTS.map((l) => liftBlock(st, l, kg)),
    prs: prTable(st, done),
    lastSession: done.length ? sessionDetail(st, done[done.length - 1]) : null,
    sessions: done.map((ses) => sessionSummary(st, ses)),
    bodyweight: (st.bodyweightLog || []).slice().sort(byDate).map((b) => ({ date: b.date, kg: kg(b.value) })),
  };
}

const LIFTS = [
  { lift: 'squat', label: 'Squat' },
  { lift: 'bench', label: 'Bench press' },
  { lift: 'deadlift', label: 'Deadlift' },
];

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const round1 = (n) => Math.round(n * 10) / 10;

function totals(st, done) {
  let sets = 0, reps = 0, tonnage = 0;
  for (const ses of done) {
    const u = ses.units || st.profile.units;
    for (const e of ses.entries) {
      for (const s of e.sets) {
        if (!s.done) continue;
        sets += 1;
        reps += s.reps || 0;
        tonnage += convertLoad(s.load || 0, u, 'kg') * (s.reps || 0);
      }
    }
  }
  return {
    sessions: done.length,
    sets,
    reps,
    tonnage: Math.round(tonnage),
    firstDate: done.length ? done[0].date : null,
    lastDate: done.length ? done[done.length - 1].date : null,
  };
}

/**
 * A lift's headline number and its history.
 *
 * `soft` and `deload` ride along per point because the app refuses to treat all
 * estimates alike — one from a set of nine, or from a deliberately light deload
 * week, is not evidence of peak capability. The dashboard renders those points
 * differently rather than letting them bend the line.
 */
function liftBlock(st, { lift, label }, kg) {
  const raw = strengthTrend(st, lift);
  const trend = raw.map((p) => ({
    date: p.date,
    value: kg(p.value),
    deload: !!p.deload,
    soft: !!p.estimatedFromHighReps,
  }));

  // The headline is the best hard estimate, on the same terms the app's own
  // Progress tab uses: nothing from a deload, nothing from a high-rep set.
  const hard = trend.filter((p) => !p.deload && !p.soft);
  const best = hard.length ? hard.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const tested = st.maxes[lift] || {};

  return {
    lift,
    label,
    e1rm: best ? best.value : null,
    e1rmDate: best ? best.date : null,
    tested: tested.value != null ? kg(tested.value) : null,
    testedDate: tested.date || null,
    change28: change(hard, 28),
    trend,
  };
}

/** Movement in the last N days, against the best estimate before that window. */
function change(points, days) {
  if (points.length < 2) return null;
  const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const recent = points.filter((p) => p.date >= cutoff);
  const older = points.filter((p) => p.date < cutoff);
  if (!recent.length || !older.length) return null;
  const now = Math.max(...recent.map((p) => p.value));
  const was = Math.max(...older.map((p) => p.value));
  return round1(now - was);
}

/** Best estimate per exercise, and the day it happened. */
function prTable(st, done) {
  const best = new Map();
  for (const ses of done) {
    const u = ses.units || st.profile.units;
    for (const e of ses.entries) {
      for (const s of e.sets) {
        if (!s.done || !(s.load > 0) || !(s.reps > 0) || s.rpe == null) continue;
        // Above six reps the estimate is not trustworthy enough to call a record.
        if (s.reps > 6) continue;
        const est = e1RM(convertLoad(s.load, u, 'kg'), s.reps, s.rpe);
        if (!(est > 0)) continue;
        const cur = best.get(e.exerciseId);
        if (!cur || est > cur.e1rm) {
          best.set(e.exerciseId, {
            exercise: nameOf(e.exerciseId),
            e1rm: round1(est),
            date: ses.date,
            load: round1(convertLoad(s.load, u, 'kg')),
            reps: s.reps,
            rpe: s.rpe,
          });
        }
      }
    }
  }
  return [...best.values()].sort((a, b) => b.e1rm - a.e1rm);
}

function sessionSummary(st, ses) {
  const u = ses.units || st.profile.units;
  const logged = ses.entries.flatMap((e) => e.sets.filter((s) => s.done).map((s) => ({ s, e })));
  const scored = logged.filter((x) => x.s.rpe != null);
  const targeted = logged.filter((x) => x.e.targetRPE != null);
  return {
    date: ses.date,
    label: labelFor(st, ses),
    cycle: ses.cycle, week: ses.week, day: ses.day, phase: ses.phase,
    sets: logged.length,
    reps: logged.reduce((n, x) => n + (x.s.reps || 0), 0),
    tonnage: Math.round(logged.reduce((n, x) => n + convertLoad(x.s.load || 0, u, 'kg') * (x.s.reps || 0), 0)),
    avgRPE: scored.length ? round1(scored.reduce((n, x) => n + x.s.rpe, 0) / scored.length) : null,
    // Paired with avgRPE this answers a question the raw numbers cannot: are you
    // actually hitting the prescribed effort, or drifting above or below it?
    avgTargetRPE: targeted.length ? round1(targeted.reduce((n, x) => n + x.e.targetRPE, 0) / targeted.length) : null,
    minutes: durationMinutes(ses),
  };
}

function sessionDetail(st, ses) {
  const u = ses.units || st.profile.units;
  return {
    ...sessionSummary(st, ses),
    unit: u,
    lifts: ses.entries.map((e) => {
      const done = e.sets.filter((s) => s.done);
      if (!done.length) return null;
      return {
        exercise: nameOf(e.exerciseId),
        detail: done.map((s) => `${fmtLoadBare(s.load)}×${s.reps ?? '?'}${s.rpe != null ? `@${fmtRPE(s.rpe)}` : ''}`).join(', '),
        topKg: round1(Math.max(...done.map((s) => convertLoad(s.load || 0, u, 'kg')))),
      };
    }).filter(Boolean),
    prs: prsFor(st, ses).map((p) => ({ exercise: p.exercise, gain: p.gain, e1rm: p.e1rm })),
  };
}

/* ---- triggers --------------------------------------------------------- */

let wired = false;

/**
 * Drain on the three moments a phone plausibly has signal again: the app is
 * opened, it comes back to the foreground, or the OS says the network is up.
 */
export function watch() {
  if (wired) return;
  wired = true;

  const kick = (reason) => () => { if (pendingCount()) flush({ reason }); };

  window.addEventListener('online', kick('online'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pendingCount()) flush({ reason: 'foreground' });
  });
  // Not on the first paint's critical path.
  setTimeout(kick('startup'), 2000);
}
