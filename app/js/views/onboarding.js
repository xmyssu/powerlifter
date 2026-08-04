/* ==========================================================================
   views/onboarding.js — first-run setup wizard
   ========================================================================== */

import { html, raw, esc, icon, $, $$, toast, sheet, closeSheet, restoreSheet } from '../ui.js';
import { PLATE_PRESETS, e1RM, fmtLoadBare, normalizeRPE, roundToLoadable, plateLabel, parseNum } from '../rpe.js';
import { EXERCISES, optionsForSlot, SLOT_DEFAULTS, SLOT_INFO, byId } from '../exercises.js';
import { INTERMEDIATE_PL, EMPHASIS, RPE_SCALE } from '../templates.js';
import { buildProgram, volumeAudit } from '../program.js';
import { todayISO } from '../store.js';

const LIFTS = [
  { key: 'squat',    label: 'Squat' },
  { key: 'bench',    label: 'Bench press' },
  { key: 'deadlift', label: 'Deadlift' },
];

/** Slots the lifter picks an exercise for, in the order they are asked. */
const CHOOSABLE = [
  { key: 'squat',       slotType: 'squat',           group: 'comp' },
  { key: 'bench',       slotType: 'bench',           group: 'comp' },
  { key: 'deadlift',    slotType: 'deadlift',        group: 'comp' },
  { key: 'd1_sqvar',    slotType: 'squatVariant',    group: 'var',  where: 'Day 1 — higher-rep squat work' },
  { key: 'd4_bevar',    slotType: 'benchVariant',    group: 'var',  where: 'Day 4 — bench variation, 6-8 reps' },
  { key: 'd1_verpull',  slotType: 'verticalPull',    group: 'acc',  where: 'Day 1' },
  { key: 'd2_verpush',  slotType: 'verticalPush',    group: 'acc',  where: 'Day 2' },
  { key: 'd3_horpull',  slotType: 'horizontalPull',  group: 'acc',  where: 'Day 3 — heavier row, 4-6 reps' },
  { key: 'd4_horpull',  slotType: 'horizontalPull2', group: 'acc',  where: 'Day 4 — higher-rep row' },
  { key: 'd3_legcurl',  slotType: 'legCurl',         group: 'acc',  where: 'Day 3' },
];

const STEPS = ['welcome', 'units', 'maxes', 'exercises', 'tune', 'review'];

// wizard-local state, seeded from the store on first render
let w = null;

function init(state) {
  if (w) return;
  const preset = PLATE_PRESETS[state.profile.units] || PLATE_PRESETS.kg;
  w = {
    step: 0,
    units: state.profile.units || 'kg',
    barWeight: state.profile.barWeight ?? preset.barWeight,
    plates: [...(state.profile.plates || preset.plates)],
    microplates: state.profile.microplates ?? true,
    bodyweight: state.profile.bodyweight ?? '',
    maxes: {
      squat:    { load: '', reps: 3, rpe: 9, known: null },
      bench:    { load: '', reps: 3, rpe: 9, known: null },
      deadlift: { load: '', reps: 3, rpe: 9, known: null },
    },
    choices: Object.fromEntries(CHOOSABLE.map((c) => [c.key, SLOT_DEFAULTS[c.slotType]])),
    emphasis: 'balanced',
    meetDate: '',
    startDate: todayISO(),
  };
}

/* ---- max estimation --------------------------------------------------- */

function estimatedMax(m) {
  if (m.known) return parseNum(m.known) || null;
  const load = parseNum(m.load);
  if (!load) return null;
  const est = e1RM(load, parseNum(m.reps) || 1, normalizeRPE(m.rpe));
  return est ? Math.round(est * 10) / 10 : null;
}

function allMaxesSet() {
  return LIFTS.every(({ key }) => estimatedMax(w.maxes[key]));
}

/* ---- render ----------------------------------------------------------- */

function view(ctx) {
  const st = ctx.state;
  init(st);
  const step = STEPS[w.step];

  return html`
    <div class="wiz">
      ${raw(w.step > 0 ? dots() : '')}
      ${raw({
        welcome: welcomeStep(),
        units: unitsStep(),
        maxes: maxesStep(),
        exercises: exercisesStep(),
        tune: tuneStep(),
        review: reviewStep(st),
      }[step])}
    </div>`;
}

function dots() {
  return `<div>
    <div class="wiz__dots">
      ${STEPS.slice(1).map((_, i) => {
        const n = i + 1;
        return `<div class="wiz__dot ${n === w.step ? 'wiz__dot--on' : n < w.step ? 'wiz__dot--done' : ''}"></div>`;
      }).join('')}
    </div>
    <div class="wiz__step" style="margin-top:8px">Step ${w.step} of ${STEPS.length - 1}</div>
  </div>`;
}

function nav({ back = true, next = true, nextLabel = 'Continue', nextDisabled = false } = {}) {
  return `<div class="wiz__nav">
    ${back ? `<button class="btn btn--ghost" data-back>${icon('back')}</button>` : ''}
    ${next ? `<button class="btn btn--primary btn--lg grow" data-next ${nextDisabled ? 'disabled' : ''}>${esc(nextLabel)}</button>` : ''}
  </div>`;
}

/* ---- step 0: welcome -------------------------------------------------- */

function welcomeStep() {
  return `
    <div class="stack-lg" style="padding-top:24px">
      <div>
        <div class="eyebrow">Powerlifter</div>
        <h1 style="font-size:2rem;margin-top:6px">Let's build your program.</h1>
      </div>
      <p class="muted" style="font-size:1.0rem;line-height:1.6">
        This runs the Intermediate Powerlifting Program from Eric Helms' <em>Muscle &amp; Strength
        Pyramid</em> — four days a week, three-week waves, loads driven by RPE rather than
        percentages of a max you tested months ago.
      </p>
      <div class="card card--flat">
        <div class="stack-sm">
          ${bullet('bolt', 'It tells you what to lift', 'Every session comes with sets, reps, a target RPE and a load suggestion built from what you actually did last week.')}
          ${bullet('trend', 'It works out whether you are progressing', 'Estimated maxes from your logged RPE, so you can see the trend without testing a single 1RM.')}
          ${bullet('coach', 'It runs the decisions for you', 'Deload checklists, stall protocols, the graduation criteria for moving up — all from the book, applied to your data.')}
          ${bullet('rest', 'It works with no signal', 'Everything lives on your phone. No account, no server, nothing to lose when the gym wifi drops.')}
        </div>
      </div>
      <p class="cite">
        This app implements the book's methods and cites them throughout, but it is not the book
        and it does not reproduce it. If you are training off this, read the original — the
        reasoning behind each rule is the valuable part.
      </p>
      ${nav({ back: false, nextLabel: 'Get started' })}

      <div class="center">
        <button class="btn btn--ghost btn--block" data-act="restore">${raw(icon('upload'))} Restore from a backup</button>
        <p class="cite" style="margin-top:8px">Coming back, or moving to a new phone? Load your export
        and pick up exactly where you left off — no need to build the program again.</p>
      </div>
    </div>`;
}

function bullet(ico, title, body) {
  return `<div class="insight insight--accent" style="border-left-width:3px">
    <div class="insight__icon">${icon(ico)}</div>
    <div><div class="insight__t">${esc(title)}</div><div class="insight__b">${esc(body)}</div></div>
  </div>`;
}

/* ---- step 1: units + equipment --------------------------------------- */

function unitsStep() {
  const preset = PLATE_PRESETS[w.units];
  const opts = { barWeight: w.barWeight, plates: w.plates, microplates: w.microplates };
  return `
    <div class="stack-lg">
      <div>
        <h1>Your setup</h1>
        <p class="muted small" style="margin-top:6px">So the app can round every load to something you can actually put on the bar.</p>
      </div>

      <div class="field">
        <div class="field__label">Units</div>
        <div class="seg seg--lg">
          <button class="seg__btn" data-units="kg" aria-pressed="${w.units === 'kg'}">Kilograms</button>
          <button class="seg__btn" data-units="lb" aria-pressed="${w.units === 'lb'}">Pounds</button>
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="bar">Bar weight</label>
        <input class="input input--num" id="bar" type="text" inputmode="decimal"
               value="${w.barWeight}" data-bar data-focus-key="bar">
      </div>

      <div class="field">
        <div class="field__label">Plate pairs you have</div>
        <div class="field__hint">Tap to toggle. The app assumes a matched pair of each.</div>
        <div class="row wrap" style="gap:8px;margin-top:4px">
          ${allPlates(w.units).map((p) => `
            <button class="pill pill--lg" data-plate="${p}"
              style="min-height:44px;padding:0 14px;${w.plates.includes(p) ? 'background:var(--accent-wash);color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)' : ''}">
              ${p}
            </button>`).join('')}
        </div>
      </div>

      <div class="card card--flat">
        <div class="small muted">With that set, a load of ${w.units === 'kg' ? '142.5' : '315'} would be
        <b class="mono">${esc(plateLabel(w.units === 'kg' ? 142.5 : 315, opts))}</b> per side,
        and the smallest jump you can make is <b class="mono">${esc(String(minStep(w.plates)))} ${esc(w.units)}</b>.</div>
      </div>

      <div class="field">
        <label class="field__label" for="bw">Bodyweight <span class="dim">(optional)</span></label>
        <input class="input input--num" id="bw" type="text" inputmode="decimal"
               value="${w.bodyweight}" placeholder="—" data-bw data-focus-key="bw">
      </div>

      ${nav()}
    </div>`;
}

const allPlates = (units) => (units === 'kg' ? [25, 20, 15, 10, 5, 2.5, 1.25, 0.5] : [45, 35, 25, 10, 5, 2.5, 1.25]);
const minStep = (plates) => (plates.length ? Math.min(...plates) * 2 : 0);

/* ---- step 2: maxes ---------------------------------------------------- */

function maxesStep() {
  return `
    <div class="stack-lg">
      <div>
        <h1>Where you are now</h1>
        <p class="muted small" style="margin-top:6px">
          The book's method is a 3-5 rep max rather than a true single — safer, and it estimates
          your max just as well. Put in your best recent set of each lift and how hard it was.
        </p>
      </div>

      ${LIFTS.map(({ key, label }) => maxCard(key, label)).join('')}

      <div class="banner">
        <b>Not sure?</b> Guess low. Week 1 asks for a first set at RPE 7-8, so if the suggestion
        is light you will feel it immediately and can adjust on the spot — and the app rewrites
        its suggestions from what you actually lift.
      </div>

      ${nav({ nextDisabled: !allMaxesSet() })}
    </div>`;
}

function maxCard(key, label) {
  const m = w.maxes[key];
  const est = estimatedMax(m);
  return `
    <div class="card">
      <div class="row-between" style="margin-bottom:12px">
        <b>${esc(label)}</b>
        ${est ? `<span class="pill pill--accent pill--lg mono">${fmtLoadBare(est)} ${esc(w.units)} max</span>`
              : `<span class="pill">needs a number</span>`}
      </div>
      <div class="row" style="gap:8px;align-items:flex-end">
        <div class="field grow">
          <label class="field__label" for="${key}-load">Weight</label>
          <input class="input input--num" id="${key}-load" type="text" inputmode="decimal"
                 value="${m.load}" placeholder="—" data-max="${key}" data-f="load" data-focus-key="${key}-load">
        </div>
        <div class="field" style="flex:0 0 84px">
          <label class="field__label" for="${key}-reps">Reps</label>
          <input class="input input--num" id="${key}-reps" type="text" inputmode="numeric"
                 value="${m.reps}" data-max="${key}" data-f="reps" data-focus-key="${key}-reps">
        </div>
        <div class="field" style="flex:0 0 92px">
          <label class="field__label" for="${key}-rpe">RPE</label>
          <select class="select" id="${key}-rpe" data-max="${key}" data-f="rpe">
            ${[10, 9.5, 9, 8.5, 8, 7.5, 7].map((r) => `<option value="${r}" ${Number(m.rpe) === r ? 'selected' : ''}>${r}</option>`).join('')}
          </select>
        </div>
      </div>
      ${est ? `<div class="cite" style="margin-top:10px">${m.reps} reps at RPE ${m.rpe} is ${Math.round((Number(m.load) / est) * 1000) / 10}% of your max, which puts your estimated max at ${fmtLoadBare(est)} ${esc(w.units)}.</div>` : ''}
    </div>`;
}

/* ---- step 3: exercise choices ---------------------------------------- */

function exercisesStep() {
  const groups = [
    { id: 'comp', title: 'Your competition lifts', sub: 'The three you are judged on.' },
    { id: 'var',  title: 'Main-lift variations',   sub: 'Chosen to attack a weak point, not for variety\'s sake.' },
    { id: 'acc',  title: 'Accessories',            sub: 'Swap any of these later, in the session itself.' },
  ];
  return `
    <div class="stack-lg">
      <div>
        <h1>Pick your lifts</h1>
        <p class="muted small" style="margin-top:6px">
          Sensible defaults are already set. Tap any to see the book's rule for that slot and the
          alternatives it allows.
        </p>
      </div>
      ${groups.map((g) => `
        <div class="stack-sm">
          <div><div class="eyebrow">${esc(g.title)}</div><div class="tiny dim" style="margin-top:3px">${esc(g.sub)}</div></div>
          ${CHOOSABLE.filter((c) => c.group === g.id).map((c) => {
            const ex = byId(w.choices[c.key]);
            return `<button class="pick" data-choose="${c.key}" aria-pressed="false">
              <div class="pick__body">
                <div class="pick__title">${esc(ex?.short || 'Choose')}</div>
                <div class="pick__sub">${esc(c.where || SLOT_INFO[c.slotType]?.label || '')}</div>
              </div>
              ${icon('chevron', 'dim')}
            </button>`;
          }).join('')}
        </div>`).join('')}
      ${nav()}
    </div>`;
}

function openPicker(key, ctx) {
  const c = CHOOSABLE.find((x) => x.key === key);
  const info = SLOT_INFO[c.slotType] || {};
  const preferFree = c.slotType === 'horizontalPull';
  const opts = optionsForSlot(c.slotType, { preferFreeWeight: preferFree });
  const cur = w.choices[key];

  sheet({
    title: info.label || 'Choose an exercise',
    body: `
      <div class="stack">
        <p class="small muted">${esc(info.rule || '')}</p>
        <div class="stack-sm">
          ${opts.map((e) => `
            <button class="pick" data-pick="${esc(e.id)}" aria-pressed="${e.id === cur}">
              <span class="pick__mark">${icon('check')}</span>
              <div class="pick__body">
                <div class="pick__title">${esc(e.short)}</div>
                ${e.notes ? `<div class="pick__sub">${esc(trim(e.notes, 150))}</div>` : ''}
              </div>
            </button>`).join('')}
        </div>
      </div>`,
    onMount(root, close) {
      for (const btn of $$('[data-pick]', root)) {
        btn.onclick = () => { w.choices[key] = btn.dataset.pick; close(); ctx.refresh(); };
      }
    },
  });
}

const trim = (s, n) => (s.length > n ? s.slice(0, n).replace(/[\s,;.]+\S*$/, '') + '…' : s);

/* ---- step 4: tuning -------------------------------------------------- */

function tuneStep() {
  return `
    <div class="stack-lg">
      <div>
        <h1>Emphasis</h1>
        <p class="muted small" style="margin-top:6px">
          The program ships balanced. You can shift the strength days toward volume or toward
          intensity — the book gives both re-tunings explicitly.
        </p>
      </div>

      <div class="stack-sm">
        ${Object.entries(EMPHASIS).map(([id, e]) => `
          <button class="pick" data-emphasis="${id}" aria-pressed="${w.emphasis === id}">
            <span class="pick__mark">${icon('check')}</span>
            <div class="pick__body">
              <div class="pick__title">${esc(e.label)}</div>
              <div class="pick__sub">${esc(e.note)}</div>
            </div>
          </button>`).join('')}
      </div>

      <div class="divider"></div>

      <div class="field">
        <label class="field__label" for="meet">Meet date <span class="dim">(optional)</span></label>
        <div class="field__hint">Set this whenever you know it. The app counts back four weeks and switches to the peaking cycle.</div>
        <input class="input" id="meet" type="date" value="${w.meetDate}" data-meet data-focus-key="meet">
      </div>

      <div class="field">
        <label class="field__label" for="start">First training day</label>
        <input class="input" id="start" type="date" value="${w.startDate}" data-start data-focus-key="start">
      </div>

      ${nav()}
    </div>`;
}

/* ---- step 5: review -------------------------------------------------- */

function reviewStep(st) {
  const program = buildProgram({
    templateId: INTERMEDIATE_PL.id,
    choices: w.choices,
    emphasis: w.emphasis,
    startDate: w.startDate,
    meetDate: w.meetDate || null,
  });
  const audit = volumeAudit({ ...st, program });

  return `
    <div class="stack-lg">
      <div>
        <h1>Ready</h1>
        <p class="muted small" style="margin-top:6px">Four days a week, three-week waves. Here is what that adds up to.</p>
      </div>

      <div class="card">
        <div class="eyebrow" style="margin-bottom:10px">Weekly volume</div>
        <div class="stack-sm">
          ${Object.entries(audit.cats).map(([k, v]) => volBar(k, v, audit.target.sets)).join('')}
        </div>
        <div class="cite" style="margin-top:12px">${esc(audit.target.note)}</div>
      </div>

      <div class="card">
        <div class="eyebrow" style="margin-bottom:10px">Your maxes</div>
        ${LIFTS.map(({ key, label }) => `<div class="kv">
          <span class="kv__k">${esc(label)}</span>
          <span class="kv__v mono">${fmtLoadBare(estimatedMax(w.maxes[key]))} ${esc(w.units)}</span>
        </div>`).join('')}
      </div>

      <div class="card">
        <div class="eyebrow" style="margin-bottom:10px">Week 1</div>
        ${INTERMEDIATE_PL.days.map((d) => `
          <div class="kv">
            <span class="kv__k">Day ${d.n} · ${esc(d.label)}</span>
            <span class="kv__v" style="font-weight:550;font-size:.813rem;text-align:right">${d.slots.map((s) => esc(byId(w.choices[s.key] || SLOT_DEFAULTS[s.slotType])?.short || s.slotType)).join(' · ')}</span>
          </div>`).join('')}
      </div>

      <div class="wiz__nav">
        <button class="btn btn--ghost" data-back>${icon('back')}</button>
        <button class="btn btn--primary btn--lg grow" data-finish>Start training</button>
      </div>
    </div>`;
}

function volBar(label, value, [lo, hi]) {
  const max = Math.max(hi + 5, value + 2);
  const inRange = value >= lo && value <= hi;
  return `<div class="vbar">
    <div class="row-between">
      <span class="small muted">${esc(label)}</span>
      <span class="small mono ${inRange ? '' : 'dim'}"><b>${value}</b> sets</span>
    </div>
    <div class="vbar__track">
      <div class="vbar__zone" style="left:${(lo / max) * 100}%;width:${((hi - lo) / max) * 100}%"></div>
      <div class="vbar__fill ${inRange ? 'vbar__fill--good' : ''}" style="width:${(value / max) * 100}%"></div>
    </div>
  </div>`;
}

/* ---- mount ----------------------------------------------------------- */

function mount(root, ctx) {
  const rerender = () => ctx.refresh();

  $$('[data-next]', root).forEach((b) => b.onclick = () => {
    if (STEPS[w.step] === 'maxes' && !allMaxesSet()) return;
    w.step = Math.min(STEPS.length - 1, w.step + 1);
    rerender();
  });
  $$('[data-back]', root).forEach((b) => b.onclick = () => { w.step = Math.max(0, w.step - 1); rerender(); });

  // A returning lifter should not have to build a program before they are
  // allowed to restore the one they already had.
  const restore = $('[data-act="restore"]', root);
  if (restore) {
    restore.onclick = () => restoreSheet({
      store: ctx.store,
      title: 'Restore from a backup',
      onRestored: () => { w = null; ctx.go('today'); },
    });
  }

  // units + equipment
  $$('[data-units]', root).forEach((b) => b.onclick = () => {
    w.units = b.dataset.units;
    const p = PLATE_PRESETS[w.units];
    w.barWeight = p.barWeight;
    w.plates = [...p.plates];
    rerender();
  });
  $$('[data-plate]', root).forEach((b) => b.onclick = () => {
    const p = Number(b.dataset.plate);
    w.plates = w.plates.includes(p) ? w.plates.filter((x) => x !== p) : [...w.plates, p].sort((a, b2) => b2 - a);
    rerender();
  });
  const bar = $('[data-bar]', root);
  if (bar) bar.oninput = () => { w.barWeight = parseNum(bar.value) ?? 0; };
  const bw = $('[data-bw]', root);
  if (bw) bw.oninput = () => { w.bodyweight = bw.value; };

  // maxes
  $$('[data-max]', root).forEach((el) => {
    const handler = () => {
      w.maxes[el.dataset.max][el.dataset.f] = el.value;
      rerender();
    };
    if (el.tagName === 'SELECT') el.onchange = handler;
    else el.oninput = debounce(handler, 350);
  });

  // exercise pickers
  $$('[data-choose]', root).forEach((b) => b.onclick = () => openPicker(b.dataset.choose, ctx));

  // tuning
  $$('[data-emphasis]', root).forEach((b) => b.onclick = () => { w.emphasis = b.dataset.emphasis; rerender(); });
  const meet = $('[data-meet]', root);
  if (meet) meet.onchange = () => { w.meetDate = meet.value; };
  const start = $('[data-start]', root);
  if (start) start.onchange = () => { w.startDate = start.value || todayISO(); };

  // finish
  const fin = $('[data-finish]', root);
  if (fin) fin.onclick = () => finish(ctx);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function finish(ctx) {
  const { store } = ctx;
  store.update((s) => {
    s.profile.units = w.units;
    s.profile.barWeight = parseNum(w.barWeight) || PLATE_PRESETS[w.units].barWeight;
    s.profile.plates = [...w.plates].sort((a, b) => b - a);
    s.profile.microplates = w.microplates;
    s.profile.bodyweight = parseNum(w.bodyweight);
    s.profile.trainingAge = 'intermediate';
    s.profile.daysPerWeek = 4;

    for (const { key } of LIFTS) {
      const m = w.maxes[key];
      const est = estimatedMax(m);
      s.maxes[key] = {
        value: est,
        date: todayISO(),
        source: m.known ? 'entered' : 'estimated',
        reps: parseNum(m.reps) || null,
        fromLoad: parseNum(m.load) || null,
        fromRPE: normalizeRPE(m.rpe),
      };
    }
    if (parseNum(w.bodyweight) != null) s.bodyweightLog.push({ date: todayISO(), value: parseNum(w.bodyweight) });

    s.program = buildProgram({
      templateId: INTERMEDIATE_PL.id,
      choices: w.choices,
      emphasis: w.emphasis,
      startDate: w.startDate,
      meetDate: w.meetDate || null,
    });
    s.onboarded = true;
  });
  w = null;
  toast('Program built. Day 1 is ready.', 'good');
  ctx.go('today');
}

export default { id: 'onboarding', render: view, mount };
