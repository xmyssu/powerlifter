/* ==========================================================================
   store.js — persistence + state
   Synchronous write-through to localStorage on every mutation, so a crashed
   tab or a phone that dies mid-set never loses a logged set.
   ========================================================================== */

const KEY = 'plv2:state';
const BACKUP_KEY = 'plv2:state:prev';
export const SCHEMA_VERSION = 2;

/** Deep clone that survives our plain-data state (no Dates stored, ISO strings only). */
const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

export function todayISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/* ---- default state ---------------------------------------------------- */

export function defaultState() {
  return {
    v: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    onboarded: false,

    profile: {
      name: '',
      units: 'kg',
      bodyweight: null,
      sex: null,
      trainingAge: 'intermediate',
      daysPerWeek: 4,
      barWeight: 20,
      // plate pairs available, heaviest first (kg)
      plates: [25, 20, 15, 10, 5, 2.5, 1.25],
      microplates: true,
      equipment: ['barbell', 'rack', 'bench', 'pullupBar', 'dumbbells', 'cable', 'legPress'],
      theme: 'auto',
    },

    /** Working maxes per main lift. value in profile.units. */
    maxes: {
      squat:    { value: null, date: null, source: null, reps: null },
      bench:    { value: null, date: null, source: null, reps: null },
      deadlift: { value: null, date: null, source: null, reps: null },
    },

    program: null,          // see program.js buildProgram()
    sessions: [],           // completed + in-progress session logs
    activeSessionId: null,

    readiness: [],          // [{date, sleep, stress, soreness, motivation, score}]
    bodyweightLog: [],      // [{date, value}]

    /**
     * Cloud sync (sync.js). `token` is the only secret the device holds and it
     * is stripped from every export, so it never travels with a backup.
     */
    sync: {
      enabled: false,
      endpoint: '',           // Apps Script web app /exec URL
      token: '',
      queue: [],              // session ids waiting to be pushed
      syncing: false,
      lastSyncAt: null,
      lastError: null,
      failures: 0,
      nextAttemptAt: null,
      lastResult: null,       // {sessions, sets, discord, sheetUrl}
    },

    settings: {
      restTimerAuto: true,
      restBeep: true,
      restVibrate: true,
      keepAwake: true,
      plateHelper: true,
      confirmDeload: true,
      lastBackupAt: null,
    },

    meta: { lastOpenedAt: null, appVersion: null },
  };
}

/* ---- migrations ------------------------------------------------------- */

const MIGRATIONS = {
  // 1 -> 2: record which unit each session's loads were written in.
  //
  // Switching units deliberately leaves logged sets alone, so without this a
  // session's numbers are ambiguous the moment the lifter switches and the app
  // has no way to render old and new history on one axis. Anything already on
  // disk predates the first switch this build can record, so it was written in
  // whatever unit the profile is in now.
  2(s) {
    for (const ses of s.sessions || []) {
      if (!ses.units) ses.units = s.profile?.units || 'kg';
    }
    return s;
  },
};

function migrate(state) {
  let s = state;
  while ((s.v || 0) < SCHEMA_VERSION) {
    const next = (s.v || 0) + 1;
    const fn = MIGRATIONS[next];
    if (!fn) { s.v = SCHEMA_VERSION; break; }
    s = fn(s);
    s.v = next;
  }
  return s;
}

/** Fill in any keys added since the save was written. */
function reconcile(saved) {
  const base = defaultState();
  const out = { ...base, ...saved };
  for (const k of ['profile', 'settings', 'meta', 'maxes', 'sync']) {
    out[k] = { ...base[k], ...(saved[k] || {}) };
  }
  // A restored snapshot carries an empty queue and a stale in-flight flag.
  if (!Array.isArray(out.sync.queue)) out.sync.queue = [];
  out.sync.syncing = false;
  for (const lift of ['squat', 'bench', 'deadlift']) {
    out.maxes[lift] = { ...base.maxes[lift], ...((saved.maxes || {})[lift] || {}) };
  }
  for (const k of ['sessions', 'readiness', 'bodyweightLog']) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  return out;
}

/* ---- the store -------------------------------------------------------- */

let state = load();
const subs = new Set();
let writeFailed = false;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    return migrate(reconcile(JSON.parse(raw)));
  } catch (err) {
    console.error('[store] load failed, trying backup', err);
    try {
      const raw = localStorage.getItem(BACKUP_KEY);
      if (raw) return migrate(reconcile(JSON.parse(raw)));
    } catch (e) { /* fall through */ }
    return defaultState();
  }
}

function persist() {
  try {
    const prev = localStorage.getItem(KEY);
    if (prev) localStorage.setItem(BACKUP_KEY, prev);   // one-deep undo against a bad write
    localStorage.setItem(KEY, JSON.stringify(state));
    writeFailed = false;
  } catch (err) {
    writeFailed = true;
    console.error('[store] PERSIST FAILED', err);
    document.dispatchEvent(new CustomEvent('store:writefail', { detail: err }));
  }
}

export function getState() { return state; }
export function didWriteFail() { return writeFailed; }

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

function emit() {
  for (const fn of subs) {
    try { fn(state); } catch (e) { console.error('[store] subscriber threw', e); }
  }
}

/**
 * Mutate state through a recipe fn. The recipe receives a draft it may mutate
 * freely; we persist synchronously before notifying subscribers.
 */
export function update(recipe, { silent = false } = {}) {
  const draft = clone(state);
  const ret = recipe(draft);
  state = ret === undefined ? draft : ret;
  persist();
  if (!silent) emit();
  return state;
}

/** Replace whole state (import / reset). */
export function replaceState(next) {
  state = migrate(reconcile(next));
  persist();
  emit();
  return state;
}

export function resetAll() {
  state = defaultState();
  persist();
  emit();
}

/* ---- backup / restore ------------------------------------------------- */

export function exportJSON() {
  // The sync token is deliberately left out: a backup file gets mailed to
  // yourself, dropped in cloud storage and handed over for debugging, and none
  // of that should hand over write access to your sheet. The endpoint stays so
  // a restore only needs the token retyped.
  const out = { ...state, sync: { ...state.sync, token: '', queue: [] }, exportedAt: new Date().toISOString() };
  return JSON.stringify(out, null, 2);
}

export function exportFilename() {
  return `powerlifter-backup-${todayISO()}.json`;
}

/** Returns {ok, error, summary} without mutating unless ok. */
export function importJSON(text, { apply = true } = {}) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { return { ok: false, error: 'Not valid JSON.' }; }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'Not a backup file.' };
  if (!('profile' in parsed) && !('sessions' in parsed)) {
    return { ok: false, error: 'This file does not look like a Powerlifter backup.' };
  }
  const summary = {
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions.length : 0,
    hasProgram: !!parsed.program,
    exportedAt: parsed.exportedAt || null,
  };
  if (apply) replaceState(parsed);
  return { ok: true, summary };
}

/** Ask the browser not to evict us. Best-effort; iOS ignores it but PWAs get better treatment. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) {
      const already = await navigator.storage.persisted?.();
      if (already) return true;
      return await navigator.storage.persist();
    }
  } catch (e) { /* ignore */ }
  return false;
}

export async function storageEstimate() {
  try { return await navigator.storage?.estimate?.(); } catch (e) { return null; }
}

/* ---- convenience selectors ------------------------------------------- */

export const sel = {
  units: () => state.profile.units,
  program: () => state.program,
  activeSession: () => state.sessions.find((s) => s.id === state.activeSessionId) || null,
  completedSessions: () => state.sessions.filter((s) => s.status === 'done'),
  sessionsFor: (exerciseId) =>
    state.sessions.filter((s) => s.status === 'done' && s.entries.some((e) => e.exerciseId === exerciseId)),
  lastSessionDate: () => {
    const done = state.sessions.filter((s) => s.status === 'done').map((s) => s.date).sort();
    return done.length ? done[done.length - 1] : null;
  },
  max: (lift) => state.maxes[lift]?.value ?? null,
};
