/* ==========================================================================
   views/progress.js — are you actually getting stronger?
   --------------------------------------------------------------------------
   The book's position is that you do not need to test 1RMs to know: if the
   same reps at the same RPE need more weight, you got stronger. So the primary
   chart is estimated 1RM over time, built from every logged set, and the app is
   explicit that estimates from high-rep sets are not trustworthy.
   ========================================================================== */

import { html, raw, esc, icon, $, $$, sheet, fmtDate, sparkline, toast, confirmSheet } from '../ui.js';
import { fmtLoadBare, fmtRPE, e1RM, pctOf1RM, convertLoad, parseNum, normalizeRPE, RPE_MIN, RPE_MAX } from '../rpe.js';
import { strengthTrend, trendSummary } from '../coach.js';
import { volumeAudit, templateOf, slotHistory, loadingWeeks } from '../program.js';
import { byId } from '../exercises.js';
import * as sync from '../sync.js';

const LIFTS = [
  { key: 'squat', label: 'Squat' },
  { key: 'bench', label: 'Bench press' },
  { key: 'deadlift', label: 'Deadlift' },
];

let tab = 'strength';

function view(ctx) {
  const st = ctx.state;
  const done = st.sessions.filter((s) => s.status === 'done');

  if (!done.length) {
    return html`
      <h1 style="margin-bottom:18px">Progress</h1>
      <div class="empty">
        ${raw(icon('trend'))}
        <p>Nothing logged yet. Finish a session and your estimated maxes start plotting themselves.</p>
      </div>
      ${raw(volumeCard(st))}`;
  }

  return html`
    <h1 style="margin-bottom:14px">Progress</h1>
    <div class="seg seg--lg" style="margin-bottom:18px">
      <button class="seg__btn" data-tab="strength" aria-pressed="${tab === 'strength'}">Strength</button>
      <button class="seg__btn" data-tab="history" aria-pressed="${tab === 'history'}">History</button>
      <button class="seg__btn" data-tab="volume" aria-pressed="${tab === 'volume'}">Volume</button>
    </div>
    ${raw(tab === 'strength' ? strengthTab(st) : tab === 'history' ? historyTab(st) : volumeTab(st))}`;
}

/* ---- strength -------------------------------------------------------- */

function strengthTab(st) {
  const units = st.profile.units;
  const cards = LIFTS.map(({ key, label }) => {
    const points = strengthTrend(st, key);
    const sum = trendSummary(points);
    const tested = st.maxes[key];

    if (!points.length) {
      return `<div class="card"><div class="row-between"><b>${esc(label)}</b>
        <span class="pill">no data yet</span></div></div>`;
    }

    return `<div class="card">
      <div class="row-between" style="margin-bottom:4px">
        <b>${esc(label)}</b>
        <span class="pill pill--accent mono">${fmtLoadBare(sum ? sum.last.value : points[0].value)} ${esc(units)}</span>
      </div>
      <div class="tiny dim" style="margin-bottom:12px">Estimated 1RM · latest</div>

      ${lineChart(points, units)}

      <div class="statgrid" style="margin-top:14px">
        ${sum ? `
          <div class="stat">
            <div class="stat__k">Change</div>
            <div class="stat__v ${sum.delta >= 0 ? 'stat__v--good' : 'stat__v--bad'}">${sum.delta >= 0 ? '+' : ''}${fmtLoadBare(sum.delta)}</div>
            <div class="stat__s">since you started</div>
          </div>
          <div class="stat">
            <div class="stat__k">Trend</div>
            <div class="stat__v ${sum.perWeek >= 0 ? 'stat__v--good' : 'stat__v--bad'}">${sum.perWeek >= 0 ? '+' : ''}${(Math.round(sum.perWeek * 10) / 10)}</div>
            <div class="stat__s">${esc(units)} / week</div>
          </div>
          <div class="stat">
            <div class="stat__k">Best</div>
            <div class="stat__v">${fmtLoadBare(sum.best.value)}</div>
            <div class="stat__s">${esc(fmtDate(sum.best.date))}</div>
          </div>` : ''}
        ${tested?.value ? `<div class="stat">
          <div class="stat__k">Entered</div>
          <div class="stat__v">${fmtLoadBare(tested.value)}</div>
          <div class="stat__s">${esc(fmtDate(tested.date))}</div>
        </div>` : ''}
      </div>

      ${points.some((p) => p.estimatedFromHighReps)
        ? `<p class="cite" style="margin-top:10px">Some points come from sets above six reps. The book only trusts estimates from about a five-rep set or heavier — read those with suspicion.</p>` : ''}

      <button class="btn btn--ghost btn--block" style="margin-top:12px" data-detail="${key}">All sets</button>
    </div>`;
  }).join('');

  return `<div class="stack-lg">
    ${cards}
    <div class="banner">
      <b>You do not have to test.</b> If the same reps at the same RPE need more weight than last
      cycle, you got stronger — that is what these lines are. If you do want to test, every 6 to 12
      weeks is plenty, and a 3-5 rep max estimates your single as well as a true 1RM attempt does.
    </div>
  </div>`;
}

/** SVG line chart of e1RM over time. */
function lineChart(points, units) {
  const W = 320, H = 150, PL = 34, PR = 6, PT = 8, PB = 20;
  if (points.length < 2) {
    return `<div class="card card--flat card--pad-sm center small muted">One data point so far — a line needs two.</div>`;
  }
  const vals = points.map((p) => p.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min) * 0.15 || 5;
  min = Math.floor((min - pad) / 5) * 5;
  max = Math.ceil((max + pad) / 5) * 5;
  const span = max - min || 1;

  const x = (i) => PL + (i / (points.length - 1)) * (W - PL - PR);
  const y = (v) => PT + (1 - (v - min) / span) * (H - PT - PB);

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(H - PB).toFixed(1)} L${x(0).toFixed(1)},${(H - PB).toFixed(1)} Z`;

  const ticks = [min, min + span / 2, max];
  const showDots = points.length <= 26;

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Estimated one rep max over time">
    ${ticks.map((t) => `
      <line class="chart__grid" x1="${PL}" y1="${y(t).toFixed(1)}" x2="${W - PR}" y2="${y(t).toFixed(1)}"/>
      <text class="chart__lbl" x="0" y="${(y(t) + 3.5).toFixed(1)}">${Math.round(t)}</text>`).join('')}
    <path class="chart__area" d="${area}"/>
    <path class="chart__line" d="${line}"/>
    ${showDots ? points.map((p, i) => `<circle class="chart__dot" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="2.6"/>`).join('') : ''}
    <text class="chart__lbl" x="${PL}" y="${H - 5}">${esc(fmtDate(points[0].date))}</text>
    <text class="chart__lbl" x="${W - PR}" y="${H - 5}" text-anchor="end">${esc(fmtDate(points[points.length - 1].date))}</text>
  </svg>`;
}

function openDetail(ctx, lift) {
  const st = ctx.state;
  const units = st.profile.units;
  const points = strengthTrend(st, lift);
  const label = LIFTS.find((l) => l.key === lift)?.label || lift;

  sheet({
    title: `${label} — every set`,
    body: `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Date</th><th>Where</th><th class="r">e1RM</th></tr></thead>
      <tbody>${[...points].reverse().map((p) => `<tr>
        <td>${esc(fmtDate(p.date))}</td>
        <td class="small muted">C${p.cycle} W${p.week} D${p.day}</td>
        <td class="r mono">${fmtLoadBare(p.value)}${p.estimatedFromHighReps ? ' <span class="dim">?</span>' : ''}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="cite" style="margin-top:12px">A "?" marks an estimate taken from a set above six reps — treat it loosely.</p>`,
  });
}

/* ---- history --------------------------------------------------------- */

function historyTab(st) {
  const done = [...st.sessions.filter((s) => s.status === 'done')].reverse();
  const tpl = templateOf(st.program);
  const units = st.profile.units;

  return `<div class="stack">
    ${done.map((s) => {
      const sets = s.entries.flatMap((e) => e.sets.filter((x) => x.done));
      // Tonnage is stated in the unit at the end of the row, so a session logged
      // in the other one has to be converted before it is summed.
      const tonnage = sets.reduce((n, x) => n + convertLoad(x.load, s.units || units, units) * x.reps, 0);
      const day = tpl.days.find((d) => d.n === s.day);
      return `<button class="hist" data-session="${esc(s.id)}">
        <div class="hist__date">${esc(fmtDate(s.date))}</div>
        <div class="hist__body">
          <div class="hist__t">${esc(s.phase === 'deload' ? 'Deload' : s.phase === 'painWeek' ? 'High-rep week' : `Cycle ${s.cycle} · Week ${s.week}`)} · Day ${s.day}${day ? ` · ${esc(day.label)}` : ''}</div>
          <div class="hist__s">${sets.length} sets · ${Math.round(tonnage).toLocaleString()} ${esc(units)}${s.corrections?.length ? ' · corrected' : ''}</div>
        </div>
        ${icon('chevron', 'dim')}
      </button>`;
    }).join('')}
  </div>`;
}

function openSession(ctx, id) {
  const st = ctx.state;
  const ses = st.sessions.find((s) => s.id === id);
  if (!ses) return;
  // This sheet is the record of one session, so it shows the numbers exactly as
  // they were written and labels them with the unit they were written in. Only
  // aggregates and charts, which have to share an axis, get converted.
  const units = ses.units || st.profile.units;
  const foreign = units !== st.profile.units;

  sheet({
    title: `${fmtDate(ses.date)} — Day ${ses.day}`,
    body: `<div class="stack">
      ${foreign ? `<div class="banner">Logged in ${esc(units)}, before you switched to ${esc(st.profile.units)}. Shown as recorded.</div>` : ''}
      ${ses.entries.map((e) => `
        <div>
          <div class="row-between" style="margin-bottom:6px">
            <b class="small">${esc(byId(e.exerciseId)?.short || e.slotKey)}</b>
            <span class="tiny dim">target ${e.targetSets}×${e.targetReps ?? '—'}${e.targetRPE != null ? ` @ ${fmtRPE(e.targetRPE)}` : ''}</span>
          </div>
          <div class="tbl-wrap"><table class="tbl">
            <tbody>${e.sets.filter((s) => s.done).map((s, i) => `<tr>
              <td class="dim" style="width:24px">${i + 1}</td>
              <td class="mono">${fmtLoadBare(s.load)} ${esc(units)}</td>
              <td class="mono">${s.reps} reps</td>
              <td class="r mono">${s.rpe != null ? `RPE ${fmtRPE(s.rpe)}` : '—'}</td>
            </tr>`).join('')}</tbody>
          </table></div>
          ${e.note ? `<p class="cite" style="margin-top:6px">${esc(e.note)}</p>` : ''}
        </div>`).join('')}
      ${ses.notes ? `<div class="card card--flat"><div class="eyebrow" style="margin-bottom:4px">Notes</div><div class="small">${esc(ses.notes)}</div></div>` : ''}
      ${ses.corrections?.length ? `<div class="insight insight--warn">
        <div class="insight__icon">${icon('warn')}</div>
        <div><div class="insight__t">${ses.corrections.length} ${ses.corrections.length === 1 ? 'entry has' : 'entries have'} been corrected</div>
        <div class="insight__b">${ses.corrections.slice(-6).map((c) =>
          `${esc(byId(ses.entries.find((e) => e.slotKey === c.slotKey)?.exerciseId)?.short || c.slotKey)} set ${c.setIndex + 1}: `
          + `${esc(c.field === 'load' ? 'weight' : c.field)} ${esc(String(c.from ?? '—'))} → ${esc(String(c.to ?? '—'))}`).join('<br>')}</div></div>
      </div>` : ''}
      <button class="btn btn--ghost btn--block" data-correct="${esc(ses.id)}">Correct a mis-typed entry</button>
    </div>`,
    onMount(root, close) {
      const btn = $('[data-correct]', root);
      if (btn) btn.onclick = () => { close(); openCorrect(ctx, ses.id); };
    },
  });
}

/* ---- correcting a logged entry ---------------------------------------- */

/**
 * Editing history is deliberately awkward.
 *
 * The log is evidence: it is what every load suggestion from here on is derived
 * from, and a lifter who can casually round yesterday's numbers up is keeping a
 * diary, not a training record. But typos are real — a rep count typed into the
 * weight field survives forever and quietly bends every chart — and refusing to
 * fix them is its own kind of dishonesty.
 *
 * So: reachable only from inside a session's own detail sheet, behind a
 * confirmation that says what it does not fix, and every change is recorded on
 * the session and shown afterwards. Nothing is edited invisibly.
 */
async function openCorrect(ctx, id) {
  const st = ctx.state;
  const ses = st.sessions.find((s) => s.id === id);
  if (!ses) return;

  const yes = await confirmSheet({
    title: 'Correct a mistake?',
    message: 'This is for fixing a genuine slip — a rep count typed into the weight box, '
      + 'a load off by a decimal place. It is not for improving what happened.\n\n'
      + 'Two things it will not do: it will not undo progression the app has already '
      + 'worked out from these numbers, and it will not un-send anything already posted. '
      + 'Every change is recorded on the session.',
    confirmLabel: 'Let me correct it',
  });
  if (!yes) return;

  const units = ses.units || st.profile.units;
  const rows = [];
  for (const e of ses.entries) {
    e.sets.forEach((s, i) => { if (s.done) rows.push({ slotKey: e.slotKey, i, set: s, entry: e }); });
  }

  sheet({
    title: `Correct — ${fmtDate(ses.date)}`,
    body: `<div class="stack">
      <div class="banner">Change only what was mis-typed. Leave everything else alone.</div>
      ${ses.entries.map((e) => {
        const done = e.sets.map((s, i) => ({ s, i })).filter((x) => x.s.done);
        if (!done.length) return '';
        return `<div>
          <div class="row-between" style="margin-bottom:6px">
            <b class="small">${esc(byId(e.exerciseId)?.short || e.slotKey)}</b>
            <span class="tiny dim">target ${e.targetSets}×${e.targetReps ?? '—'}${e.targetRPE != null ? ` @ ${fmtRPE(e.targetRPE)}` : ''}</span>
          </div>
          <div class="stack-sm">
            <div class="row" style="gap:8px;align-items:center">
              <span style="width:18px;flex:0 0 auto"></span>
              <span class="tiny dim" style="flex:1 1 0">${esc(units)}</span>
              <span class="tiny dim" style="flex:1 1 0">reps</span>
              <span class="tiny dim" style="flex:1 1 0">RPE</span>
            </div>
            ${done.map(({ s, i }) => `<div class="row" style="gap:8px;align-items:center">
              <span class="dim mono tiny" style="width:18px;flex:0 0 auto">${i + 1}</span>
              <input class="input input--num" style="flex:1 1 0" inputmode="decimal" value="${s.load ?? ''}"
                aria-label="Set ${i + 1} weight in ${esc(units)}"
                data-edit="load" data-slot="${esc(e.slotKey)}" data-i="${i}"
                data-focus-key="l${esc(e.slotKey)}${i}">
              <input class="input input--num" style="flex:1 1 0" inputmode="numeric" value="${s.reps ?? ''}"
                aria-label="Set ${i + 1} reps"
                data-edit="reps" data-slot="${esc(e.slotKey)}" data-i="${i}"
                data-focus-key="r${esc(e.slotKey)}${i}">
              <input class="input input--num" style="flex:1 1 0" inputmode="decimal" value="${s.rpe ?? ''}"
                aria-label="Set ${i + 1} RPE"
                data-edit="rpe" data-slot="${esc(e.slotKey)}" data-i="${i}"
                data-focus-key="p${esc(e.slotKey)}${i}">
            </div>`).join('')}
          </div>
        </div>`;
      }).join('')}
      <div data-err></div>
      <button class="btn btn--primary btn--block" data-save>Save corrections</button>
    </div>`,
    onMount(root, close) {
      const errEl = $('[data-err]', root);

      $('[data-save]', root).onclick = () => {
        const changes = [];
        const problems = [];

        for (const el of $$('[data-edit]', root)) {
          const { edit, slot, i } = el.dataset;
          const entry = ses.entries.find((e) => e.slotKey === slot);
          const set = entry?.sets[+i];
          if (!set) continue;

          const raw = el.value.trim();
          const stored = set[edit] ?? null;

          // Only look at fields that were actually touched. Validating every box
          // meant one pre-existing out-of-range value blocked the whole save —
          // and those exist: technique days are prescribed at RPE 5, below the
          // picker's own floor. Correcting a weight must not require first
          // arguing with a number you never typed.
          if (raw === (stored == null ? '' : String(stored))) continue;

          let next = raw === '' ? null : parseNum(raw);
          const label = `${byId(entry.exerciseId)?.short || slot} set ${+i + 1}`;

          if (edit === 'rpe') {
            // Range-check before normalising, not after: normalizeRPE clamps, so
            // a fat-fingered 88 would silently land as a legitimate-looking 10.
            // In a dialog whose entire job is fixing typos, that is the one
            // behaviour we cannot have.
            if (next != null) {
              if (next < RPE_MIN || next > RPE_MAX) {
                problems.push(`${label}: RPE must be between ${RPE_MIN} and ${RPE_MAX}.`);
                continue;
              }
              next = normalizeRPE(next);
            }
          } else if (next == null || !(next > 0)) {
            problems.push(`${label}: ${edit === 'load' ? 'weight' : 'reps'} must be a number above zero.`);
            continue;
          } else if (edit === 'reps' && !Number.isInteger(next)) {
            problems.push(`${label}: reps must be a whole number.`);
            continue;
          }

          if (stored !== next) changes.push({ slotKey: slot, i: +i, field: edit, from: stored, to: next, label });
        }

        if (problems.length) {
          errEl.innerHTML = `<div class="insight insight--bad"><div>${problems.map(esc).join('<br>')}</div></div>`;
          return;
        }
        if (!changes.length) { close(); toast('Nothing changed.'); return; }

        ctx.store.update((s) => {
          const target = s.sessions.find((x) => x.id === id);
          if (!target) return;
          for (const c of changes) {
            const entry = target.entries.find((e) => e.slotKey === c.slotKey);
            if (entry?.sets[c.i]) entry.sets[c.i][c.field] = c.to;
          }
          // The audit trail rides with the session, so it is in every backup and
          // every snapshot — a correction can always be traced back.
          target.corrections = [
            ...(target.corrections || []),
            ...changes.map((c) => ({ at: new Date().toISOString(), slotKey: c.slotKey, setIndex: c.i, field: c.field, from: c.from, to: c.to })),
          ];
        });

        // The sheet, the dashboard and the estimates all key off this session, so
        // push it again — upsert by key means the old rows are overwritten.
        sync.enqueue(id);
        sync.flush({ reason: 'correction' });

        close();
        toast(`${changes.length} ${changes.length === 1 ? 'entry' : 'entries'} corrected.`, 'good');
      };
    },
  });
}
/* ---- volume ---------------------------------------------------------- */

function volumeTab(st) {
  return `<div class="stack-lg">
    ${volumeCard(st)}
    ${completionCard(st)}
  </div>`;
}

function volumeCard(st) {
  if (!st.program) return '';
  const a = volumeAudit(st);
  const [lo, hi] = a.target.sets;
  return `<div class="card">
    <div class="eyebrow" style="margin-bottom:12px">Weekly sets, as programmed</div>
    <div class="stack-sm">
      ${Object.entries(a.cats).map(([k, v]) => {
        const max = Math.max(hi + 5, v + 2);
        const inRange = v >= lo && v <= hi;
        return `<div class="vbar">
          <div class="row-between">
            <span class="small muted">${esc(k)}</span>
            <span class="small mono">${v} sets ${inRange ? '' : `<span class="dim">(target ${lo}–${hi})</span>`}</span>
          </div>
          <div class="vbar__track">
            <div class="vbar__zone" style="left:${(lo / max) * 100}%;width:${((hi - lo) / max) * 100}%"></div>
            <div class="vbar__fill ${inRange ? 'vbar__fill--good' : ''}" style="width:${Math.min(100, (v / max) * 100)}%"></div>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="statgrid" style="margin-top:14px">
      <div class="stat"><div class="stat__k">Total</div><div class="stat__v">${a.total}</div><div class="stat__s">sets / week</div></div>
      <div class="stat"><div class="stat__k">Main lifts</div><div class="stat__v">${Math.round((a.main / a.total) * 100)}<small style="font-size:.75rem">%</small></div><div class="stat__s">${a.main} sets</div></div>
      <div class="stat"><div class="stat__k">Accessory</div><div class="stat__v">${Math.round((a.accessory / a.total) * 100)}<small style="font-size:.75rem">%</small></div><div class="stat__s">${a.accessory} sets</div></div>
    </div>
    <p class="cite" style="margin-top:12px">${esc(a.target.note)} The shaded band on each bar is that target.</p>
  </div>`;
}

function completionCard(st) {
  const done = st.sessions.filter((s) => s.status === 'done');
  if (!done.length) return '';

  // adherence: sets logged vs sets prescribed, by cycle
  //
  // A deload is lighter by design, so averaging its RPE in with the cycle it
  // belongs to drags that cycle down and can invert the comparison this table
  // exists to make — a cycle followed by a deload looks easier than one that is
  // not, whatever the lifter actually felt. Deloads get their own row.
  const rows = new Map();
  for (const s of done) {
    const deload = s.phase === 'deload';
    const key = `${s.cycle}:${deload ? 1 : 0}`;
    const c = rows.get(key) || { cycle: s.cycle, deload, logged: 0, sessions: 0, rpeSum: 0, rpeN: 0 };
    c.sessions += 1;
    for (const e of s.entries) {
      for (const x of e.sets) {
        if (!x.done) continue;
        c.logged += 1;
        if (x.rpe != null) { c.rpeSum += x.rpe; c.rpeN += 1; }
      }
    }
    rows.set(key, c);
  }
  const ordered = [...rows.values()].sort((a, b) => a.cycle - b.cycle || a.deload - b.deload);

  return `<div class="card">
    <div class="eyebrow" style="margin-bottom:12px">By cycle</div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Cycle</th><th class="r">Sessions</th><th class="r">Sets</th><th class="r">Avg RPE</th></tr></thead>
      <tbody>${ordered.map((v) => `<tr>
        <td class="mono">${v.cycle}${v.deload ? ' <span class="dim">deload</span>' : ''}</td>
        <td class="r mono">${v.sessions}</td>
        <td class="r mono">${v.logged}</td>
        <td class="r mono">${v.rpeN ? (v.rpeSum / v.rpeN).toFixed(1) : '—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="cite" style="margin-top:10px">Average RPE creeping up from one cycle's loading weeks to the next, at the same prescribed loads, is an early fatigue signal — it usually shows here before it shows in the checklist. Deload weeks sit on their own row because they are lighter by design.</p>
  </div>`;
}

/* ---- mount ----------------------------------------------------------- */

function mount(root, ctx) {
  $$('[data-tab]', root).forEach((b) => b.onclick = () => { tab = b.dataset.tab; ctx.refresh(); });
  $$('[data-detail]', root).forEach((b) => b.onclick = () => openDetail(ctx, b.dataset.detail));
  $$('[data-session]', root).forEach((b) => b.onclick = () => openSession(ctx, b.dataset.session));
}

export default { id: 'progress', render: view, mount };
