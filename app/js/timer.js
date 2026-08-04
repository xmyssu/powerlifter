/* ==========================================================================
   timer.js — rest timer + screen wake lock
   --------------------------------------------------------------------------
   The timer is derived from a wall-clock timestamp rather than counted by an
   interval, so locking the phone, switching apps, or a throttled background
   tab cannot make it drift. The interval only repaints.
   ========================================================================== */

const LS_KEY = 'plv2:timer';

let state = load();
const listeners = new Set();
let tick = null;
let audioCtx = null;

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return { startedAt: null, duration: 0, label: '', notified: false };
}

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  const snap = snapshot();
  for (const fn of listeners) { try { fn(snap); } catch (e) { console.error(e); } }
}

export function snapshot() {
  if (!state.startedAt) return { running: false, remaining: 0, duration: 0, elapsed: 0, label: '', overdue: false };
  const elapsed = (Date.now() - state.startedAt) / 1000;
  const remaining = state.duration - elapsed;
  return {
    running: true,
    duration: state.duration,
    elapsed,
    remaining,
    label: state.label,
    overdue: remaining <= 0,
    progress: Math.min(1, elapsed / (state.duration || 1)),
  };
}

export function start(seconds, label = 'Rest') {
  state = { startedAt: Date.now(), duration: Math.max(1, Math.round(seconds)), label, notified: false };
  save();
  ensureTick();
  emit();
}

export function stop() {
  state = { startedAt: null, duration: 0, label: '', notified: false };
  save();
  if (tick) { clearInterval(tick); tick = null; }
  emit();
}

export function adjust(deltaSeconds) {
  if (!state.startedAt) return;
  state.duration = Math.max(5, state.duration + deltaSeconds);
  state.notified = false;
  save();
  emit();
}

function ensureTick() {
  if (tick) return;
  tick = setInterval(() => {
    const s = snapshot();
    if (!s.running) { clearInterval(tick); tick = null; return; }
    if (s.overdue && !state.notified) {
      state.notified = true;
      save();
      onElapsed();
    }
    emit();
  }, 250);
}

/* ---- completion feedback --------------------------------------------- */

let prefs = { beep: true, vibrate: true };
export function setPrefs(p) { prefs = { ...prefs, ...p }; }

function onElapsed() {
  if (prefs.vibrate) { try { navigator.vibrate?.([120, 80, 120]); } catch (e) {} }
  if (prefs.beep) beep();
}

/** Short two-tone chime via WebAudio — no asset to load, works offline. */
export function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    [[660, 0], [880, 0.16]].forEach(([freq, at]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + at);
      gain.gain.linearRampToValueAtTime(0.25, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + at + 0.34);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.36);
    });
  } catch (e) { /* audio unavailable */ }
}

/**
 * iOS will not play audio unless it was first unlocked by a user gesture.
 * Call this from the first tap of a session.
 */
export function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const b = audioCtx.createBuffer(1, 1, 22050);
    const src = audioCtx.createBufferSource();
    src.buffer = b;
    src.connect(audioCtx.destination);
    src.start(0);
  } catch (e) { /* ignore */ }
}

// resume ticking if the app reopens mid-rest
if (state.startedAt) {
  if (snapshot().remaining < -900) stop();   // stale by 15 min, forget it
  else ensureTick();
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.startedAt) { ensureTick(); emit(); }
});

/* ---- wake lock -------------------------------------------------------- */

let wakeLock = null;

export async function keepAwake(on) {
  try {
    if (on) {
      if (wakeLock || !('wakeLock' in navigator)) return !!wakeLock;
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
      return true;
    }
    await wakeLock?.release();
    wakeLock = null;
    return false;
  } catch (e) {
    wakeLock = null;
    return false;
  }
}

// re-acquire after the tab comes back, since the lock is dropped on hide
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && wakeLock === null && document.body?.dataset.keepAwake === 'on') keepAwake(true);
});
