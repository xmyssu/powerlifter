/* ==========================================================================
   views/reference.js — the library: the principles behind the program
   ========================================================================== */

import { html, raw, esc, icon, $, $$, sheet } from '../ui.js';
import { fmtRPE, pctOf1RM } from '../rpe.js';
import { REFERENCE } from '../coach.js';
import { RPE_SCALE, ROLE_RANGES, VOLUME_BY_AGE, WARMUP, REST_GUIDE } from '../templates.js';
import { EXERCISES, SLOT_INFO } from '../exercises.js';

let tab = 'principles';

function view(ctx) {
  return html`
    <h1 style="margin-bottom:14px">Library</h1>
    <div class="seg seg--lg" style="margin-bottom:18px">
      <button class="seg__btn" data-tab="principles" aria-pressed="${tab === 'principles'}">Principles</button>
      <button class="seg__btn" data-tab="tables" aria-pressed="${tab === 'tables'}">Tables</button>
      <button class="seg__btn" data-tab="exercises" aria-pressed="${tab === 'exercises'}">Exercises</button>
    </div>
    ${raw(tab === 'principles' ? principlesTab() : tab === 'tables' ? tablesTab() : exercisesTab())}`;
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

/* ---- tables ----------------------------------------------------------- */

function tablesTab() {
  return `<div class="stack-lg">
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
      <p class="cite" style="margin-top:10px">p. 65.</p>
    </div>

    <div class="card">
      <div class="eyebrow" style="margin-bottom:4px">Percentage of your max, by reps and RPE</div>
      <p class="tiny dim" style="margin-bottom:10px">What the app uses to turn an RPE into a load. Read down for reps, across for RPE.</p>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Reps</th>${[10, 9, 8, 7, 6].map((r) => `<th class="r">${r}</th>`).join('')}</tr></thead>
        <tbody>${[1, 2, 3, 4, 5, 6, 8, 10, 12].map((reps) => `<tr>
          <td class="mono strong">${reps}</td>
          ${[10, 9, 8, 7, 6].map((rpe) => `<td class="r mono">${pctOf1RM(reps, rpe).toFixed(1)}</td>`).join('')}
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
}

export default { id: 'reference', render: view, mount };
