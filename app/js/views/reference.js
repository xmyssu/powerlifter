/* ==========================================================================
   views/reference.js — the library: the principles behind the program
   ========================================================================== */

import { html, raw, esc, icon, $, $$, sheet, fmtDate } from '../ui.js';
import { fmtRPE, fmtLoadBare, pctOf1RM, parseNum, normalizeRPE, loadFor, rpeFor, roundToLoadable, loadStep,
         repsLeftWords, RPE_MIN, RPE_MAX } from '../rpe.js';
import { REFERENCE } from '../coach.js';
import { RPE_SCALE, ROLE_RANGES, VOLUME_BY_AGE, WARMUP, REST_GUIDE } from '../templates.js';
import { EXERCISES, SLOT_INFO, SLOT_DEFAULTS } from '../exercises.js';
import { loadOptsFor, easyMaxDetail, competitionChoice, RELIABLE_E1RM_REPS } from '../program.js';

let tab = 'principles';

function view(ctx) {
  return html`
    <h1 style="margin-bottom:14px">Library</h1>
    <div class="seg seg--lg" style="margin-bottom:18px">
      <button class="seg__btn" data-tab="principles" aria-pressed="${tab === 'principles'}">Principles</button>
      <button class="seg__btn" data-tab="tables" aria-pressed="${tab === 'tables'}">Tables</button>
      <button class="seg__btn" data-tab="exercises" aria-pressed="${tab === 'exercises'}">Exercises</button>
    </div>
    ${raw(tab === 'principles' ? principlesTab() : tab === 'tables' ? tablesTab(ctx.state) : exercisesTab())}`;
}

/* ---- principles ------------------------------------------------------- */

function principlesTab() {
  return `<div class="stack">
    ${REFERENCE.map((r) => `<details class="acc">
      <summary class="acc__head" style="list-style:none;cursor:pointer">${icon('chevron')}<b>${esc(r.title)}</b></summary>
      <div class="acc__body">
        ${r.body.map((p) => `<p>${esc(p)}</p>`).join('')}
        <p class="cite" style="margin-top:12px">${esc(r.cite)}</p>
      </div>
    </details>`).join('')}
    <p class="cite" style="margin-top:8px">
      These are summaries of the book's positions in my own words, with the page references so you
      can read the underlying argument and evidence. The reasoning is the part worth having.
    </p>
  </div>`;
}

/* ---- RPE calculator ---------------------------------------------------- */

/**
 * The RPE table, run both ways, against the lifter's own number.
 *
 * The %1RM grid further down is what the app turns an RPE into a load with, and
 * on its own it is homework: find the row, find the column, multiply by a max,
 * round to your plates — in a gym, on a phone, between sets. So the arithmetic
 * is done here, in the two directions a lifter actually asks it:
 *
 *  - "what should a triple at 8 be?" — reps and RPE to a weight, rounded onto
 *    the plates the lifter owns, because a number they cannot load is not an
 *    answer;
 *  - "what was that set, really?" — a weight and reps to the RPE the table says
 *    it is. This is the half that matters more. RPE calls are least accurate
 *    far from failure (Zourdos et al. 2016, JSCR 30(1); 2021, JSCR 35(S1)), and
 *    the book's answer is to use a percentage alongside RPE rather than instead
 *    of it (Helms, Pyramid Training v2, pp. 65-66). A lifter who called
 *    130 × 3 "RPE 5" on a technique day, against a squat max of 150, can see
 *    here that the table reads it as RPE 8 — and that the whole difference is a
 *    guess about reps he never did.
 *
 * The max is prefilled from the one the lifter recorded, not from the app's
 * working max, for the reason easy days are built from it (`easyMaxDetail` in
 * program.js): it is the lifter's own number, and a percentage is only as good
 * as the max it is a percentage of. With no max recorded the working max stands
 * in, and the hint under the box says which it is. Either way the box is
 * editable: "what if I am really 160?" should not need a trip to Settings.
 *
 * The state lives at module level so a redraw from elsewhere — a sync landing,
 * a tab switch — keeps what was typed, and the handlers repaint only the
 * results, so the box being typed in keeps its focus and its caret.
 */
const CALC_LIFTS = [
  { key: 'squat', label: 'Squat' },
  { key: 'bench', label: 'Bench' },
  { key: 'deadlift', label: 'Deadlift' },
  { key: 'other', label: 'Other' },
];

const calc = {
  lift: 'squat',
  typedMax: {},       // per chip: what the lifter typed over the prefill; absent means "use the prefill"
  reps: '3', rpe: '8',
  load: '', setReps: '3',
};

/** The %1RM grid's columns. RPE 5 and 4 are there because the program prescribes both. */
const GRID_RPES = [10, 9, 8, 7, 6, 5, 4];

/** Reps the calculator accepts: the table's own reach, and where `repsAt` stops counting. */
const CALC_MAX_REPS = 20;

/** A max is an estimate rather than a load: shown to a tenth, never snapped to the plates. */
const tenth = (v) => String(+Number(v).toFixed(1));

/**
 * The exercise a competition lift is loaded as, so an answer rounds onto that
 * exercise's grid rather than onto a guess.
 *
 * `competitionChoice` in program.js — the rule the test day and the meet use:
 * the strength day's main wins, any other non-technique slot for the lift is
 * the fallback — and the book's default exercise covers a program with neither.
 * For a barbell lift that is the profile's plates nine times in ten; it matters
 * for the tenth, whose squat lives on a machine they have told the app about.
 */
const competitionExercise = (state, lift) => competitionChoice(state, lift) || SLOT_DEFAULTS[lift] || null;

/** "Other" has no exercise, so it gets the lifter's bar and plates. */
const calcGrid = (state, lift) => loadOptsFor(state, lift === 'other' ? null : competitionExercise(state, lift));

/** What a chip prefills the max with, and where that number came from. */
function calcPrefill(state, lift) {
  if (lift === 'other') {
    return { value: null, source: null, hint: 'Any other exercise: type its max. Loads round to your bar and plates.' };
  }
  // The same figure the session card builds easy days from (`easyMaxDetail`):
  // the lower of the max the lifter recorded and the app's working max, the
  // record counting for six weeks from its date. A calculator that started from
  // anything else would answer "2 @ RPE 5" with a different weight from the
  // card it is being used to check.
  const rec = state.maxes?.[lift];
  const recV = Number(rec?.value) > 0 ? Number(rec.value) : null;
  const easy = easyMaxDetail(state, lift);
  if (easy?.basis === 'recorded') {
    return { value: +tenth(easy.value), source: 'recorded',
      hint: `The ${lift} max you recorded${rec?.date ? `, on ${fmtDate(rec.date)}` : ''}.` };
  }
  if (easy?.value > 0) {
    const why = recV == null ? `You have not recorded a ${lift} max, so this is the app's working max, read off your recent sets.`
      : recV > easy.value ? `The app's working max, lower than the ${tenth(recV)} you recorded — the app works from the lower of the two.`
      : `The app's working max. The ${tenth(recV)} you recorded${rec?.date ? ` on ${fmtDate(rec.date)}` : ''} is more than six weeks old, so it no longer holds the number down.`;
    return { value: +tenth(easy.value), source: 'working', hint: why };
  }
  if (recV != null) {
    return { value: +tenth(recV), source: 'recorded',
      hint: `The ${lift} max you recorded${rec?.date ? `, on ${fmtDate(rec.date)}` : ''}.` };
  }
  return { value: null, source: null, hint: `No ${lift} max on file yet. Type one to work from.` };
}

/** The max the calculator is working from: the typed figure if there is one, the prefill if not. */
function calcMax(state) {
  const pre = calcPrefill(state, calc.lift);
  const typed = calc.typedMax[calc.lift];
  const str = typed ?? (pre.value != null ? String(pre.value) : '');
  const n = parseNum(str);
  const value = n > 0 ? n : null;
  const own = typed != null && pre.value != null && value !== pre.value;
  const hint = own
    ? `Your own figure. ${pre.source === 'recorded' ? `The ${calc.lift} max you recorded is` : `The app's working ${calc.lift} max is`} ${tenth(pre.value)}.`
    : pre.hint;
  return { str, value, hint };
}

function wholeReps(v) {
  const n = parseNum(v);
  return Number.isInteger(n) && n >= 1 && n <= CALC_MAX_REPS ? n : null;
}

const calcPrompt = (text) => `<p class="small muted">${esc(text)}</p>`;

/** Reps and RPE to a weight on the lifter's plates. */
function loadResult(state, max) {
  const reps = wholeReps(calc.reps);
  const typed = parseNum(calc.rpe);
  if (max == null) return calcPrompt('Enter a max above to work from.');
  if (reps == null) return calcPrompt(`Reps: a whole number from 1 to ${CALC_MAX_REPS}.`);
  // Range-checked rather than clamped: normalizeRPE would quietly read a typed
  // 55 as RPE 10 and hand back a confident, wrong weight.
  if (typed == null || typed < RPE_MIN || typed > RPE_MAX) return calcPrompt(`RPE: a number from ${RPE_MIN} to ${RPE_MAX}.`);

  const rpe = normalizeRPE(typed);
  const grid = calcGrid(state, calc.lift);
  const pct = pctOf1RM(reps, rpe);
  const exact = loadFor(max, reps, rpe);
  const load = roundToLoadable(exact, grid);
  const notes = [];
  if (Math.abs(load - Number(tenth(exact))) > 1e-9) {
    notes.push(`${pct.toFixed(1)}% of ${tenth(max)} is ${tenth(exact)}; ${fmtLoadBare(load)} is the nearest you can load.`);
  }
  // Rounding up can tip a load into the next half point. Say so, and name the
  // weight under it — on an easy day the lighter one is the one to take.
  const after = rpeFor(max, load, reps);
  if (after != null && after > rpe) {
    const lighter = roundToLoadable(load - loadStep(grid), grid);
    if (lighter < load) notes.push(`Rounded up, that reads about RPE ${fmtRPE(after)}; ${fmtLoadBare(lighter)} keeps it at ${fmtRPE(rpe)}.`);
  }
  return `<div class="rx__box rx__box--load">
      <div class="rx__k">${reps} ${reps === 1 ? 'rep' : 'reps'} at RPE ${esc(fmtRPE(rpe))}</div>
      <div class="rx__v rx__v--hero">${esc(fmtLoadBare(load))} <small>${esc(state.profile.units)}</small></div>
      <div class="rx__sub">${esc(pct.toFixed(1))}% of ${esc(tenth(max))} · ${esc(repsLeftWords(rpe))}</div>
    </div>
    ${notes.length ? `<p class="tiny dim" style="margin-top:6px">${esc(notes.join(' '))}</p>` : ''}`;
}

/** A weight and reps to the RPE the table says they were, against the same max. */
function rpeResult(state, max) {
  const load = parseNum(calc.load);
  const reps = wholeReps(calc.setReps);
  if (max == null) return calcPrompt('Enter a max above to rate a set against.');
  if (!(load > 0) || reps == null) return calcPrompt('Type a weight and the reps you did with it.');

  const set = `${fmtLoadBare(load)} × ${reps}`;
  const used = (load / max) * 100;
  // `rpeFor` tops out at 10, so a set heavier than the max allows would read as
  // a plain RPE 10. It is not one: it is a max that is out of date.
  if (used > pctOf1RM(reps, RPE_MAX) + 1e-9) {
    return `<div class="insight insight--info">
      <div class="insight__icon">${icon('info')}</div>
      <div class="insight__b">${esc(set)} is more than a max of ${esc(tenth(max))} allows${reps > 1 ? ` for ${reps} reps` : ''}.
        If you did it, that max is out of date.</div>
    </div>`;
  }
  const light = used < pctOf1RM(reps, RPE_MIN) - 1e-9;
  // Reps left, in words, because "RPE 7" is a number people learn and "3 reps
  // left" is a thing they felt — in the app's one phrasing (`repsLeftWords`),
  // so the calculator and the session card say the same RPE the same way.
  // Under the floor `rpeFor` pins to RPE_MIN, whose words are "6+ reps left".
  const rpe = rpeFor(max, load, reps);
  return `<div class="rx__box">
      <div class="rx__k">${esc(set)} against ${esc(tenth(max))}</div>
      <div class="rx__v">${light ? `RPE ${RPE_MIN} or lighter` : `about RPE ${esc(fmtRPE(rpe))}`}</div>
      <div class="rx__sub">for you (${esc(repsLeftWords(rpe))}) · ${esc(used.toFixed(1))}% of the max</div>
    </div>
    ${reps > RELIABLE_E1RM_REPS ? `<p class="tiny dim" style="margin-top:6px">Above ${RELIABLE_E1RM_REPS} reps the table is a loose guide — it is where people differ most.</p>` : ''}`;
}

function calcCard(state) {
  const units = state.profile.units;
  const m = calcMax(state);
  const box = (id, key, label, value, mode) => `<div class="field grow">
      <label class="field__label" for="${id}">${esc(label)}</label>
      <input class="input input--num" id="${id}" type="text" inputmode="${mode}" autocomplete="off"
        value="${esc(value)}" data-calc-in="${key}" data-focus-key="${id}">
    </div>`;
  return `<div class="card" data-calc>
    <div class="eyebrow" style="margin-bottom:10px">RPE calculator</div>
    <div class="seg" style="margin-bottom:12px">
      ${CALC_LIFTS.map((l) => `<button class="seg__btn" data-calc-lift="${l.key}" aria-pressed="${calc.lift === l.key}">${esc(l.label)}</button>`).join('')}
    </div>
    <div class="field">
      <label class="field__label" for="calc-max">Max, ${esc(units)}</label>
      <input class="input input--num" id="calc-max" type="text" inputmode="decimal" autocomplete="off"
        value="${esc(m.str)}" data-calc-in="max" data-focus-key="calc-max">
      <div class="field__hint" data-calc-out="hint">${esc(m.hint)}</div>
    </div>

    <hr class="divider" style="margin:16px 0">
    <div class="small strong" style="margin-bottom:8px">What to load</div>
    <div class="row" style="gap:8px">
      ${box('calc-reps', 'reps', 'Reps', calc.reps, 'numeric')}
      ${box('calc-rpe', 'rpe', 'RPE', calc.rpe, 'decimal')}
    </div>
    <div style="margin-top:10px" data-calc-out="load" aria-live="polite">${loadResult(state, m.value)}</div>

    <hr class="divider" style="margin:16px 0">
    <div class="small strong" style="margin-bottom:8px">What a set was</div>
    <div class="row" style="gap:8px">
      ${box('calc-load', 'load', `Weight, ${units}`, calc.load, 'decimal')}
      ${box('calc-setreps', 'setReps', 'Reps', calc.setReps, 'numeric')}
    </div>
    <div style="margin-top:10px" data-calc-out="rpe" aria-live="polite">${rpeResult(state, m.value)}</div>

    <p class="cite" style="margin-top:14px">
      The percentages are the app's chart, built on the reps-in-reserve scale the book presents (pp. 64-65): RPE is
      10 minus the reps you had left. Calls far from failure are the least accurate: an RPE 5 is a guess about five
      reps you never did (Zourdos et al. 2016). That is why the book pairs RPE with a percentage (pp. 65-66), and why
      easy days are built from the lower of the max you recorded and the app's own, rather than from how the last one
      felt.
    </p>
  </div>`;
}

/** Wire the calculator: live results on every keystroke, without redrawing the inputs. */
function mountCalc(card, ctx) {
  const out = (k) => $(`[data-calc-out="${k}"]`, card);
  const maxIn = $('[data-calc-in="max"]', card);
  const paint = () => {
    const st = ctx.state;
    const m = calcMax(st);
    out('hint').textContent = m.hint;
    out('load').innerHTML = loadResult(st, m.value);
    out('rpe').innerHTML = rpeResult(st, m.value);
  };
  for (const b of $$('[data-calc-lift]', card)) {
    b.onclick = () => {
      calc.lift = b.dataset.calcLift;
      for (const x of $$('[data-calc-lift]', card)) x.setAttribute('aria-pressed', String(x === b));
      maxIn.value = calcMax(ctx.state).str;
      paint();
    };
  }
  for (const el of $$('[data-calc-in]', card)) {
    el.oninput = () => {
      const k = el.dataset.calcIn;
      if (k === 'max') calc.typedMax[calc.lift] = el.value;
      else calc[k] = el.value;
      paint();
    };
  }
}

/* ---- tables ----------------------------------------------------------- */

function tablesTab(state) {
  return `<div class="stack-lg">
    ${calcCard(state)}

    <div class="card">
      <div class="eyebrow" style="margin-bottom:10px">RPE, by reps left in the tank</div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>RPE</th><th>Reps in reserve</th><th>Meaning</th></tr></thead>
        <tbody>${RPE_SCALE.map((r) => `<tr>
          <td class="mono strong">${fmtRPE(r.rpe)}</td>
          <td class="mono">${esc(r.rir)}</td>
          <td class="small">${esc(r.meaning)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="cite" style="margin-top:10px">After p. 65. RPE 4–6 are read as exact reps in reserve (RPE = 10 − RIR), where the book groups 5–6 as "4 to 6 more".</p>
    </div>

    <div class="card">
      <div class="eyebrow" style="margin-bottom:4px">Percentage of your max, by reps and RPE</div>
      <p class="tiny dim" style="margin-bottom:10px">What the app uses to turn an RPE into a load. Read down for reps, across for RPE.
        The 5 and 4 columns are the technique and primer days.</p>
      <div class="tbl-wrap"><table class="tbl tbl--dense">
        <thead><tr><th>Reps</th>${GRID_RPES.map((r) => `<th class="r">${r}</th>`).join('')}</tr></thead>
        <tbody>${[1, 2, 3, 4, 5, 6, 8, 10, 12].map((reps) => `<tr>
          <td class="mono strong">${reps}</td>
          ${GRID_RPES.map((rpe) => `<td class="r mono">${pctOf1RM(reps, rpe).toFixed(1)}</td>`).join('')}
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="cite" style="margin-top:10px">
        Individual variation here is enormous — one study found 9 to 26 reps at 70% of a back squat
        max. Treat every number as a starting point that your own logged RPE then corrects.
      </p>
    </div>

    <div class="card">
      <div class="eyebrow" style="margin-bottom:10px">Reps and RPE by what the exercise is for</div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Role</th><th class="r">Reps</th><th class="r">RPE</th></tr></thead>
        <tbody>${ROLE_RANGES.map((r) => `<tr>
          <td><div class="small strong">${esc(r.role)}</div><div class="tiny dim">${esc(r.note)}</div></td>
          <td class="r mono">${esc(r.reps)}</td><td class="r mono">${esc(r.rpe)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="cite" style="margin-top:10px">p. 210.</p>
    </div>

    <div class="card">
      <div class="eyebrow" style="margin-bottom:10px">Volume and frequency by training age</div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Training age</th><th class="r">Sets / muscle / week</th><th class="r">Frequency</th></tr></thead>
        <tbody>${VOLUME_BY_AGE.map((r) => `<tr>
          <td>${esc(r.age)}</td><td class="r mono">${esc(r.sets)}</td><td class="r mono">${esc(r.freq)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="cite" style="margin-top:10px">p. 208.</p>
    </div>

    <div class="card">
      <div class="eyebrow" style="margin-bottom:10px">Rest periods</div>
      <div class="kv"><span class="kv__k">Compound lifts</span><span class="kv__v">at least 2.5 min</span></div>
      <div class="kv"><span class="kv__k">Smaller muscle groups</span><span class="kv__v">at least 1.5 min</span></div>
      <div class="kv"><span class="kv__k">Antagonist paired sets, upper body</span><span class="kv__v">about 2 min</span></div>
      <div class="kv"><span class="kv__k">Antagonist paired sets, isolation</span><span class="kv__v">about 1 min</span></div>
      <p class="cite" style="margin-top:10px">${esc(REST_GUIDE.principle)} p. 184.</p>
    </div>

    <div class="card">
      <div class="eyebrow" style="margin-bottom:10px">Warm-up ramps</div>
      <div class="row" style="gap:16px;align-items:flex-start">
        ${[WARMUP.lowRep, WARMUP.highRep].map((w) => `<div class="grow">
          <div class="small strong" style="margin-bottom:6px">${esc(w.label)}</div>
          <table class="tbl"><tbody>
            ${w.sets.map((s) => `<tr><td class="mono">${esc(String(s.reps))}</td>
              <td class="r mono">${s.pct ? `${s.pct}%` : esc(s.label || '')}</td></tr>`).join('')}
          </tbody></table>
        </div>`).join('')}
      </div>
      <p class="cite" style="margin-top:10px">Percentages of your working weight. p. 224.</p>
    </div>
  </div>`;
}

/* ---- exercises -------------------------------------------------------- */

function exercisesTab() {
  // Some exercises carry a compound category — "Main Lift / Squat Variants" —
  // and grouping on the raw string filed each of those alone under a name of its
  // own. That stranded the three competition lifts in one-item groups sorted
  // under M, and left "Squat Variants" without the squat in it. Split the string
  // and file the exercise under every group it names.
  const groups = new Map();
  for (const e of EXERCISES) {
    for (const c of String(e.category || 'Other').split('/').map((s) => s.trim()).filter(Boolean)) {
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(e);
    }
  }
  // The competition lifts are what the program is actually about, so they lead.
  const cats = [...groups.keys()].sort((a, b) => (
    a === MAIN_LIFT_CAT ? -1 : b === MAIN_LIFT_CAT ? 1 : a.localeCompare(b)));

  return `<div class="stack">
    <p class="small muted">Every exercise the book names, with its guidance. ${EXERCISES.length} in total.</p>
    ${cats.map((c) => `<details class="acc">
      <summary class="acc__head" style="list-style:none;cursor:pointer">
        ${icon('chevron')}<b>${esc(c)}</b>
        <span class="tiny dim">${groups.get(c).length}</span>
      </summary>
      <div class="acc__body">
        ${groups.get(c).map((e) => `<div style="padding:8px 0;border-bottom:1px solid var(--line-soft)">
          <div class="row-between" style="gap:8px">
            <b class="small">${esc(e.short)}</b>
            <span class="tiny dim nowrap">${esc((e.muscles || []).slice(0, 3).join(', '))}</span>
          </div>
          ${e.notes ? `<div class="tiny" style="margin-top:5px;line-height:1.55;color:var(--text-2)">${esc(e.notes)}</div>` : ''}
        </div>`).join('')}
      </div>
    </details>`).join('')}
  </div>`;
}

const MAIN_LIFT_CAT = 'Main Lift';

function mount(root, ctx) {
  $$('[data-tab]', root).forEach((b) => b.onclick = () => { tab = b.dataset.tab; ctx.refresh(); });
  const calcEl = $('[data-calc]', root);
  if (calcEl) mountCalc(calcEl, ctx);
}

export default { id: 'reference', render: view, mount };
