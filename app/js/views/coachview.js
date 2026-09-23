/* ==========================================================================
   views/coachview.js — the decisions the book would make for you
   ========================================================================== */

import { html, raw, esc, icon, $, $$, sheet, toast, confirmSheet, fmtDate, relDays } from '../ui.js';
import { fmtLoadBare, parseNum } from '../rpe.js';
import { activeInsights, PLATEAU_TREE, PAIN_PROTOCOL, FAULTS, STICKING_POINT_PREAMBLE, trainingAgeReport } from '../coach.js';
import { graduationCheck, templateOf, slotHistory, slotE1RM, loadingWeeks, attemptsFor,
         peakStatus, PEAK_MIN_DAYS } from '../program.js';
import { DELOAD_CHECKLIST } from '../templates.js';
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
        <div class="eyebrow">Training age</div>
        ${raw(trainingAgeCard(st))}
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
            <div class="pick__sub">${esc(program.meetDate
              ? `${fmtDate(program.meetDate)} — ${relDays(program.meetDate)} days out${program.peak ? ' · block running' : ''}`
              : 'Set a date and the four-week block starts itself when you get there.')}</div></div>
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

/**
 * Am I still an intermediate?
 *
 * Deliberately leads with what the book classifies on — how often you can still
 * add load — rather than with the numbers, because the numbers are the thing it
 * explicitly refuses to classify on (p. 100). The rate table underneath says
 * whether the current program is still working; the criterion table says whether
 * you have earned the next one. They are different questions and the card keeps
 * them apart, because conflating them is how a lifter talks themselves onto a
 * block program that will progress them more slowly.
 */
function trainingAgeCard(st) {
  const r = trainingAgeReport(st);
  if (!r) return '';
  const units = st.profile.units;

  const bands = r.bands.map((b) => {
    const you = b.age === r.age;
    return `<div class="kv">
      <span class="kv__k">${you ? `<b>${esc(b.label)}</b>` : esc(b.label)}</span>
      <span class="kv__v">${esc(b.adds)}${you ? ' <span class="pill pill--accent">you</span>' : ''}</span>
    </div>`;
  }).join('');

  const rate = r.lifts.map((l) => {
    if (l.delta == null) {
      return `<div class="kv"><span class="kv__k">${esc(l.label)}</span><span class="kv__v dim">not enough data</span></div>`;
    }
    const sign = l.delta > 0 ? '+' : '';
    const cls = l.delta > 0 ? 'good' : l.delta < 0 ? 'warn' : '';
    const rate = l.perWeek == null
      ? `<span class="dim" style="font-weight:400"> · over ${l.days} day${l.days === 1 ? '' : 's'}</span>`
      : `<span class="dim" style="font-weight:400"> · ${l.perWeek >= 0 ? '+' : ''}${fmtLoadBare(l.perWeek)}/wk</span>`;
    return `<div class="kv">
      <span class="kv__k">${esc(l.label)}</span>
      <span class="kv__v"><span class="${cls}">${sign}${fmtLoadBare(l.delta)} ${esc(units)}</span>${rate}</span>
    </div>`;
  }).join('');

  const crit = r.rows.map((row) => `<div class="kv">
    <span class="kv__k">${esc(row.label)}</span>
    <span class="kv__v">${row.qualifies
      ? '<span class="pill pill--warn">qualifies</span>'
      : `<span class="dim" style="font-weight:400">${row.stalls === 0 ? 'no stalls' : `${row.stalls} stall${row.stalls === 1 ? '' : 's'}`} · ${row.smallIncrement ? 'increments cut' : 'full increments'}</span>`}</span>
  </div>`).join('');

  return `<div class="card">
    <div class="insight__t">${esc(r.ready ? 'Time to move up' : `You are an ${r.age}`)}</div>
    <div class="insight__b" style="margin-top:4px;margin-bottom:14px">${esc(r.why)}</div>

    <div class="eyebrow" style="margin-bottom:6px">The book classifies on how often you can still add load</div>
    ${bands}
    <p class="cite" style="margin:8px 0 16px">Not on what you lift. "Some lifters have been hitting the gym for over 10 years, but functionally are still intermediates."</p>

    <div class="eyebrow" style="margin-bottom:6px">Your last 28 days</div>
    ${rate}
    <p class="cite" style="margin:8px 0 16px">Change in estimated max, deload weeks and high-rep estimates excluded. This says whether the program is working, not which stage you are at.</p>

    ${r.rows.length ? `<div class="eyebrow" style="margin-bottom:6px">Moving up needs ${r.need} of ${r.rows.length} strength-day mains to stall twice on cut increments</div>
    ${crit}
    <p class="cite" style="margin-top:8px">${r.have} of ${r.rows.length} there. ${esc(r.cite)}</p>` : ''}
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
  const status = peakStatus(st);

  // The block is not a leaflet any more — the app runs it. So the sheet's job is
  // to say where in it you are and what happens next, not to hand you a plan to
  // execute yourself.
  const statusLine = !status ? null
    : status.kind === 'running' ? { cls: 'good', t: `Peaking block running — week ${status.week} of ${status.weeks}`, b: 'Strength-day mains are at 1-3 reps and everything else is at two-thirds of its sets; week 3 deloads all of that and rehearses your openers, and meet week is a taper into the platform. If you need out, the cycle plan on the home screen will close it.' }
    : status.kind === 'pending' ? { cls: 'accent', t: 'Waiting on you', b: 'The block has been offered and not answered yet. The home screen has the decision — start it, or carry on for another week and be asked again.' }
    : status.kind === 'declined' ? { cls: 'warn', t: `Put off ${status.declined === 1 ? 'once' : `${status.declined} times`}`, b: `That is a decision, not a mistake — but a block needs ${PEAK_MIN_DAYS} days of runway and there are ${status.out}. You will be asked again at the end of this training week.` }
    : status.kind === 'nextWeek' ? { cls: 'accent', t: 'The peak is offered at the end of this week', b: 'Finish the week you are on as written. When it rolls over the app asks whether to start the block — and "not yet" is a real answer. No reason to bring it forward by going heavy early.' }
    : status.kind === 'waiting' ? { cls: 'info', t: `Normal training for about ${status.startsIn} more day${status.startsIn === 1 ? '' : 's'}`, b: 'The peaking block is offered at the first week boundary inside four weeks. Train the program you are on until then.' }
    : status.kind === 'tooLate' ? { cls: 'warn', t: 'Too close to peak for', b: `A four-week block needs ${PEAK_MIN_DAYS} days of runway and there are ${status.out}. The app will not start a truncated one — it would taper you for a meet you never trained heavy for. Train normally, take the last four or five days easy, and open conservatively.` }
    : status.kind === 'done' ? { cls: 'info', t: 'This meet has been peaked for', b: 'Set a new date to arm the next block.' }
    : status.kind === 'past' ? { cls: 'info', t: 'That date has passed', b: 'Set a new one to arm the next block.' }
    : null;

  // The same function the test day uses, so the sheet and the day the lifter
  // actually walks into cannot disagree — and so every number here is one that
  // can be loaded on their bar rather than merely rounded to 2.5.
  const attempts = ['squat', 'bench', 'deadlift'].map((lift) => attemptsFor(st, lift) || { lift, max: null });

  sheet({
    title: 'Peaking for a meet',
    body: `<div class="stack">
      <div class="field">
        <label class="field__label" for="md">Meet date</label>
        <input class="input" id="md" type="date" value="${esc(p.meetDate || '')}" data-md>
        ${p.meetDate ? `<div class="field__hint">${out >= 0 ? `${out} days away` : `${-out} days ago`}. The peaking cycle starts itself 4 weeks out.</div>` : ''}
      </div>

      ${statusLine ? `<div class="insight insight--${statusLine.cls}">
        <div class="insight__icon">${icon('bolt')}</div>
        <div><div class="insight__t">${esc(statusLine.t)}</div><div class="insight__b">${esc(statusLine.b)}</div></div>
      </div>` : ''}

      <div class="stack-sm">
        <div class="eyebrow">The four-week cycle — what the app will do</div>
        ${[
          ['Weeks 1-2', 'Your strength-day squat, bench and deadlift drop from 3-5 reps to 1-3, and the bar goes up to meet them, converted off your own week-1 anchor — the wave runs 3 reps, then 2, then 1. Everything else runs at two-thirds of its sets from day one: the block is a taper, and volume is what comes off (p. 140).'],
          ['Week 3', 'Everything the block is not made of deloads — variations, accessories and the volume day. Your last training day is replaced: squat, bench, deadlift in meet order, one single at your opener on each, about 7 days out at RPE 7.5-8.5.'],
          ['Week 4 (meet week)', 'The competition lifts come down too. The second-to-last day is your primer, 24-48 hours out: two singles at RPE 4 on squat, two on bench, one on deadlift, and nothing else. The last one is the meet — nine attempts against a running total, and logging it is what closes the block.'],
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
        <p class="cite">Open with your current 3RM, second attempt at your current 2RM, third at the next incremental PR if it is there. Computed from your logged estimated maxes, in ${esc(units)}, and rounded onto the platform's ${esc(units === 'kg' ? '2.5 kg' : '5 lb')} rather than onto your own plates — these are weights you declare, not weights you load. Week 3's opener rehearsal and meet day itself run exactly these numbers, recomputed on the day.</p>

        <div class="field">
          <label class="field__label" for="goaltotal">Total you are chasing</label>
          <div class="row" style="gap:8px">
            <input class="input input--num grow" id="goaltotal" type="text" inputmode="decimal"
                   value="${st.program.goalTotal ?? ''}" placeholder="${attempts.every((a) => a.max) ? fmtLoadBare(attempts.reduce((n, a) => n + a.second, 0)) : '—'}" data-goal>
            <span class="pill mono" style="flex:0 0 auto">${esc(units)}</span>
          </div>
          <div class="field__hint">Optional, and the most useful number on the platform — the board tracks against it between attempts, so the third-attempt call is arithmetic rather than a feeling. Three second attempts is a total you should make; three thirds is one you might.</div>
        </div>
      </div>

      <button class="btn btn--primary btn--block" data-savemeet>Save</button>
    </div>`,
    onMount(root, close) {
      $('[data-savemeet]', root).onclick = () => {
        const v = $('[data-md]', root).value;
        const g = parseNum($('[data-goal]', root)?.value);
        ctx.store.update((s) => {
          s.program.meetDate = v || null;
          s.program.goalTotal = g && g > 0 ? g : null;
        });
        close();
        toast(v ? 'Meet date saved.' : 'Meet date cleared.');
      };
    },
  });
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
