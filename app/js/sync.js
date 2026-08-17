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
import { nameOf } from './exercises.js';

/** Bumped when the payload shape changes in a way the script must know about. */
export const PROTOCOL = 1;

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
    return { ok: true, sheetUrl: res.sheetUrl || null, discord: !!res.discordConfigured };
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

function stats(st, ses) {
  const unit = ses.units || st.profile.units;
  const sets = ses.entries.flatMap((e) => (e.sets || []).filter((s) => s.done));
  const scored = sets.filter((s) => s.rpe != null);
  const tonnage = sets.reduce((n, s) => n + (s.load || 0) * (s.reps || 0), 0);
  const seconds = ses.startedAt && ses.endedAt
    ? Math.round((new Date(ses.endedAt) - new Date(ses.startedAt)) / 1000) : null;
  return {
    unit,
    sets: sets.length,
    reps: sets.reduce((n, s) => n + (s.reps || 0), 0),
    tonnage: Math.round(tonnage),
    tonnageKg: Math.round(convertLoad(tonnage, unit, 'kg')),
    avgRPE: scored.length ? round3(scored.reduce((n, s) => n + s.rpe, 0) / scored.length) : null,
    minutes: seconds == null ? null : Math.round(seconds / 60),
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
