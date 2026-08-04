/* ==========================================================================
   views/settings.js — equipment, program, backup
   ========================================================================== */

import { html, raw, esc, icon, $, $$, sheet, toast, confirmSheet, fmtDate, restoreSheet } from '../ui.js';
import { PLATE_PRESETS, fmtLoadBare, plateLabel, minIncrement, e1RM, normalizeRPE, parseNum } from '../rpe.js';
import { templateOf, buildProgram, volumeAudit, convertUnits } from '../program.js';
import { EMPHASIS, TEMPLATES, INTERMEDIATE_PL, INTERMEDIATE_PL_3DAY, ADVANCED_ACCUMULATION, ADVANCED_INTENSIFICATION } from '../templates.js';
import { optionsForSlot, SLOT_INFO, byId } from '../exercises.js';
import { todayISO } from '../store.js';
import { APP_VERSION, canInstall, promptInstall } from '../app.js';

const LIFTS = [
  { key: 'squat', label: 'Squat' },
  { key: 'bench', label: 'Bench press' },
  { key: 'deadlift', label: 'Deadlift' },
];

function view(ctx) {
  const st = ctx.state;
  const p = st.profile;
  const tpl = templateOf(st.program);
  const opts = { barWeight: p.barWeight, plates: p.plates, microplates: p.microplates };

  return html`
    <h1 style="margin-bottom:20px">Settings</h1>

    <div class="stack-lg">
      <div class="stack-sm">
        <div class="eyebrow">Program</div>
        <div class="card">
          <div class="kv"><span class="kv__k">Running</span><span class="kv__v">${esc(tpl.name)}</span></div>
          <div class="kv"><span class="kv__k">Emphasis</span><span class="kv__v">${esc(EMPHASIS[st.program.emphasis]?.label || '—')}</span></div>
          <div class="kv"><span class="kv__k">Started</span><span class="kv__v">${esc(fmtDate(st.program.startDate))}</span></div>
        </div>
        <button class="pick" data-act="exercises">
          <div class="pick__body"><div class="pick__title">Exercise choices</div>
            <div class="pick__sub">Change which lift fills each slot</div></div>
          ${raw(icon('chevron', 'dim'))}
        </button>
        <button class="pick" data-act="emphasis">
          <div class="pick__body"><div class="pick__title">Emphasis</div>
            <div class="pick__sub">Shift the strength days toward volume or intensity</div></div>
          ${raw(icon('chevron', 'dim'))}
        </button>
        <button class="pick" data-act="switch">
          <div class="pick__body"><div class="pick__title">Switch program</div>
            <div class="pick__sub">Intermediate, or the advanced accumulation and intensification blocks</div></div>
          ${raw(icon('chevron', 'dim'))}
        </button>
      </div>

      <div class="stack-sm">
        <div class="eyebrow">Your maxes</div>
        <div class="card">
          ${raw(LIFTS.map(({ key, label }) => `<div class="kv">
            <span class="kv__k">${esc(label)}</span>
            <span class="kv__v mono">${fmtLoadBare(st.maxes[key]?.value)} ${esc(p.units)}
              <span class="tiny dim">${st.maxes[key]?.date ? esc(fmtDate(st.maxes[key].date)) : ''}</span></span>
          </div>`).join(''))}
        </div>
        <button class="btn btn--ghost btn--block" data-act="maxes">Update maxes</button>
        <p class="cite">These only seed your very first week. After that every load comes from what you have logged.</p>
      </div>

      <div class="stack-sm">
        <div class="eyebrow">Equipment</div>
        <div class="card">
          <div class="field" style="margin-bottom:14px">
            <div class="field__label">Units</div>
            <div class="seg">
              <button class="seg__btn" data-units="kg" aria-pressed="${p.units === 'kg'}">kg</button>
              <button class="seg__btn" data-units="lb" aria-pressed="${p.units === 'lb'}">lb</button>
            </div>
            <div class="field__hint">Changing units converts your maxes and equipment but leaves logged sets as they were recorded.</div>
          </div>
          <div class="field" style="margin-bottom:14px">
            <label class="field__label" for="bar">Bar weight</label>
            <input class="input input--num" id="bar" type="text" inputmode="decimal" value="${p.barWeight}" data-bar data-focus-key="bar">
          </div>
          <div class="field">
            <div class="field__label">Plate pairs</div>
            <div class="row wrap" style="gap:8px;margin-top:4px">
              ${raw(allPlates(p.units).map((pl) => `<button class="pill pill--lg" data-plate="${pl}"
                style="min-height:44px;padding:0 14px;${p.plates.includes(pl) ? 'background:var(--accent-wash);color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)' : ''}">${pl}</button>`).join(''))}
            </div>
            <div class="field__hint" style="margin-top:8px">
              Smallest jump: <b class="mono">${minIncrement(p.plates, { microplates: p.microplates })} ${esc(p.units)}</b>.
              ${esc(p.units === 'kg' ? '142.5' : '315')} would be ${esc(plateLabel(p.units === 'kg' ? 142.5 : 315, opts))} per side.
            </div>
          </div>
        </div>
      </div>

      <div class="stack-sm">
        <div class="eyebrow">In the gym</div>
        <div class="card">
          ${raw(toggle('restTimerAuto', 'Start the rest timer automatically', 'Begins counting the moment you log a set.', st))}
          ${raw(toggle('restBeep', 'Chime when rest is up', '', st))}
          ${raw(toggle('restVibrate', 'Vibrate when rest is up', iOSDevice() ? 'iPhones do not let a web app buzz on a timer — use the chime.' : '', st))}
          ${raw(toggle('keepAwake', 'Keep the screen on during a session', iOSDevice() ? 'On iPhone this needs iOS 18.4 or newer, added to your home screen.' : '', st))}
        </div>
      </div>

      <div class="stack-sm">
        <div class="eyebrow">Appearance</div>
        <div class="seg seg--lg">
          ${raw(['auto', 'dark', 'light'].map((t) => `<button class="seg__btn" data-theme="${t}" aria-pressed="${p.theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join(''))}
        </div>
      </div>

      <div class="stack-sm">
        <div class="eyebrow">Your data</div>
        <div class="banner">
          Everything lives on this device only. There is no account and no server, which means
          nobody else can see it — and also that nothing recovers it if you clear your browser data.
          Export a backup now and then.
        </div>
        <button class="btn btn--ghost btn--block" data-act="export">${raw(icon('download'))} Export backup</button>
        <button class="btn btn--ghost btn--block" data-act="import">${raw(icon('upload'))} Restore from backup</button>
        ${raw(st.settings.lastBackupAt ? `<p class="cite">Last export ${esc(fmtDate(st.settings.lastBackupAt.slice(0, 10)))}.</p>` : '')}
      </div>

      <div class="stack-sm">
        <div class="eyebrow">Install</div>
        ${raw(installCard())}
      </div>

      <div class="stack-sm">
        <div class="eyebrow">Danger</div>
        <button class="btn btn--danger btn--block" data-act="reset">Erase everything and start over</button>
      </div>

      <p class="cite" style="text-align:center;padding-top:8px">
        Powerlifter ${esc(APP_VERSION)} · methods from Eric Helms, Andy Morgan and Andrea Valdez,
        <em>The Muscle &amp; Strength Pyramid: Training</em>, 2nd edition. Buy the book.
      </p>
    </div>`;
}

const allPlates = (units) => (units === 'kg' ? [25, 20, 15, 10, 5, 2.5, 1.25, 0.5] : [45, 35, 25, 10, 5, 2.5, 1.25]);

function toggle(key, label, hint, st) {
  const on = !!st.settings[key];
  return `<div class="kv" style="align-items:center">
    <span class="kv__k grow">${esc(label)}${hint ? `<div class="tiny dim" style="margin-top:2px">${esc(hint)}</div>` : ''}</span>
    <button class="seg" data-toggle="${key}" style="padding:3px;flex:0 0 auto" aria-pressed="${on}">
      <span class="seg__btn" style="min-height:30px;padding:0 12px;${on ? '' : 'background:var(--surface-3);color:var(--text)'}">Off</span>
      <span class="seg__btn" style="min-height:30px;padding:0 12px;${on ? 'background:var(--accent);color:#fff' : ''}">On</span>
    </button>
  </div>`;
}

/**
 * iPhone or iPad, including iPadOS reporting itself as a Mac.
 *
 * Used to caveat the two gym toggles that behave differently there: iOS has no
 * Vibration API a timer can reach, and the wake lock needs iOS 18.4 and an
 * installed app. Both are feature-detected before use, so this only decides
 * whether to explain the difference, never whether to try.
 */
function iOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function installCard() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (isStandalone) {
    return `<div class="insight insight--good"><div class="insight__icon">${icon('check')}</div>
      <div><div class="insight__t">Installed</div><div class="insight__b">Running as an app. It works with no connection.</div></div></div>`;
  }
  return `<div class="card">
    ${iOSDevice()
      ? `<div class="small">Tap the <b>Share</b> button in Safari, then <b>Add to Home Screen</b>. It then opens
         full-screen like any other app and works offline.</div>`
      : `<div class="small">Install it to your home screen or desktop so it opens full-screen and works offline.</div>
         ${canInstall() ? `<button class="btn btn--primary btn--block" style="margin-top:12px" data-act="install">Install</button>`
           : `<div class="cite" style="margin-top:8px">Use your browser's install or "Add to Home screen" option.</div>`}`}
  </div>`;
}

/* ---- sheets ----------------------------------------------------------- */

function openExercises(ctx) {
  const st = ctx.state;
  const tpl = templateOf(st.program);
  const rows = [];
  for (const d of tpl.days) for (const slot of d.slots) rows.push({ slot, day: d });

  sheet({
    title: 'Exercise choices',
    body: `<div class="stack">
      ${tpl.days.map((d) => `<div class="stack-sm">
        <div class="eyebrow">Day ${d.n} · ${esc(d.label)}</div>
        ${d.slots.map((slot) => {
          const ex = byId(st.program.choices[slot.key]);
          const many = optionsForSlot(slot.slotType).length > 1;
          return `<button class="pick" ${many ? `data-slot="${esc(slot.key)}"` : 'disabled style="opacity:.55"'}>
            <div class="pick__body">
              <div class="pick__title">${esc(ex?.short || slot.slotType)}</div>
              <div class="pick__sub">${esc(SLOT_INFO[slot.slotType]?.label || slot.slotType)}</div>
            </div>
            ${many ? icon('chevron', 'dim') : ''}
          </button>`;
        }).join('')}
      </div>`).join('')}
      <p class="cite">Changing a lift resets its load anchor — the app re-learns it from your next session on it. Far from a meet the book encourages rotating your main-lift variation cycle to cycle; close to one, converge on the competition lifts.</p>
    </div>`,
    onMount(root) {
      for (const b of $$('[data-slot]', root)) {
        b.onclick = () => openSlotPicker(ctx, b.dataset.slot);
      }
    },
  });
}

function openSlotPicker(ctx, slotKey) {
  const st = ctx.state;
  const tpl = templateOf(st.program);
  let slotDef = null;
  for (const d of tpl.days) { const f = d.slots.find((x) => x.key === slotKey); if (f) slotDef = f; }
  if (!slotDef) return;
  const info = SLOT_INFO[slotDef.slotType] || {};
  const opts = optionsForSlot(slotDef.slotType, { preferFreeWeight: slotDef.slotType === 'horizontalPull' });
  const cur = st.program.choices[slotKey];

  sheet({
    title: info.label || slotDef.slotType,
    body: `<div class="stack">
      <p class="small muted">${esc(info.rule || '')}</p>
      <div class="stack-sm">
        ${opts.map((e) => `<button class="pick" data-pick="${esc(e.id)}" aria-pressed="${e.id === cur}">
          <span class="pick__mark">${icon('check')}</span>
          <div class="pick__body"><div class="pick__title">${esc(e.short)}</div>
          ${e.notes ? `<div class="pick__sub">${esc(e.notes.length > 150 ? e.notes.slice(0, 150) + '…' : e.notes)}</div>` : ''}</div>
        </button>`).join('')}
      </div>
    </div>`,
    onMount(root, close) {
      for (const b of $$('[data-pick]', root)) {
        b.onclick = () => {
          const id = b.dataset.pick;
          ctx.store.update((s) => {
            if (s.program.choices[slotKey] !== id) {
              s.program.choices[slotKey] = id;
              s.program.slots[slotKey].week1Load = null;   // re-anchor from the next session
            }
          });
          close();
          toast('Changed.');
        };
      }
    },
  });
}

function openEmphasis(ctx) {
  const cur = ctx.state.program.emphasis;
  sheet({
    title: 'Emphasis',
    body: `<div class="stack-sm">
      ${Object.entries(EMPHASIS).map(([id, e]) => `<button class="pick" data-e="${id}" aria-pressed="${cur === id}">
        <span class="pick__mark">${icon('check')}</span>
        <div class="pick__body"><div class="pick__title">${esc(e.label)}</div><div class="pick__sub">${esc(e.note)}</div></div>
      </button>`).join('')}
      <p class="cite">Applies to the Day 3 and Day 4 strength slots. Takes effect from your next session.</p>
    </div>`,
    onMount(root, close) {
      for (const b of $$('[data-e]', root)) {
        b.onclick = () => {
          ctx.store.update((s) => { s.program.emphasis = b.dataset.e; });
          close(); toast('Emphasis updated.');
        };
      }
    },
  });
}

function openSwitch(ctx) {
  const st = ctx.state;
  const cur = st.program.templateId;
  const choices = [INTERMEDIATE_PL, INTERMEDIATE_PL_3DAY, ADVANCED_ACCUMULATION, ADVANCED_INTENSIFICATION];

  sheet({
    title: 'Switch program',
    body: `<div class="stack">
      <div class="banner banner--warn">Starting a different program resets your cycle position and load
      anchors. Your logged history and maxes are kept, and load suggestions rebuild from them.</div>
      <div class="stack-sm">
        ${choices.map((t) => `<button class="pick" data-t="${esc(t.id)}" aria-pressed="${cur === t.id}">
          <span class="pick__mark">${icon('check')}</span>
          <div class="pick__body">
            <div class="pick__title">${esc(t.name)}${t.adapted ? ` <span class="pill pill--info">adapted</span>` : ''}</div>
            <div class="pick__sub">${esc(t.daysPerWeek)} days/week · ${esc(t.cycleWeeks)}-week cycle${t.character ? ` · ${esc(t.character.slice(0, 110))}…` : ''}</div>
          </div>
        </button>`).join('')}
      </div>
      <p class="cite">The four-day program is the one the book prints, and the one to use if you can train four times a week. The three-day is an adaptation, not a printed template: it keeps every working set and the same weekly volume, but two of its days run to five exercises and the technique work loses its own dedicated day.</p>
      <p class="cite">The advanced blocks are meant to be sequenced: accumulation, then intensification, then a deload and either testing or a meet. Do not jump into intensification cold.</p>
    </div>`,
    onMount(root, close) {
      for (const b of $$('[data-t]', root)) {
        b.onclick = async () => {
          const id = b.dataset.t;
          if (id === cur) { close(); return; }
          const yes = await confirmSheet({
            title: `Switch to ${TEMPLATES[id].name}?`,
            message: 'Your cycle position resets to cycle 1, week 1, day 1. History is kept.',
            confirmLabel: 'Switch',
          });
          if (!yes) return;
          ctx.store.update((s) => {
            const old = s.program;
            s.program = buildProgram({
              templateId: id, emphasis: old.emphasis, startDate: todayISO(), meetDate: old.meetDate,
              choices: old.choices,
            });
            s.program.events.push({ date: todayISO(), kind: 'switched', from: old.templateId, to: id });
            s.profile.trainingAge = TEMPLATES[id].trainingAge || s.profile.trainingAge;
            s.profile.daysPerWeek = TEMPLATES[id].daysPerWeek || s.profile.daysPerWeek;
          });
          close();
          toast(`${TEMPLATES[id].name} started.`, 'good');
        };
      }
    },
  });
}

function openMaxes(ctx) {
  const st = ctx.state;
  const draft = {};
  for (const { key } of LIFTS) {
    const m = st.maxes[key] || {};
    draft[key] = { load: m.fromLoad ?? m.value ?? '', reps: m.reps ?? 3, rpe: m.fromRPE ?? 9 };
  }

  const est = (d) => {
    const v = e1RM(parseNum(d.load), parseNum(d.reps) || 1, normalizeRPE(d.rpe));
    return v ? Math.round(v * 10) / 10 : null;
  };

  sheet({
    title: 'Update maxes',
    body: `<div class="stack">
      <p class="small muted">Enter your best recent set of each. A 3-5 rep max is the book's preferred
      test — safer than a single and just as good an estimate.</p>
      ${LIFTS.map(({ key, label }) => `
        <div class="card card--flat">
          <div class="row-between" style="margin-bottom:10px">
            <b class="small">${esc(label)}</b>
            <span class="pill mono" data-est="${key}">${fmtLoadBare(est(draft[key]))} ${esc(st.profile.units)}</span>
          </div>
          <div class="row" style="gap:8px">
            <input class="input input--num grow" type="text" inputmode="decimal" value="${draft[key].load}" placeholder="weight" data-m="${key}" data-f="load">
            <input class="input input--num" style="flex:0 0 70px" type="text" inputmode="numeric" value="${draft[key].reps}" data-m="${key}" data-f="reps">
            <select class="select" style="flex:0 0 88px" data-m="${key}" data-f="rpe">
              ${[10, 9.5, 9, 8.5, 8, 7.5, 7].map((r) => `<option value="${r}" ${Number(draft[key].rpe) === r ? 'selected' : ''}>RPE ${r}</option>`).join('')}
            </select>
          </div>
        </div>`).join('')}
      <button class="btn btn--primary btn--block" data-save>Save</button>
    </div>`,
    onMount(root, close) {
      const repaint = () => {
        for (const { key } of LIFTS) {
          const el = $(`[data-est="${key}"]`, root);
          if (el) el.textContent = `${fmtLoadBare(est(draft[key]))} ${ctx.state.profile.units}`;
        }
      };
      for (const el of $$('[data-m]', root)) {
        const h = () => { draft[el.dataset.m][el.dataset.f] = el.value; repaint(); };
        if (el.tagName === 'SELECT') el.onchange = h; else el.oninput = h;
      }
      $('[data-save]', root).onclick = () => {
        ctx.store.update((s) => {
          for (const { key } of LIFTS) {
            const v = est(draft[key]);
            if (!v) continue;
            s.maxes[key] = {
              value: v, date: todayISO(), source: 'estimated',
              reps: parseNum(draft[key].reps) || null,
              fromLoad: parseNum(draft[key].load) || null,
              fromRPE: normalizeRPE(draft[key].rpe),
            };
          }
        });
        close(); toast('Maxes updated.', 'good');
      };
    },
  });
}

/* ---- backup ----------------------------------------------------------- */

function doExport(ctx) {
  const text = ctx.store.exportJSON();
  const name = ctx.store.exportFilename();
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  ctx.store.update((s) => { s.settings.lastBackupAt = new Date().toISOString(); }, { silent: true });
  toast('Backup saved.', 'good');
}

function doImport(ctx) {
  restoreSheet({
    store: ctx.store,
    warning: 'This replaces everything currently in the app — your program, history and settings. '
      + 'Export what you have first if you are not sure.',
    onRestored: () => ctx.go('today'),
  });
}

/* ---- mount ----------------------------------------------------------- */

function mount(root, ctx) {
  const st = ctx.state;

  $$('[data-units]', root).forEach((b) => b.onclick = async () => {
    const to = b.dataset.units;
    if (to === st.profile.units) return;
    const yes = await confirmSheet({
      title: `Switch to ${to === 'kg' ? 'kilograms' : 'pounds'}?`,
      message: 'Your maxes, bar and plates convert. Sets you already logged keep the numbers they were recorded with, so old and new entries will be in different units.',
      confirmLabel: 'Switch',
    });
    if (!yes) return;
    ctx.store.update((s) => { convertUnits(s, to); });
    toast('Units switched.');
  });

  const bar = $('[data-bar]', root);
  if (bar) bar.onchange = () => ctx.store.update((s) => { s.profile.barWeight = parseNum(bar.value) || s.profile.barWeight; });

  $$('[data-plate]', root).forEach((b) => b.onclick = () => {
    const pl = Number(b.dataset.plate);
    ctx.store.update((s) => {
      const has = s.profile.plates.includes(pl);
      s.profile.plates = (has ? s.profile.plates.filter((x) => x !== pl) : [...s.profile.plates, pl]).sort((a, c) => c - a);
    });
  });

  $$('[data-toggle]', root).forEach((b) => b.onclick = () => {
    const k = b.dataset.toggle;
    ctx.store.update((s) => { s.settings[k] = !s.settings[k]; });
    ctx.timer.setPrefs({ beep: ctx.state.settings.restBeep, vibrate: ctx.state.settings.restVibrate });
  });

  $$('[data-theme]', root).forEach((b) => b.onclick = () => {
    ctx.store.update((s) => { s.profile.theme = b.dataset.theme; });
  });

  const acts = {
    exercises: () => openExercises(ctx),
    emphasis: () => openEmphasis(ctx),
    switch: () => openSwitch(ctx),
    maxes: () => openMaxes(ctx),
    export: () => doExport(ctx),
    import: () => doImport(ctx),
    install: async () => { await promptInstall(); ctx.refresh(); },
    reset: async () => {
      const yes = await confirmSheet({
        title: 'Erase everything?',
        message: 'Your program, every logged session, your maxes and your settings. This cannot be undone and there is no copy anywhere else.',
        confirmLabel: 'Erase it all', danger: true,
      });
      if (!yes) return;
      const sure = await confirmSheet({
        title: 'Really?',
        message: 'Last chance. Export a backup instead if there is any doubt.',
        confirmLabel: 'Yes, erase', danger: true,
      });
      if (!sure) return;
      ctx.store.resetAll();
      location.hash = '#/today';
      location.reload();
    },
  };
  $$('[data-act]', root).forEach((b) => b.onclick = () => acts[b.dataset.act]?.());
}

export default { id: 'settings', render: view, mount };
