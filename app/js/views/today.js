/* ==========================================================================
   views/today.js — the home screen: what you are doing today, and why
   ========================================================================== */

import { html, raw, esc, icon, $, $$, toast, sheet, closeSheet, fmtDate, relDays, confirmSheet } from '../ui.js';
import { fmtLoadBare, plateBreakdown, fmtRPE } from '../rpe.js';
import { resolveDay, startSession, templateOf, resolveAssessment, cyclePlan, loadingWeeks, resolveTestDay, attemptsFor } from '../program.js';
import { DELOAD_CHECKLIST, WARMUP, RPE_SCALE, INTERMEDIATE_PL, ADVANCED_ACCUMULATION } from '../templates.js';
import { activeInsights, sessionBriefing, readinessVerdict, READINESS_QUESTIONS, PAIN_PROTOCOL, milestones, testReadiness, planTestBlock } from '../coach.js';
import { byId } from '../exercises.js';
import { buildProgram } from '../program.js';
import { todayISO } from '../store.js';

let readinessDraft = null;

function view(ctx) {
  const st = ctx.state;
  const program = st.program;
  const tpl = templateOf(program);
  const active = st.sessions.find((s) => s.id === st.activeSessionId && s.status === 'active');
  const insights = activeInsights(st);
  const units = st.profile.units;

  if (program.pendingAssessment) {
    return html`${raw(header(st, tpl))}${raw(assessmentPrompt())}`;
  }

  const resolved = resolveDay(st, {});
  const brief = sessionBriefing(resolved, st);
  const todaysReadiness = st.readiness.find((r) => r.date === todayISO());
  const verdict = todaysReadiness ? readinessVerdict(todaysReadiness, st) : null;

  return html`
    ${raw(header(st, tpl))}

    <div class="stack-lg">
      ${raw(insights.filter((i) => i.kind !== 'assessment').map(insightCard).join(''))}

      ${raw(meetDayBanner(st))}

      ${raw(active ? resumeCard(active, resolved) : '')}

      ${raw(verdict ? readinessCard(verdict) : readinessPrompt())}

      <div class="day-head">
        <div class="day-head__meta">
          <span class="pill pill--accent">${esc(resolved.isDeload ? 'Deload' : resolved.isPainWeek ? 'High-rep week' : `Cycle ${resolved.cycle} · Week ${resolved.week}`)}</span>
          <span class="pill">Day ${resolved.day}</span>
          <span class="pill ${resolved.dayDef.role === 'strength' ? 'pill--bad' : resolved.dayDef.role === 'technique' ? 'pill--info' : 'pill--warn'}">${esc(resolved.dayDef.label)}</span>
        </div>
        <div class="day-head__title">${esc(resolved.title || resolved.dayDef.label)}</div>
        ${raw(resolved.why ? `<div class="day-head__why">${esc(resolved.why)}</div>` : '')}
      </div>

      ${raw(brief.notes.filter((n) => n.kind === 'deload' || n.kind === 'painWeek' || n.kind === 'cycle').map((n) =>
        `<div class="banner ${n.kind === 'deload' ? 'banner--good' : n.kind === 'painWeek' ? 'banner--warn' : ''}"><b>${esc(n.title)}</b><br>${esc(n.text)}</div>`).join(''))}

      <div class="stack-sm">
        ${raw(resolved.slots.map((s, i) => slotRow(s, i, units, st)).join(''))}
      </div>

      <button class="btn btn--primary btn--lg btn--block" data-start>
        ${raw(icon('play'))} ${esc(active ? 'Resume session' : 'Start session')}
      </button>

      ${raw(warmupCard(resolved))}

      <div class="row" style="gap:8px">
        <button class="btn btn--ghost grow" data-plan>${raw(icon('today'))} Cycle plan</button>
        <button class="btn btn--ghost grow" data-pain>${raw(icon('warn'))} Something hurts</button>
      </div>

      <button class="btn btn--ghost btn--block" data-test>${raw(icon('trophy'))} Test day — go for a single</button>

      ${raw(milestoneCard(st))}

      ${raw(scheduleNote(resolved, st))}
    </div>`;
}

/**
 * The meet date used to be a countdown and nothing else — it never changed a
 * single prescription, so the day itself arrived as an ordinary Day 4. If today
 * is the day, say so and offer the thing the date was set for.
 */
function meetDayBanner(st) {
  const d = st.program.meetDate;
  if (!d) return '';
  const out = relDays(d);
  if (out > 1 || out < 0) return '';
  return `<div class="insight insight--good">
    <div class="insight__icon">${icon('trophy')}</div>
    <div class="grow">
      <div class="insight__t">${out === 0 ? 'This is the day' : 'Tomorrow is the day'}</div>
      <div class="insight__b">${out === 0
        ? 'You set this date to find out what you can do. Three attempts a lift, computed from everything you have logged since you started.'
        : 'Keep today easy or take it off. Tomorrow is what the date was for.'}</div>
      ${out === 0 ? `<button class="btn btn--good btn--block" style="margin-top:10px" data-test>${icon('trophy')} Start test day</button>` : ''}
    </div>
  </div>`;
}

/**
 * Milestones, on the home screen rather than buried in a stats tab.
 *
 * The point of putting it here is the "in range" line: a lifter whose estimate
 * has quietly crossed four plates should find that out on the day it happens,
 * not the next time they go looking at a chart.
 */
function milestoneCard(st) {
  const rows = milestones(st, { perLift: 2 });
  const units = st.profile.units;
  const anyReady = rows.some((r) => r.next.some((n) => n.inRange));
  const body = rows.filter((r) => r.est).map((r) => {
    const name = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' }[r.lift];
    return r.next.map((n, i) => `<div class="kv">
      <span class="kv__k">${i === 0 ? esc(name) : ''}</span>
      <span class="kv__v">${esc(n.label)}
        ${n.inRange
          ? '<span class="pill pill--good">in range</span>'
          : `<span class="dim" style="font-weight:400">${fmtLoadBare(n.away)} ${esc(units)} away${n.weeksOff ? ` · ~${n.weeksOff} wk` : ''}</span>`}
      </span>
    </div>`).join('');
  }).join('');
  if (!body) return '';
  return `<div class="card">
    <div class="eyebrow" style="margin-bottom:8px">Milestones</div>
    ${body}
    <p class="cite" style="margin-top:10px">${anyReady
      ? 'Something is in range. Take a test day and go and get it.'
      : 'Distances are from your estimated max; the weeks assume your current rate holds.'}</p>
  </div>`;
}

/* ---- test day --------------------------------------------------------- */

/**
 * Pick the lifts, see the attempts, start the session.
 *
 * Lift selection matters more than it looks: maxing squat and bench first costs
 * real kilos off a deadlift taken an hour later, so a lifter chasing one number
 * should be able to take a day for that number alone. Defaulting to all three
 * and letting them uncheck is the version that makes that easy to notice.
 */
function openTestDay(ctx) {
  const st = ctx.state;
  const units = st.profile.units;
  const chosen = new Set(['squat', 'bench', 'deadlift']);

  const ready = testReadiness(st);
  const LIFT_NAMES = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' };

  const readinessBlock = () => {
    if (ready.score == null) return '';
    const cls = { prime: 'good', good: 'good', fair: 'warn', poor: 'bad' }[ready.level] || 'info';
    return `<div class="insight insight--${cls}">
      <div class="insight__icon">${icon(ready.level === 'poor' ? 'warn' : 'check')}</div>
      <div class="grow">
        <div class="insight__t">${esc(ready.headline)} <span class="pill pill--${cls === 'bad' ? 'warn' : cls}">${ready.score}/100</span></div>
        <div style="margin-top:8px">
          ${ready.factors.map((f) => `<div class="kv">
            <span class="kv__k">${f.verdict === 'bad' ? '⚠ ' : ''}${esc(f.label)}</span>
          </div><div class="tiny dim" style="margin:-4px 0 6px">${esc(f.detail)}</div>`).join('')}
        </div>
        ${ready.window ? `<div class="tiny" style="margin-top:6px"><b>${esc(ready.window.text)}</b></div>` : ''}
      </div>
    </div>`;
  };

  const planBlock = () => {
    if (chosen.size < 2) return '';
    const plan = planTestBlock(st, { lifts: [...chosen] });
    return `<div class="card card--flat">
      <div class="eyebrow" style="margin-bottom:8px">Suggested order</div>
      ${plan.days.map((d) => d.kind === 'test'
        ? `<div class="kv"><span class="kv__k"><b>${esc(fmtDate(d.date))}</b></span>
             <span class="kv__v">${esc(LIFT_NAMES[d.lift])}${d.target ? ` <span class="dim" style="font-weight:400">· ${esc(d.target.label)}</span>` : ''}</span></div>`
        : `<div class="kv"><span class="kv__k dim">${esc(fmtDate(d.date))}</span><span class="kv__v dim" style="font-weight:400">rest</span></div>`).join('')}
      <p class="cite" style="margin-top:8px">Squat and deadlift draw on the same recovery, so they never sit next to each other; bench barely does. The lift closest to a milestone goes first, while you are freshest. Starting below runs the first one — come back for the others on their days.</p>
    </div>`;
  };

  const table = () => ['squat', 'bench', 'deadlift'].map((lift) => {
    const a = attemptsFor(st, lift);
    const name = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' }[lift];
    return `<label class="pick" style="cursor:pointer">
      <input type="checkbox" data-lift="${lift}" ${chosen.has(lift) ? 'checked' : ''} style="margin-right:10px">
      <div class="pick__body">
        <div class="pick__title">${esc(name)}</div>
        <div class="pick__sub mono">${a
          ? `${fmtLoadBare(a.opener)} · ${fmtLoadBare(a.second)} · ${fmtLoadBare(a.third)} ${esc(units)}`
          : 'no estimate yet — work up by feel'}</div>
      </div>
    </label>`;
  }).join('');

  sheet({
    title: 'Test day',
    body: `<div class="stack">
      ${readinessBlock()}
      <p class="muted small">Three attempts each: an opener you could triple, a second you could double, and one real attempt at a weight you have not done. This sits outside your program — it will not move your cycle or touch your training loads.</p>
      <div class="stack-sm">${table()}</div>
      <div data-plan-slot>${planBlock()}</div>
      <button class="btn btn--primary btn--lg btn--block" data-go>${icon('trophy')} Start test day</button>
    </div>`,
    onMount(root, close) {
      const redrawPlan = () => {
        const slot = $('[data-plan-slot]', root);
        if (slot) slot.innerHTML = planBlock();
      };
      $$('[data-lift]', root).forEach((cb) => cb.onchange = () => {
        if (cb.checked) chosen.add(cb.dataset.lift); else chosen.delete(cb.dataset.lift);
        const go = $('[data-go]', root);
        if (go) go.disabled = chosen.size === 0;
        redrawPlan();
      });
      $('[data-go]', root).onclick = () => {
        if (!chosen.size) return;
        // A block is a plan, not a session: start the lift whose day this is and
        // let the lifter come back for the rest. Loading all three into one
        // session would be the exact thing the plan above tells them not to do.
        const first = chosen.size > 1
          ? planTestBlock(st, { lifts: [...chosen] }).order[0]
          : [...chosen][0];
        let id = null;
        ctx.store.update((s) => {
          s.program.testLifts = [first];
          const ses = startSession(s, { ...s.program.cursor, phase: 'test' });
          s.sessions.push(ses);
          s.activeSessionId = ses.id;
          id = ses.id;
        });
        close();
        if (id) ctx.go('session');
      };
    },
  });
}

/* ---- header ----------------------------------------------------------- */

function header(st, tpl) {
  const done = st.sessions.filter((s) => s.status === 'done').length;
  const meet = st.program.meetDate ? relDays(st.program.meetDate) : null;
  return `<div class="row-between" style="margin-bottom:18px">
    <div>
      <div class="eyebrow">${esc(tpl.name)}</div>
      <div class="tiny dim" style="margin-top:2px">
        ${done} session${done === 1 ? '' : 's'} logged${meet != null && meet >= 0 ? ` · ${meet} days to the meet` : ''}
      </div>
    </div>
    ${st.profile.bodyweight ? `<span class="pill mono">${fmtLoadBare(st.profile.bodyweight)} ${esc(st.profile.units)}</span>` : ''}
  </div>`;
}

/* ---- cards ------------------------------------------------------------ */

function insightCard(i) {
  const kindClass = { graduate: 'good', stall: 'warn', deloadDue: 'warn', layoff: 'info', meet: 'accent' }[i.kind] || 'accent';
  const ico = { graduate: 'trophy', stall: 'warn', deloadDue: 'rest', layoff: 'info', meet: 'bolt' }[i.kind] || 'info';
  return `<div class="insight insight--${kindClass}">
    <div class="insight__icon">${icon(ico)}</div>
    <div class="grow">
      <div class="insight__t">${esc(i.title)}</div>
      <div class="insight__b">${esc(i.text)}</div>
      ${i.action === 'graduate' ? `<button class="btn btn--good" style="margin-top:10px" data-graduate>Switch to the advanced program</button>` : ''}
    </div>
  </div>`;
}

function resumeCard(active, resolved) {
  const logged = active.entries.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
  const total = active.entries.reduce((n, e) => n + e.sets.length, 0);
  return `<div class="card card--accent">
    <div class="row-between">
      <div>
        <div class="eyebrow" style="color:var(--accent)">Session in progress</div>
        <div class="small" style="margin-top:3px">${logged} of ${total} sets logged</div>
      </div>
      ${icon('play', 'dim')}
    </div>
  </div>`;
}

function readinessPrompt() {
  return `<button class="card card--flat" data-readiness style="width:100%;text-align:left">
    <div class="row" style="gap:12px">
      <div class="insight__icon">${icon('coach')}</div>
      <div class="grow">
        <div class="insight__t">How are you today?</div>
        <div class="insight__b small">Five taps. If you are wrecked, the book says train the easiest session of the week instead — this is how the app knows to tell you that.</div>
      </div>
      ${icon('chevron', 'dim')}
    </div>
  </button>`;
}

function readinessCard(v) {
  const cls = v.level === 'poor' ? 'bad' : v.level === 'fair' ? 'warn' : 'good';
  return `<div class="insight insight--${cls}">
    <div class="insight__icon">${icon(v.level === 'good' ? 'check' : 'warn')}</div>
    <div class="grow">
      <div class="row-between">
        <div class="insight__t">${esc(v.headline)}</div>
        <span class="pill pill--${cls} mono">${v.score}</span>
      </div>
      <div class="insight__b">${esc(v.advice)}</div>
      ${v.cite ? `<div class="insight__cite">${esc(v.cite)}</div>` : ''}
      <div class="row" style="gap:8px;margin-top:10px">
        ${v.offerSwap ? `<button class="btn btn--ghost" data-swapday="${v.swapToDay}">Swap to Day ${v.swapToDay}</button>` : ''}
        <button class="btn btn--bare small" data-readiness>Change</button>
      </div>
    </div>
  </div>`;
}

function slotRow(s, i, units, st) {
  const ex = s.exercise;
  const target = s.timed
    ? esc(s.prescription || 'timed holds')
    : `<b>${s.sets} × ${s.reps}</b>` + (s.targetRPE != null ? ` @ RPE <b>${fmtRPE(s.targetRPE)}</b>` : s.rpeRange ? ` @ RPE <b>${s.rpeRange[0]}-${s.rpeRange[1]}</b>` : '');
  const load = s.plannedLoad;
  const pb = load ? plateBreakdown(load, { barWeight: st.profile.barWeight, plates: st.profile.plates }) : null;
  const range = s.loadRange;
  const showRange = !!range && !range.exact;

  return `<div class="ex">
    <div class="ex__head">
      <div class="ex__num">${i + 1}</div>
      <div class="grow">
        <div class="ex__name">${esc(ex?.short || s.slot.slotType)}</div>
        <div class="ex__role">${esc(s.role)}${s.pct != null ? ` · ${s.pct}% ref` : ''}</div>
        <div class="ex__target">${raw(target)}</div>
      </div>
      <div style="text-align:right;flex:0 0 auto">
        ${load
          ? `<div class="mono" style="font-size:${showRange ? '1.05' : '1.25'}rem;font-weight:700;letter-spacing:-.02em;white-space:nowrap">${showRange ? `${fmtLoadBare(range.low)}–${fmtLoadBare(range.high)}` : fmtLoadBare(load)}</div>
             <div class="tiny dim">${esc(units)}${!showRange && pb && !pb.ok ? ' ≈' : ''}</div>`
          : `<span class="pill pill--warn">by feel</span>`}
      </div>
    </div>
  </div>`;
}

function warmupCard(resolved) {
  const lowRep = resolved.slots.some((s) => s.reps != null && s.reps <= 5);
  const scheme = lowRep ? WARMUP.lowRep : WARMUP.highRep;
  return `<details class="acc">
    <summary class="acc__head" style="list-style:none;cursor:pointer">
      ${icon('chevron')}<b>Warm-up</b><span class="tiny dim">${esc(scheme.label)}</span>
    </summary>
    <div class="acc__body">
      <p><b>General</b></p>
      <ul>${WARMUP.general.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>
      <p style="margin-top:12px"><b>Ramp on your first heavy lift</b></p>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Set</th><th>Reps</th><th class="r">Load</th></tr></thead>
        <tbody>${scheme.sets.map((s, i) => `<tr>
          <td class="mono">${i + 1}</td><td class="mono">${esc(String(s.reps))}</td>
          <td class="r mono">${s.pct ? `${s.pct}%` : esc(s.label || '—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="cite" style="margin-top:10px">Percentages are of your working weight for that lift. p. 224.</p>
    </div>
  </details>`;
}

function scheduleNote(resolved, st) {
  if (!resolved.scheduleNote) return '';
  return `<p class="cite">${esc(resolved.scheduleNote)}</p>`;
}

/* ---- deload assessment ------------------------------------------------ */

function assessmentPrompt() {
  return `<div class="stack-lg">
    <div>
      <div class="eyebrow">Cycle complete</div>
      <h1 style="margin-top:6px">Five questions.</h1>
      <p class="muted" style="margin-top:8px;line-height:1.6">
        Three loading weeks are done. These decide whether you go straight into the next, heavier
        cycle or take a deload week first. Answer honestly — the whole point is that you cannot
        judge fatigue by how strong you feel on the day.
      </p>
    </div>
    <button class="btn btn--primary btn--lg btn--block" data-assess>Run the checklist</button>
    <p class="cite">Post-block assessment, pp. 123 and 218.</p>
  </div>`;
}

function openAssessment(ctx) {
  const answers = {};
  const body = () => `
    <div class="stack">
      <div class="stack-sm">
        ${DELOAD_CHECKLIST.map((c) => `
          <button class="pick" data-q="${c.key}" aria-pressed="${!!answers[c.key]}">
            <span class="pick__mark">${icon('check')}</span>
            <div class="pick__body"><div class="pick__title" style="font-weight:550">${esc(c.q)}</div></div>
          </button>`).join('')}
      </div>
      <div class="cite">Tap the ones that are true. Two or more means deload.</div>
      <button class="btn btn--primary btn--lg btn--block" data-submit>Get the verdict</button>
    </div>`;

  sheet({
    title: 'Post-cycle checklist',
    body: body(),
    onMount(root, close) {
      const wire = () => {
        for (const b of $$('[data-q]', root)) {
          b.onclick = () => {
            answers[b.dataset.q] = !answers[b.dataset.q];
            b.setAttribute('aria-pressed', String(!!answers[b.dataset.q]));
          };
        }
        $('[data-submit]', root).onclick = () => {
          let result;
          ctx.store.update((s) => { result = resolveAssessment(s, answers); });
          close();
          showVerdict(result, ctx);
        };
      };
      wire();
    },
  });
}

function showVerdict(result, ctx) {
  const map = {
    deload: { title: 'Deload week', cls: 'good' },
    painWeek: { title: 'High-rep week', cls: 'warn' },
    proceed: { title: 'Straight into the next cycle', cls: 'accent' },
  };
  const m = map[result.action] || map.proceed;
  const extra = result.action === 'deload'
    ? 'Next week runs at the lowest reps and lightest load of the wave, two-thirds of the sets. It should feel easy.'
    : result.action === 'painWeek'
      ? 'Run a normal week for volume and RPE, but raise your reps to 12-20. That keeps the stimulus and drops the peak joint stress.'
      : 'Loads go up one increment and the reps go back to the top of the range.';

  sheet({
    title: m.title,
    body: `<div class="stack">
      <div class="banner banner--${m.cls === 'accent' ? '' : m.cls}">${result.reasons.map(esc).join('<br>')}</div>
      <p class="small muted">${esc(extra)}</p>
      <button class="btn btn--primary btn--lg btn--block" data-ok>Got it</button>
    </div>`,
    onMount(root, close) { $('[data-ok]', root).onclick = () => { close(); ctx.refresh(); }; },
  });
}

/* ---- readiness sheet -------------------------------------------------- */

function openReadiness(ctx) {
  const existing = ctx.state.readiness.find((r) => r.date === todayISO());
  readinessDraft = { ...(existing || {}) };

  const body = () => `
    <div class="stack">
      ${READINESS_QUESTIONS.map((q) => `
        <div class="field">
          <div class="row-between">
            <span class="field__label">${esc(q.label)}</span>
            <span class="tiny dim">${esc(q.lowLabel)} → ${esc(q.highLabel)}</span>
          </div>
          <div class="seg">
            ${[1, 2, 3, 4, 5].map((n) => `<button class="seg__btn" data-r="${q.key}" data-v="${n}" aria-pressed="${Number(readinessDraft[q.key]) === n}">${n}</button>`).join('')}
          </div>
        </div>`).join('')}
      <button class="btn btn--primary btn--lg btn--block" data-save>Save</button>
    </div>`;

  sheet({
    title: 'Readiness',
    body: body(),
    onMount(root, close) {
      const wire = () => {
        for (const b of $$('[data-r]', root)) {
          b.onclick = () => {
            readinessDraft[b.dataset.r] = Number(b.dataset.v);
            for (const sib of $$(`[data-r="${b.dataset.r}"]`, root)) {
              sib.setAttribute('aria-pressed', String(sib === b));
            }
          };
        }
        $('[data-save]', root).onclick = () => {
          ctx.store.update((s) => {
            const entry = { date: todayISO(), ...readinessDraft };
            const i = s.readiness.findIndex((r) => r.date === entry.date);
            if (i >= 0) s.readiness[i] = entry; else s.readiness.push(entry);
          });
          close();
          ctx.refresh();
        };
      };
      wire();
    },
  });
}

/* ---- pain sheet ------------------------------------------------------- */

function openPain() {
  const p = PAIN_PROTOCOL;
  sheet({
    title: p.title,
    body: `<div class="stack">
      <p class="small muted">${esc(p.intro)}</p>
      <div class="stack-sm">
        ${p.chain.map((c, i) => `<div class="insight insight--warn">
          <div class="insight__icon"><b style="font-size:.813rem">${i + 1}</b></div>
          <div><div class="insight__t">${esc(c.step)}</div><div class="insight__b">${esc(c.detail)}</div></div>
        </div>`).join('')}
      </div>
      <div class="banner banner--warn"><b>${esc(p.jointOnly.split('.')[0])}.</b> ${esc(p.jointOnly.split('.').slice(1).join('.').trim())}</div>
      <div class="card card--flat">
        <div class="insight__t" style="margin-bottom:4px">${esc(p.bfr.title)}</div>
        <div class="small muted">${esc(p.bfr.detail)}</div>
      </div>
      <div class="banner banner--bad">${esc(p.escalate)}</div>
      <p class="cite">${esc(p.cite)}</p>
    </div>`,
  });
}

/* ---- cycle plan sheet ------------------------------------------------- */

function openPlan(ctx) {
  const st = ctx.state;
  const plan = cyclePlan(st);
  const units = st.profile.units;

  sheet({
    title: `${plan.template.name} — cycle plan`,
    body: `<div class="stack">
      ${plan.weeks.map((wk) => `
        <div>
          <div class="eyebrow" style="margin-bottom:8px">Week ${wk.week}</div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>Exercise</th><th class="r">Sets</th><th class="r">Reps</th><th class="r">RPE</th></tr></thead>
            <tbody>
              ${wk.days.map((d) => `
                <tr><td colspan="4" style="padding-top:12px"><span class="eyebrow">Day ${d.day} · ${esc(d.label)}</span></td></tr>
                ${d.slots.map((s) => `<tr>
                  <td>${esc(s.name)}</td>
                  <td class="r mono">${s.sets}</td>
                  <td class="r mono">${s.reps ?? '—'}</td>
                  <td class="r mono">${s.rpe != null ? fmtRPE(s.rpe) : s.rpeRange ? `${s.rpeRange[0]}-${s.rpeRange[1]}` : '—'}</td>
                </tr>`).join('')}`).join('')}
            </tbody>
          </table></div>
        </div>`).join('')}
      <p class="cite">Loads are not shown here because they are set by your first-set RPE each week, not fixed in advance.</p>
    </div>`,
  });
}

/* ---- mount ----------------------------------------------------------- */

function mount(root, ctx) {
  const st = ctx.state;

  $$('[data-start]', root).forEach((b) => b.onclick = () => {
    const active = st.sessions.find((s) => s.id === st.activeSessionId && s.status === 'active');
    if (!active) {
      let id;
      ctx.store.update((s) => {
        const ses = startSession(s, s.program.cursor);
        s.sessions.push(ses);
        s.activeSessionId = ses.id;
        id = ses.id;
      });
    }
    ctx.go('session');
  });

  $$('[data-assess]', root).forEach((b) => b.onclick = () => openAssessment(ctx));
  $$('[data-readiness]', root).forEach((b) => b.onclick = () => openReadiness(ctx));
  $$('[data-pain]', root).forEach((b) => b.onclick = () => openPain());
  $$('[data-plan]', root).forEach((b) => b.onclick = () => openPlan(ctx));
  $$('[data-test]', root).forEach((b) => b.onclick = () => openTestDay(ctx));

  $$('[data-swapday]', root).forEach((b) => b.onclick = () => {
    const day = Number(b.dataset.swapday);
    ctx.store.update((s) => { s.program.cursor.day = day; });
    toast(`Switched to Day ${day}.`);
    ctx.refresh();
  });

  $$('[data-graduate]', root).forEach((b) => b.onclick = async () => {
    const yes = await confirmSheet({
      title: 'Move to the advanced program?',
      message: 'This starts a fresh accumulation block — six days a week, RPE ranges instead of first-set targets. Your history and maxes are kept. You can switch back in Settings.',
      confirmLabel: 'Start accumulation block',
    });
    if (!yes) return;
    ctx.store.update((s) => {
      const old = s.program;
      s.program = buildProgram({
        templateId: ADVANCED_ACCUMULATION.id,
        emphasis: old.emphasis,
        startDate: todayISO(),
        meetDate: old.meetDate,
      });
      s.program.events.push({ date: todayISO(), kind: 'graduated', from: old.templateId });
      s.profile.trainingAge = 'advanced';
    });
    toast('Advanced accumulation block started.', 'good');
    ctx.refresh();
  });
}

export default { id: 'today', render: view, mount };
