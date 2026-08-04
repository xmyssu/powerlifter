/* ==========================================================================
   ui.js — DOM helpers, icons, toasts, sheets
   ========================================================================== */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Escape for interpolation into HTML. */
export function esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Tagged template that escapes interpolations unless they are marked raw. */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) {
    out += one(vals[i]);
    out += strings[i + 1];
  }
  return out;
}

const one = (v) => (isRaw(v) ? String(v) : Array.isArray(v) ? v.map(one).join('') : esc(v));
const isRaw = (v) => !!v && typeof v === 'object' && v.__raw === true;

/**
 * Mark a string as pre-escaped HTML.
 *
 * It is a String object rather than a plain wrapper so that it also does the
 * right thing inside an ordinary template literal — dropping a raw() into a
 * plain backtick string used to stringify as "[object Object]", which is a
 * silent, easy mistake to make when a helper returns markup.
 */
export const raw = (value) => Object.assign(new String(value ?? ''), { __raw: true });

/* ---- icons (stroke, inherit currentColor) ----------------------------- */
const ICONS = {
  today:    '<path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>',
  progress: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  coach:    '<path d="M12 2a5 5 0 0 1 5 5c0 2-1 3-2 4s-1 2-1 3h-4c0-1 0-2-1-3s-2-2-2-4a5 5 0 0 1 5-5z"/><path d="M10 18h4M10 21h4"/>',
  book:     '<path d="M4 4v16a2 2 0 0 0 2 2h14V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z"/><path d="M8 4v18M12 9h5M12 13h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  check:    '<path d="M20 6L9 17l-5-5"/>',
  x:        '<path d="M18 6L6 18M6 6l12 12"/>',
  plus:     '<path d="M12 5v14M5 12h14"/>',
  minus:    '<path d="M5 12h14"/>',
  chevron:  '<path d="M9 18l6-6-6-6"/>',
  back:     '<path d="M15 18l-6-6 6-6"/>',
  timer:    '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  play:     '<path d="M6 4l14 8-14 8V4z"/>',
  pause:    '<path d="M7 4v16M17 4v16"/>',
  info:     '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
  warn:     '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  trend:    '<path d="M22 7l-8.5 8.5-4-4L2 19"/><path d="M16 7h6v6"/>',
  weight:   '<path d="M3 9v6M21 9v6M6 6v12M18 6v12M6 12h12"/>',
  swap:     '<path d="M7 4v13M4 14l3 3 3-3M17 20V7M20 10l-3-3-3 3"/>',
  note:     '<path d="M4 4h16v12l-4 4H4z"/><path d="M8 9h8M8 13h5"/>',
  trophy:   '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5M4 21h16"/>',
  upload:   '<path d="M12 17V5M7 9l5-5 5 5M4 21h16"/>',
  bolt:     '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
  rest:     '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
};

export function icon(name, cls = '') {
  const p = ICONS[name] || ICONS.info;
  // `.ico` carries the default size. Inline SVG has no intrinsic dimensions, so
  // without it a bare icon in a flex row stretches to fill the container.
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

/* ---- toast ------------------------------------------------------------ */
let toaster;
export function toast(msg, kind = '', ms = 2600) {
  if (!toaster) {
    toaster = document.createElement('div');
    toaster.className = 'toaster';
    toaster.setAttribute('role', 'status');
    toaster.setAttribute('aria-live', 'polite');
    document.body.appendChild(toaster);
  }
  const t = document.createElement('div');
  t.className = 'toast' + (kind ? ` toast--${kind}` : '');
  t.textContent = msg;
  toaster.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .2s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 220);
  }, ms);
}

/* ---- bottom sheet ---------------------------------------------------- */
let openSheet = null;

/**
 * Show a bottom sheet. `render` returns HTML; `onMount(root, close)` wires it up.
 */
export function sheet({ title, body, onMount, dismissable = true }) {
  closeSheet();
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" ${title ? `aria-label="${esc(title)}"` : ''}>
    <div class="sheet__grab"></div>
    ${title ? `<div class="sheet__title">${esc(title)}</div>` : ''}
    <div class="sheet__body">${body}</div>
  </div>`;
  document.body.appendChild(scrim);
  document.body.style.overflow = 'hidden';
  openSheet = scrim;

  if (dismissable) {
    scrim.addEventListener('click', (e) => { if (e.target === scrim) closeSheet(); });
  }
  const onKey = (e) => { if (e.key === 'Escape' && dismissable) closeSheet(); };
  document.addEventListener('keydown', onKey);
  scrim._cleanup = () => document.removeEventListener('keydown', onKey);

  onMount?.($('.sheet', scrim), closeSheet);
  // focus the first control for keyboard users
  const first = scrim.querySelector('button, input, select, textarea, [tabindex]');
  first?.focus({ preventScroll: true });
  return closeSheet;
}

export function closeSheet() {
  if (!openSheet) return;
  openSheet._cleanup?.();
  openSheet.remove();
  openSheet = null;
  document.body.style.overflow = '';
}

export function confirmSheet({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    sheet({
      title,
      body: `<p class="muted" style="margin-bottom:16px">${esc(message)}</p>
        <div class="stack-sm">
          <button class="btn btn--block ${danger ? 'btn--danger' : 'btn--primary'}" data-yes>${esc(confirmLabel)}</button>
          <button class="btn btn--block btn--ghost" data-no>Cancel</button>
        </div>`,
      onMount(root, close) {
        $('[data-yes]', root).onclick = () => { close(); resolve(true); };
        $('[data-no]', root).onclick = () => { close(); resolve(false); };
      },
    });
  });
}

/**
 * Pick a backup file, check it, and only then let it replace what is there.
 *
 * Shared by the settings screen and onboarding. The validate-before-apply order
 * is the whole point of keeping this in one place: it is all that stands between
 * picking the wrong file and losing a training history, and it must not end up
 * implemented two subtly different ways.
 */
export function restoreSheet({ store, title = 'Restore from backup', warning = '', onRestored }) {
  sheet({
    title,
    body: `<div class="stack">
      ${warning ? `<div class="banner banner--warn">${esc(warning)}</div>` : ''}
      <input class="input" type="file" accept="application/json,.json" data-file style="padding:12px">
      <div data-preview></div>
    </div>`,
    onMount(root, close) {
      $('[data-file]', root).onchange = async (e) => {
        const box = $('[data-preview]', root);
        const file = e.target.files?.[0];
        if (!file) return;

        let text;
        try {
          text = await file.text();
        } catch (err) {
          box.innerHTML = '<div class="banner banner--bad">Could not read that file.</div>';
          return;
        }

        const check = store.importJSON(text, { apply: false });
        if (!check.ok) {
          box.innerHTML = `<div class="banner banner--bad">${esc(check.error)}</div>`;
          return;
        }

        const { sessions, exportedAt } = check.summary;
        box.innerHTML = `<div class="stack-sm">
          <div class="banner banner--good">Valid backup — ${sessions} session${sessions === 1 ? '' : 's'}${exportedAt ? `, exported ${esc(fmtDate(String(exportedAt).slice(0, 10)))}` : ''}.</div>
          <button class="btn btn--primary btn--block" data-go>Restore it</button>
        </div>`;
        $('[data-go]', box).onclick = () => {
          const res = store.importJSON(text);
          close();
          if (res.ok) { toast('Restored.', 'good'); onRestored?.(res); }
          else toast(res.error, 'bad');
        };
      };
    },
  });
}

/* ---- render with focus preservation ---------------------------------- */

/**
 * Replace a container's contents while keeping the caret where it was, so a
 * state-driven re-render never interrupts typing.
 */
export function render(container, htmlStr) {
  const active = document.activeElement;
  const key = active && container.contains(active) ? active.dataset.focusKey : null;
  const selStart = key ? active.selectionStart : null;
  const selEnd = key ? active.selectionEnd : null;
  const scrollY = window.scrollY;

  container.innerHTML = htmlStr;

  if (key) {
    const next = container.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
    if (next) {
      next.focus({ preventScroll: true });
      try { next.setSelectionRange(selStart, selEnd); } catch (e) { /* not a text input */ }
    }
  }
  window.scrollTo({ top: scrollY });
}

/* ---- misc ------------------------------------------------------------- */

export function haptic(ms = 12) {
  try { navigator.vibrate?.(ms); } catch (e) { /* unsupported */ }
}

export function fmtDate(iso, { weekday = false } = {}) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: weekday ? 'short' : undefined, day: 'numeric', month: 'short',
    year: dt.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

export function relDays(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((then - now) / 86400000);
}

export function fmtDuration(sec) {
  if (sec == null) return '—';
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Inline sparkline/trend line for the progress cards. */
export function sparkline(values, { w = 120, h = 34, stroke = 'var(--accent)' } = {}) {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return '';
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  const step = w / (pts.length - 1);
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 4) - 2).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="none" aria-hidden="true" style="overflow:visible">
    <path d="${d}" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${((pts.length - 1) * step).toFixed(1)}" cy="${(h - ((pts[pts.length - 1] - min) / span) * (h - 4) - 2).toFixed(1)}" r="2.5" fill="${stroke}"/>
  </svg>`;
}
