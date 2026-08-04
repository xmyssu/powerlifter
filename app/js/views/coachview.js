/* ==========================================================================
   views/coachview.js — the decisions the book would make for you
   ========================================================================== */

import { html, raw, esc, icon, $, $$, sheet, toast, confirmSheet, fmtDate, relDays } from '../ui.js';
import { fmtLoadBare, fmtRPE, loadFor } from '../rpe.js';
import { activeInsights, PLATEAU_TREE, PAIN_PROTOCOL, FAULTS, STICKING_POINT_PREAMBLE } from '../coach.js';
import { graduationCheck, templateOf, slotHistory, slotE1RM, loadingWeeks } from '../program.js';
import { INTERMEDIATE_PEAK, DELOAD_CHECKLIST } from '../templates.js';
import { byId, optionsForSlot } from '../exercises.js';
import { todayISO } from '../store.js';

function view(ctx) {
  const st = ctx.state;
  const insights = activeInsights(st);
  const program = st.program;
  const tpl = templateOf(program);

  return html`
    <h1 style="margin-bottom:6px">Coach</h1>
    <p class="muted small" style="margin-bottom:20px">
      Every rule here is the book's, applied to what you have actually logged. Page numbers are
      included so you can go and disagree with it.
    </p>

    <div class="stack-lg">
      ${raw(insights.length ? `<div class="stack-sm">
        <div class="eyebrow">Right now</div>
        ${insights.map(insightCard).join('')}
      </div>` : `<div class="insight insight--good">
        <div class="insight__icon">${icon('check')}</div>
        <div><div class="insight__t">Nothing needs your attention</div>
        <div class="insight__b">No stalls, no deload due, no gap in training. Keep going.</div></div>
      </div>`)}

      <div class="stack-sm">
        <div class="eyebrow">Where you are</div>
        ${raw(statusCard(st, tpl))}
      </div>

      <div class="stack-sm">
        <div class="eyebrow">Tools</div>
        <button class="pick" data-tool="plateau">
          <div class="pick__body"><div class="pick__title">I have plateaued</div>
            <div class="pick__sub">Works through the book's flowchart in order, so you change one thing at a time.</div></div>
          ${raw(icon('chevron', 'dim'))}
        </button>
        <button class="pick" data-tool="fault">
          <div class="pick__body"><div class="pick__title">Fix a technical fault or sticking point</div>
            <div class="pick__sub">Which variation punishes the error you actually have — and why pausing at your sticking point is the wrong instinct.</div></div>
          ${raw(icon('chevron', 'dim'))}
        </button>
        <button class="pick" data-tool="pain">
          <div class="pick__body"><div class="pick__title">Something hurts</div>
            <div class="pick__sub">The decision chain, and when to stop reading apps and see a physio.</div></div>
          ${raw(icon('chevron', 'dim'))}
        </button>
        <button class="pick" data-tool="meet">
          <div class="pick__body"><div class="pick__title">Peak for a meet</div>
            <div class="pick__sub">${esc(program.meetDate ? `${fmtDate(program.meetDate)} — ${relDays(program.meetDate)} days out` : 'The four-week cycle, opener practice and the primer session.')}</div></div>
          ${raw(icon('chevron', 'dim'))}
        </button>
        <button class="pick" data-tool="checklist">
          <div class="pick__body"><div class="pick__title">Should I deload?</div>
            <div class="pick__sub">The five questions, any time you want them — not just at a cycle end.</div></div>
          ${raw(icon('chevron', 'dim'))}
        </button>
      </div>

      ${raw(stallCard(st, tpl))}
      ${raw(eventLog(st))}
    </div>`;
}

function insightCard(i) {
  const cls = { graduate: 'good', stall: 'warn', deloadDue: 'warn', layoff: 'info', meet: 'accent', assessment: 'accent' }[i.kind] || 'accent';
  const ico = { graduate: 'trophy', stall: 'warn', deloadDue: 'rest', layoff: 'info', meet: 'bolt', assessment: 'today' }[i.kind] || 'info';
  return `<div class="insight insight--${cls}">
    <div class="insight__icon">${icon(ico)}</div>
    <div><div class="insight__t">${esc(i.title)}</div><div class="insight__b">${esc(i.text)}</div></div>
  </div>`;
}

function statusCard(st, tpl) {
  const p = st.program;
  const weeks = loadingWeeks(p);
  const done = st.sessions.filter((s) => s.status === 'done').length;
  return `<div class="card">
    <div class="kv"><span class="kv__k">Program</span><span class="kv__v">${esc(tpl.name)}</span></div>
    <div class="kv"><span class="kv__k">Position</span><span class="kv__v">${p.cursor.phase === 'deload' ? 'Deload week' : `Cycle ${p.cursor.cycle}, week ${p.cursor.week} of ${weeks}`} · Day ${p.cursor.day}</span></div>
    <div class="kv"><span class="kv__k">Cycles since a deload</span><span class="kv__v">${p.cyclesSinceDeload}${p.cyclesSinceDeload >= 2 ? ' <span class="pill pill--warn">due</span>' : ''}</span></div>
    <div class="kv"><span class="kv__k">Sessions logged</span><span class="kv__v">${done}</span></div>
    ${p.meetDate ? `<div class="kv"><span class="kv__k">Meet</span><span class="kv__v">${esc(fmtDate(p.meetDate))}</span></div>` : ''}
  </div>`;
}

function stallCard(st, tpl) {
  const rows = [];
  for (const d of tpl.days) {
    for (const slot of d.slots) {
      const s = st.program.slots[slot.key];
      if (!s) continue;
      if (s.stalls > 0 || s.smallIncrement || s.extendedRange) {
        rows.push({ slot, s, day: d });
      }
    }
  }
  if (!rows.length) return '';
  return `<div class="stack-sm">
    <div class="eyebrow">Lifts with a history</div>
    <div class="card">
      ${rows.map(({ slot, s, day }) => `<div class="kv">
        <span class="kv__k">${esc(byId(st.program.choices[slot.key])?.short || slot.slotType)} <span class="dim tiny">D${day.n}</span></span>
        <span class="kv__v" style="font-size:.813rem">
          ${s.stalls ? `<span class="pill pill--warn">${s.stalls} stall${s.stalls > 1 ? 's' : ''}</span>` : ''}
          ${s.smallIncrement ? `<span class="pill">small jumps</span>` : ''}
          ${s.extendedRange ? `<span class="pill">wide range</span>` : ''}
        </span>
      </div>`).join('')}
      <p class="cite" style="margin-top:10px">After a stall the book halves your weekly increment and restarts the next cycle 5-10% lighter. That has already been applied.</p>
    </div>
  </div>`;
}

function eventLog(st) {
  const ev = [...(st.program.events || [])].reverse().slice(0, 12);
  if (!ev.length) return '';
  const label = {
    assessment: 'Checklist run', cycleStart: 'Cycle started', stallReset: 'Stall reset applied',
    graduated: 'Moved to advanced', deload: 'Deload',
  };
  return `<details class="acc">
    <summary class="acc__head" style="list-style:none;cursor:pointer">${icon('chevron')}<b>Program log</b></summary>
    <div class="acc__body">
      ${ev.map((e) => `<div class="kv">
        <span class="kv__k">${esc(fmtDate(e.date))}</span>
        <span class="kv__v" style="font-weight:550;font-size:.813rem">${esc(label[e.kind] || e.kind)}${e.verdict ? ` — ${esc(e.verdict)}` : ''}${e.cycle ? ` ${e.cycle}` : ''}</span>
      </div>`).join('')}
    </div>
  </details>`;
}

/* ---- plateau flowchart ------------------------------------------------ */

function openPlateau() {
  sheet({
    title: 'Working through a plateau',
    body: `<div class="stack">
      <p class="small muted">In this order. Each step is cheaper than the one after it, and skipping
      to "add volume" is the most common way to make a fatigue problem worse.</p>
      ${PLATEAU_TREE.map((n, i) => `
        <div class="card card--flat">
          <div class="row" style="gap:10px;align-items:flex-start">
            <div class="ex__num" style="margin-top:0">${i + 1}</div>
            <div class="grow">
              <div class="insight__t" style="font-size:.938rem">${esc(n.q)}</div>
              <div class="insight__b" style="margin-top:6px">${esc(n.ifNo || n.ifYes)}</div>
              <div class="insight__cite">${esc(n.cite)}</div>
            </div>
          </div>
        </div>`).join('')}
      <p class="cite">Volume changes are worth roughly 10% at a time and need a full cycle before you judge them. Anything faster is noise.</p>
    </div>`,
  });
}

/* ---- technical fault advisor ------------------------------------------ */

function openFault(ctx) {
  const lifts = ['Squat', 'Bench', 'Deadlift', 'Any'];
  sheet({
    title: 'Technical faults and sticking points',
    body: `<div class="stack">
      <div class="banner banner--warn">
        <b>${esc(STICKING_POINT_PREAMBLE.title)}</b>
        <ul style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
          ${STICKING_POINT_PREAMBLE.points.map((p) => `<li>${esc(p)}</li>`).join('')}
        </ul>
      </div>
      ${lifts.map((l) => {
        const f = FAULTS.filter((x) => x.lift === l);
        if (!f.length) return '';
        return `<div class="stack-sm">
          <div class="eyebrow">${esc(l === 'Any' ? 'Any lift' : l)}</div>
          ${f.map((x) => `<button class="pick" data-fault="${esc(x.id)}">
            <div class="pick__body"><div class="pick__title" style="font-weight:550;font-size:.875rem">${esc(x.fault)}</div></div>
            ${icon('chevron', 'dim')}
          </button>`).join('')}
        </div>`;
      }).join('')}
      <p class="cite">${esc(STICKING_POINT_PREAMBLE.cite)}</p>
    </div>`,
    onMount(root) {
      for (const b of $$('[data-fault]', root)) {
        b.onclick = () => showFault(ctx, b.dataset.fault);
      }
    },
  });
}

function showFault(ctx, id) {
  const f = FAULTS.find((x) => x.id === id);
  if (!f) return;
  const exs = f.exercises.map(byId).filter(Boolean);

  sheet({
    title: f.fault,
    body: `<div class="stack">
      <div class="card card--flat">
        <div class="eyebrow" style="margin-bottom:5px">What it means</div>
        <div class="small">${esc(f.cause)}</div>
      </div>
      <div class="card card--accent">
        <div class="eyebrow" style="margin-bottom:5px;color:var(--accent)">What to do</div>
        <div class="small">${esc(f.fix)}</div>
      </div>
      ${exs.length ? `<div class="stack-sm">
        <div class="eyebrow">Exercises</div>
        ${exs.map((e) => `<div class="card card--flat card--pad-sm">
          <b class="small">${esc(e.short)}</b>
          ${e.notes ? `<div class="tiny muted" style="margin-top:4px;line-height:1.5">${esc(e.notes)}</div>` : ''}
        </div>`).join('')}
        <button class="btn btn--ghost btn--block" data-apply="${esc(f.exercises[0])}">Use this as my variation</button>
      </div>` : ''}
      <p class="cite">p. ${f.page}.</p>
    </div>`,
    onMount(root, close) {
      const b = $('[data-apply]', root);
      if (b) b.onclick = () => { close(); applyVariation(ctx, b.dataset.apply); };
    },
  });
}

/** Offer the variation slots this exercise could legally fill. */
function applyVariation(ctx, exId) {
  const st = ctx.state;
  const ex = byId(exId);
  const tpl = templateOf(st.program);
  const targets = [];
  for (const d of tpl.days) {
    for (const slot of d.slots) {
      if (ex.slots.includes(slot.slotType)) targets.push({ slot, day: d });
    }
  }
  if (!targets.length) {
    toast(`${ex.short} does not fit any slot in this program.`, 'bad');
    return;
  }
  sheet({
    title: `Put ${ex.short} where?`,
    body: `<div class="stack-sm">
      ${targets.map(({ slot, day }) => `<button class="pick" data-slot="${esc(slot.key)}">
        <div class="pick__body">
          <div class="pick__title">Day ${day.n} · ${esc(day.label)}</div>
          <div class="pick__sub">currently ${esc(byId(st.program.choices[slot.key])?.short || slot.slotType)}</div>
        </div>
      </button>`).join('')}
    </div>`,
    onMount(root, close) {
      for (const b of $$('[data-slot]', root)) {
        b.onclick = () => {
          ctx.store.update((s) => { s.program.choices[b.dataset.slot] = exId; });
          close();
          toast(`${ex.short} set. Its load will re-anchor from your first session on it.`, 'good', 4200);
        };
      }
    },
  });
}

/* ---- pain ------------------------------------------------------------- */

function openPain() {
  const p = PAIN_PROTOCOL;
  sheet({
    title: p.title,
    body: `<div class="stack">
      <p class="small muted">${esc(p.intro)}</p>
      ${p.chain.map((c, i) => `<div class="insight insight--warn">
        <div class="insight__icon"><b style="font-size:.813rem">${i + 1}</b></div>
        <div><div class="insight__t">${esc(c.step)}</div><div class="insight__b">${esc(c.detail)}</div></div>
      </div>`).join('')}
      <div class="banner banner--warn">${esc(p.jointOnly)}</div>
      <div class="card card--flat">
        <div class="insight__t" style="margin-bottom:4px">${esc(p.bfr.title)}</div>
        <div class="small muted">${esc(p.bfr.detail)}</div>
      </div>
      <div class="banner banner--bad">${esc(p.escalate)}</div>
      <p class="cite">${esc(p.cite)}</p>
    </div>`,
  });
}

/* ---- meet planner ---------------------------------------------------- */

function openMeet(ctx) {
  const st = ctx.state;
  const p = st.program;
  const units = st.profile.units;
  const out = relDays(p.meetDate);

  const attempts = ['squat', 'bench', 'deadlift'].map((lift) => {
    const max = bestMaxFor(st, lift);
    if (!max) return { lift, max: null };
    return {
      lift, max,
      opener: round(loadFor(max, 3, 10), st),
      second: round(loadFor(max, 2, 10), st),
      third: round(max + (units === 'kg' ? 2.5 : 5), st),
    };
  });

  sheet({
    title: 'Peaking for a meet',
    body: `<div class="stack">
      <div class="field">
        <label class="field__label" for="md">Meet date</label>
        <input class="input" id="md" type="date" value="${esc(p.meetDate || '')}" data-md>
        ${p.meetDate ? `<div class="field__hint">${out >= 0 ? `${out} days away` : `${-out} days ago`}. The peaking cycle starts 4 weeks out.</div>` : ''}
      </div>

      <div class="stack-sm">
        <div class="eyebrow">The four-week cycle</div>
        ${[
          ['Weeks 1-2', 'Normal program, except Day 3 squat and bench and Day 4 deadlift drop from 3-5 reps to 1-3. The wave still runs: 3 reps, then 2, then 1.'],
          ['Week 3', 'Deload everything that is not a competition lift — including your squat and bench variations. Then reshuffle: Day 4 becomes squat, bench, deadlift in meet order, working up to a single at your opener on each. That single lands about 7 days out at RPE 7.5-8.5.'],
          ['Week 4 (meet week)', 'Deload the competition lifts too. Day 3 is your primer, 24-48 hours out: two singles at RPE 4 on squat, two on bench, one on deadlift, and nothing else. Day 4 is the meet.'],
        ].map(([k, v]) => `<div class="card card--flat">
          <div class="insight__t" style="font-size:.875rem">${esc(k)}</div>
          <div class="insight__b" style="margin-top:4px">${esc(v)}</div>
        </div>`).join('')}
      </div>

      <div class="stack-sm">
        <div class="eyebrow">Attempt selection</div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Lift</th><th class="r">Opener</th><th class="r">Second</th><th class="r">Third</th></tr></thead>
          <tbody>${attempts.map((a) => `<tr>
            <td>${esc(a.lift)}</td>
            ${a.max ? `<td class="r mono">${fmtLoadBare(a.opener)}</td><td class="r mono">${fmtLoadBare(a.second)}</td><td class="r mono">${fmtLoadBare(a.third)}</td>`
                    : `<td class="r dim" colspan="3">no data</td>`}
          </tr>`).join('')}</tbody>
        </table></div>
        <p class="cite">Open with your current 3RM, second attempt at your current 2RM, third at the next incremental PR if it is there. Computed from your logged estimated maxes, in ${esc(units)}.</p>
      </div>

      <button class="btn btn--primary btn--block" data-savemeet>Save meet date</button>
    </div>`,
    onMount(root, close) {
      $('[data-savemeet]', root).onclick = () => {
        const v = $('[data-md]', root).value;
        ctx.store.update((s) => { s.program.meetDate = v || null; });
        close();
        toast(v ? 'Meet date saved.' : 'Meet date cleared.');
      };
    },
  });
}

function bestMaxFor(st, lift) {
  const tpl = templateOf(st.program);
  let best = 0;
  for (const d of tpl.days) {
    for (const slot of d.slots) {
      if (slot.lift !== lift) continue;
      const e = slotE1RM(st, slot.key);
      if (e && e > best) best = e;
    }
  }
  return best || st.maxes[lift]?.value || null;
}

function round(v, st) {
  if (!v) return null;
  const step = st.profile.units === 'kg' ? 2.5 : 5;
  return Math.round(v / step) * step;
}

/* ---- standalone checklist -------------------------------------------- */

function openChecklist(ctx) {
  const answers = {};
  sheet({
    title: 'Should I deload?',
    body: `<div class="stack">
      <div class="stack-sm">
        ${DELOAD_CHECKLIST.map((c) => `<button class="pick" data-q="${c.key}" aria-pressed="false">
          <span class="pick__mark">${icon('check')}</span>
          <div class="pick__body"><div class="pick__title" style="font-weight:550">${esc(c.q)}</div></div>
        </button>`).join('')}
      </div>
      <div id="verdict"></div>
      <p class="cite">This is informational — it does not change your program. The real checklist runs
      automatically when you finish a cycle.</p>
    </div>`,
    onMount(root) {
      const paint = () => {
        const n = DELOAD_CHECKLIST.filter((c) => answers[c.key]).length;
        const onlyPain = n === 1 && answers.pain;
        const box = $('#verdict', root);
        const cls = n >= 2 ? 'good' : onlyPain ? 'warn' : '';
        const text = n >= 2
          ? `Yes to ${n} of 5 — deload. Lowest reps and lightest load of the wave, two-thirds of the sets.`
          : onlyPain
            ? 'Aches and pains only — do not deload. Run a normal week for volume and RPE but raise the reps to 12-20.'
            : `Yes to ${n} of 5 — carry on into the next cycle.`;
        box.innerHTML = `<div class="banner ${cls ? `banner--${cls}` : ''}">${esc(text)}</div>`;
      };
      for (const b of $$('[data-q]', root)) {
        b.onclick = () => {
          answers[b.dataset.q] = !answers[b.dataset.q];
          b.setAttribute('aria-pressed', String(!!answers[b.dataset.q]));
          paint();
        };
      }
      paint();
    },
  });
}

/* ---- mount ----------------------------------------------------------- */

function mount(root, ctx) {
  const tools = { plateau: openPlateau, fault: () => openFault(ctx), pain: openPain, meet: () => openMeet(ctx), checklist: () => openChecklist(ctx) };
  $$('[data-tool]', root).forEach((b) => b.onclick = () => tools[b.dataset.tool]?.());
}

export default { id: 'coach', render: view, mount };
