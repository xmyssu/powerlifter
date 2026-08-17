/* ==========================================================================
   app.js — shell, routing, and the glue between store and views
   ========================================================================== */

import * as store from './store.js';
import { $, icon, render, toast, esc } from './ui.js';
import * as timer from './timer.js';
import * as sync from './sync.js';

import onboarding from './views/onboarding.js';
import today from './views/today.js';
import session from './views/session.js';
import progress from './views/progress.js';
import coachview from './views/coachview.js';
import reference from './views/reference.js';
import settings from './views/settings.js';

const VIEWS = { onboarding, today, session, progress, coach: coachview, reference, settings };

const TABS = [
  { id: 'today',     label: 'Today',    ico: 'today' },
  { id: 'progress',  label: 'Progress', ico: 'progress' },
  { id: 'coach',     label: 'Coach',    ico: 'coach' },
  { id: 'reference', label: 'Library',  ico: 'book' },
  { id: 'settings',  label: 'Settings', ico: 'settings' },
];

const APP_VERSION = '1.0.0';

/* ---- routing ---------------------------------------------------------- */

let current = null;
let params = {};

function parseHash() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  const [route, query] = h.split('?');
  const p = {};
  if (query) for (const [k, v] of new URLSearchParams(query)) p[k] = v;
  return { route: route || 'today', params: p };
}

export function go(route, p = {}) {
  const q = new URLSearchParams(p).toString();
  location.hash = `#/${route}${q ? `?${q}` : ''}`;
}

const ctx = {
  go,
  get state() { return store.getState(); },
  get params() { return params; },
  refresh: () => draw(),
  store,
  timer,
};

function resolveRoute() {
  const st = store.getState();
  const { route, params: p } = parseHash();
  params = p;

  // Onboarding gates everything until there is a program to run.
  if (!st.onboarded || !st.program) return 'onboarding';
  if (!VIEWS[route]) return 'today';
  return route;
}

function draw() {
  const st = store.getState();
  const name = resolveRoute();
  const view = VIEWS[name];
  current = name;

  document.documentElement.dataset.theme = themeFor(st);
  document.body.dataset.view = name;
  document.body.dataset.keepAwake = st.settings.keepAwake && name === 'session' ? 'on' : 'off';

  const root = $('#view');
  render(root, view.render(ctx));
  view.mount?.(root, ctx);

  drawTabs(name, st);
  window.scrollTo({ top: 0 });
}

function drawTabs(activeName, st) {
  const bar = $('#tabbar');
  const hidden = activeName === 'onboarding' || activeName === 'session';
  bar.hidden = hidden;
  document.documentElement.style.setProperty('--tabbar-h', hidden ? '0px' : '60px');
  if (hidden) { bar.innerHTML = ''; return; }

  bar.innerHTML = TABS.map((t) => `
    <button class="tabbar__btn" data-tab="${t.id}" ${t.id === activeName ? 'aria-current="page"' : ''}>
      ${icon(t.ico)}<span>${t.label}</span>
    </button>`).join('');

  for (const btn of bar.querySelectorAll('[data-tab]')) {
    btn.onclick = () => go(btn.dataset.tab);
  }
}

function themeFor(st) {
  const pref = st.profile.theme;
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/* ---- lifecycle -------------------------------------------------------- */

window.addEventListener('hashchange', draw);
store.subscribe(() => {
  // Views re-render themselves after their own mutations; this catches
  // changes made from anywhere else (imports, resets, other tabs).
  if (current) draw();
});

document.addEventListener('store:writefail', () => {
  toast('Could not save — your device storage may be full.', 'bad', 6000);
});

window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (store.getState().profile.theme === 'auto') draw();
});

// keep another tab of the app in sync
window.addEventListener('storage', (e) => {
  if (e.key === 'plv2:state') { location.reload(); }
});

/* ---- install prompt (Android/desktop; iOS uses Share > Add to Home) --- */

// This has to be declared before the first draw(), not after it. The settings
// view calls canInstall() while rendering, so booting straight onto #/settings —
// a plain reload with that tab open — read `installEvent` inside its temporal
// dead zone, threw, and left the whole app blank.
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
});
export function canInstall() { return !!installEvent; }
export async function promptInstall() {
  if (!installEvent) return false;
  installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  return outcome === 'accepted';
}

/* ---- boot ------------------------------------------------------------- */

store.update((s) => {
  s.meta.lastOpenedAt = new Date().toISOString();
  s.meta.appVersion = APP_VERSION;
}, { silent: true });

timer.setPrefs({
  beep: store.getState().settings.restBeep,
  vibrate: store.getState().settings.restVibrate,
});

store.requestPersistence();
sync.watch();

if (!location.hash) location.hash = '#/today';
draw();

/* ---- service worker --------------------------------------------------- */

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Update downloaded — reopen the app to use it.', '', 5000);
          }
        });
      });
    }).catch(() => { /* offline support is a bonus, not a requirement */ });
  });
}

export { APP_VERSION };
