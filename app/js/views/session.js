/* ==========================================================================
   views/session.js — the in-gym screen
   --------------------------------------------------------------------------
   Design constraints that drive everything here: you are holding the phone
   with one hand, possibly with chalk on it, between heavy sets. So: the next
   set to log is always the biggest target on screen, loads are prefilled,
   logging a set is two taps (tick, then RPE), and the rest timer is derived
   from a timestamp so locking the phone cannot break it.
   ========================================================================== */

import { html, raw, esc, icon, $, $$, toast, sheet, closeSheet, confirmSheet, fmtDuration, haptic } from '../ui.js';
import { fmtLoadBare, plateBreakdown, roundToLoadable, minIncrement, e1RM, fmtRPE, normalizeRPE, loadFor, parseNum, convertLoad } from '../rpe.js';
import { resolveDay, completeSession, slotHistory, templateOf } from '../program.js';
import { RPE_SCALE, REST_GUIDE } from '../templates.js';
import { sessionBriefing } from '../coach.js';
import { optionsForSlot, SLOT_INFO, byId } from '../exercises.js';
import * as timer from '../timer.js';
import * as sync from '../sync.js';

let expanded = null;      // slotKey of the open exercise card
let unsubTimer = null;

/* ---- helpers ---------------------------------------------------------- */

const sessionOf = (st) => st.sessions.find((s) => s.id === st.activeSessionId && s.status === 'active');

function firstUnfinished(ses) {
  for (const e of ses.entries) {
    if (e.sets.some((s) => !s.done)) return e.slotKey;
  }
  return null;
}

function entryOf(ses, slotKey) { return ses.entries.find((e) => e.slotKey === slotKey); }

/* ---- render ----------------------------------------------------------- */

function view(ctx) {
  const st = ctx.state;
  const ses = sessionOf(st);
  if (!ses) {
    return html`<div class="empty">${raw(icon('info'))}<p>No session is running.</p>
      <button class="btn btn--primary" data-home>Back to today</button></div>`;
  }

  const resolved = resolveDay(st, { cycle: ses.cycle, week: ses.week, day: ses.day, phase: ses.phase });
  const brief = sessionBriefing(resolved, st);
  if (expanded == null) expanded = firstUnfinished(ses) || ses.entries[0]?.slotKey;

  const totalSets = ses.entries.reduce((n, e) => n + e.sets.length, 0);
  const doneSets = ses.entries.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
  const allDone = doneSets === totalSets;

  return html`
    <div class="row-between" style="margin-bottom:14px">
      <button class="btn btn--bare" data-home aria-label="Back">${raw(icon('back'))}</button>
      <div class="center grow">
        <div class="eyebrow">${esc(resolved.isDeload ? 'Deload' : `Cycle ${ses.cycle} · Week ${ses.week}`)} · Day ${ses.day}</div>
        <div class="tiny dim" style="margin-top:2px">${doneSets} / ${totalSets} sets</div>
      </div>
      <button class="btn btn--bare" data-notes aria-label="Session notes">${raw(icon('note'))}</button>
    </div>

    <div class="stack">
      ${raw(brief.notes.filter((n) => n.kind !== 'cycle').slice(0, 1).map((n) =>
        `<div class="banner ${n.kind === 'deload' ? 'banner--good' : n.kind === 'technique' ? '' : ''}">
          <b>${esc(n.title)}</b><br>${esc(n.text)}</div>`).join(''))}

      ${raw(ses.entries.map((entry, i) => exerciseCard(entry, resolved, i, st, ses)).join(''))}

      <div class="stack-sm" style="margin-top:8px">
        <button class="btn ${allDone ? 'btn--primary' : 'btn--ghost'} btn--lg btn--block" data-finish>
          ${esc(allDone ? 'Finish session' : `Finish early (${doneSets}/${totalSets})`)}
        </button>
      </div>

      <p class="cite">${esc(REST_GUIDE.principle)} If you know you rush it: at least 2.5 min on compounds, 1.5 min on the smaller stuff.</p>
    </div>

    <div id="timerslot"></div>`;
}

function exerciseCard(entry, resolved, i, st, ses) {
  const slot = resolved.slots.find((s) => s.slotKey === entry.slotKey);
  const ex = byId(entry.exerciseId);
  const isOpen = expanded === entry.slotKey;
  const done = entry.sets.every((s) => s.done);
  const units = st.profile.units;
  const nextIdx = entry.sets.findIndex((s) => !s.done);

  const targetStr = `<b>${entry.targetSets} × ${entry.targetReps ?? '—'}</b>`
    + (entry.targetRPE != null ? ` @ RPE <b>${fmtRPE(entry.targetRPE)}</b>`
      : entry.rpeRange ? ` @ RPE <b>${entry.rpeRange[0]}-${entry.rpeRange[1]}</b>` : '');

  return `<div class="ex ${isOpen ? 'ex--active' : ''} ${done ? 'ex--done' : ''}">
    <button class="ex__head" data-expand="${esc(entry.slotKey)}">
      <div class="ex__num">${done ? icon('check') : i + 1}</div>
      <div class="grow">
        <div class="ex__name">${esc(ex?.short || entry.slotKey)}</div>
        <div class="ex__target">${targetStr}</div>
      </div>
      <div style="text-align:right;flex:0 0 auto">
        <div class="mono" style="font-weight:700">${entry.plannedLoad ? fmtLoadBare(entry.plannedLoad) : '—'}</div>
        <div class="tiny dim">${esc(units)}</div>
      </div>
    </button>

    ${isOpen ? `<div class="ex__body">
      ${rxStrip(entry, slot, st)}
      ${lastTimeStrip(st, entry, slot)}
      ${slot?.loadNote && nextIdx === 0 ? `<p class="cite" style="margin-bottom:10px">${esc(slot.loadNote)}</p>` : ''}
      ${rpeCheckNote(slot, entry, units)}
      ${loadStepper(entry, st)}
      <div class="sets">
        ${entry.sets.map((s, si) => setRow(entry, s, si, si === nextIdx, units)).join('')}
      </div>
      <div class="row" style="gap:8px;margin-top:12px">
        <button class="btn btn--ghost grow" data-addset="${esc(entry.slotKey)}">${icon('plus')} Set</button>
        <button class="btn btn--ghost grow" data-swap="${esc(entry.slotKey)}">${icon('swap')} Swap</button>
        <button class="btn btn--ghost grow" data-exnote="${esc(entry.slotKey)}">${icon('note')}</button>
      </div>
      ${entry.note ? `<p class="cite" style="margin-top:10px">${esc(entry.note)}</p>` : ''}
    </div>` : ''}
  </div>`;
}

function rxStrip(entry, slot, st) {
  const units = st.profile.units;
  const pb = entry.plannedLoad ? plateBreakdown(entry.plannedLoad, { barWeight: st.profile.barWeight, plates: st.profile.plates }) : null;
  const range = slot?.loadRange || null;

  // The weight to aim for leads; the RPE it encodes drops to the caption. The
  // RPE is still what gets logged — it is what keeps these ranges honest.
  const hero = range
    ? (range.exact ? fmtLoadBare(range.low) : `${fmtLoadBare(range.low)} – ${fmtLoadBare(range.high)}`)
    : entry.plannedLoad ? fmtLoadBare(entry.plannedLoad) : null;

  const rpeStr = entry.targetRPE != null ? `RPE ${fmtRPE(entry.targetRPE)}`
    : entry.rpeRange ? `RPE ${entry.rpeRange[0]}–${entry.rpeRange[1]}` : null;
  const caption = [
    `${entry.targetSets}×${entry.targetReps ?? '—'}`,
    rpeStr,
    slot?.pct != null ? `${slot.pct}% ref` : null,
  ].filter(Boolean).join(' · ');

  return `<div class="rx">
    <div class="rx__box rx__box--load">
      <span class="rx__k">${range && !range.exact ? 'Aim for' : 'Target load'}</span>
      <span class="rx__v rx__v--hero">${hero ? `${hero} <small>${esc(units)}</small>` : '<small>work up by feel</small>'}</span>
      <span class="rx__sub">${esc(caption)}</span>
    </div>
  </div>
  ${pb ? plateStrip(pb, units) : ''}`;
}

function plateStrip(pb, units) {
  if (pb.tooLight) return `<p class="cite" style="margin-bottom:10px">Lighter than the bar — use dumbbells or a machine and log the load you use.</p>`;
  return `<div style="margin-bottom:12px">
    <div class="plates">
      <span class="plates__label">Per side</span>
      ${pb.perSide.length
        ? pb.perSide.map((p) => `<span class="plate">${p.plate}${p.count > 1 ? ` × ${p.count}` : ''}</span>`).join('')
        : `<span class="plate">bare bar</span>`}
      ${!pb.ok ? `<span class="plate" style="background:var(--warn-wash);color:var(--warn)">${pb.remainder > 0 ? `${fmtLoadBare(pb.remainder)} short` : 'rounded'}</span>` : ''}
    </div>
    ${barViz(pb)}
  </div>`;
}

/** A little picture of the loaded bar — quicker to read than a list. */
function barViz(pb) {
  if (!pb.perSide.length) return '';
  const maxPlate = Math.max(...pb.perSide.map((p) => p.plate));
  const plates = [];
  for (const { plate, count } of pb.perSide) {
    for (let i = 0; i < count; i++) plates.push(plate);
  }
  const h = (p) => 14 + Math.round((p / maxPlate) * 26);
  return `<div class="barviz" aria-hidden="true">
    <div class="barviz__sleeve"></div>
    ${[...plates].reverse().map((p) => `<div class="barviz__p" style="height:${h(p)}px"></div>`).join('')}
    <div class="barviz__bar"></div>
    ${plates.map((p) => `<div class="barviz__p" style="height:${h(p)}px"></div>`).join('')}
    <div class="barviz__sleeve"></div>
  </div>`;
}

function lastTimeStrip(st, entry, slot) {
  const hist = slotHistory(st, entry.slotKey);
  const prev = hist.filter((h) => h.sessionId !== st.activeSessionId).slice(-1)[0];
  if (!prev) return '';
  const sets = prev.sets.map((s) => `${fmtLoadBare(s.load)}×${s.reps}${s.rpe ? `@${fmtRPE(s.rpe)}` : ''}`).join('  ');
  return `<div class="card card--flat card--pad-sm" style="margin-bottom:12px">
    <div class="row-between" style="gap:8px">
      <span class="tiny dim">Last time · wk ${prev.week}</span>
      <span class="tiny mono" style="text-align:right">${esc(sets)}</span>
    </div>
  </div>`;
}

/** If the lifter's own RPE data disagrees with the wave, say so plainly. */
function rpeCheckNote(slot, entry, units) {
  if (!slot || !slot.rpeCheckLoad || !entry.plannedLoad) return '';
  const diff = slot.rpeCheckLoad - entry.plannedLoad;
  if (Math.abs(diff) < (slot.increment || 2.5) * 1.5) return '';
  const heavier = diff > 0;
  return `<div class="banner banner--warn" style="margin-bottom:12px">
    <b>Worth a look.</b> The program says ${fmtLoadBare(entry.plannedLoad)} ${esc(units)}, but your recent
    sets suggest ${fmtLoadBare(slot.rpeCheckLoad)} ${esc(units)} is what ${entry.targetReps} reps at RPE
    ${fmtRPE(entry.targetRPE ?? 8)} actually looks like for you right now — ${fmtLoadBare(Math.abs(diff))} ${esc(units)}
    ${heavier ? 'heavier' : 'lighter'}. The RPE is the prescription; the number is a guess. Your call.
  </div>`;
}

function loadStepper(entry, st) {
  const step = minIncrement(st.profile.plates, { microplates: st.profile.microplates });
  return `<div class="stepper" style="margin-bottom:12px">
    <button class="stepper__btn" data-load-delta="${-step}" data-slot="${esc(entry.slotKey)}" aria-label="Less weight">−</button>
    <div class="stepper__val">
      <input type="text" inputmode="decimal" value="${entry.plannedLoad ?? ''}" placeholder="—"
             data-load-set="${esc(entry.slotKey)}" data-focus-key="load-${esc(entry.slotKey)}" aria-label="Working load">
      <span class="stepper__unit">${esc(st.profile.units)}</span>
    </div>
    <button class="stepper__btn" data-load-delta="${step}" data-slot="${esc(entry.slotKey)}" aria-label="More weight">+</button>
  </div>`;
}

function setRow(entry, s, si, isNext, units) {
  const cls = s.done ? 'set--done' : isNext ? 'set--next' : '';
  const k = `${entry.slotKey}-${si}`;
  return `<div class="set ${cls}">
    <div class="set__n">${si + 1}</div>
    <div class="set__cell">
      <span class="set__k">${esc(units)}</span>
      <input class="set__in" type="text" inputmode="decimal"
             value="${s.load ?? ''}" placeholder="${entry.plannedLoad ?? '—'}"
             data-set-load="${k}" data-focus-key="sl-${k}" aria-label="Set ${si + 1} load">
    </div>
    <div class="set__cell">
      <span class="set__k">Reps</span>
      <input class="set__in" type="text" inputmode="numeric"
             value="${s.reps ?? ''}" placeholder="${entry.targetReps ?? '—'}"
             data-set-reps="${k}" data-focus-key="sr-${k}" aria-label="Set ${si + 1} reps">
    </div>
    <div class="set__cell">
      <span class="set__k">RPE</span>
      <button class="set__in set__in--rpe" data-set-rpe="${k}" aria-label="Set ${si + 1} RPE">${s.rpe != null ? fmtRPE(s.rpe) : '–'}</button>
    </div>
    <button class="set__tick" data-tick="${k}" aria-label="${s.done ? 'Unlog' : 'Log'} set ${si + 1}">${icon(s.done ? 'check' : 'check')}</button>
  </div>`;
}

/* ---- rest timer widget ------------------------------------------------ */

function paintTimer() {
  const slot = document.getElementById('timerslot');
  if (!slot) return;
  const s = timer.snapshot();
  if (!s.running) { slot.innerHTML = ''; return; }
  const remaining = Math.max(0, Math.ceil(s.remaining));
  const over = s.overdue;
  slot.innerHTML = `<div class="timerbar ${over ? 'timerbar--over' : ''}">
    <div class="timerbar__fill" style="width:${Math.round(Math.min(1, s.progress) * 100)}%"></div>
    <div class="timerbar__row">
      <div>
        <div class="timerbar__label">${over ? 'Ready' : esc(s.label)}</div>
        <div class="timerbar__time">${over ? `+${fmtDuration(-s.remaining)}` : fmtDuration(remaining)}</div>
      </div>
      <div class="spacer"></div>
      <button class="timerbar__btn" data-t="-30">−30</button>
      <button class="timerbar__btn" data-t="30">+30</button>
      <button class="timerbar__btn" data-t="stop" aria-label="Stop rest timer">${icon('x')}</button>
    </div>
  </div>`;
  for (const b of slot.querySelectorAll('[data-t]')) {
    b.onclick = () => {
      const v = b.dataset.t;
      if (v === 'stop') timer.stop();
      else timer.adjust(Number(v));
      paintTimer();
    };
  }
}

/* ---- RPE picker ------------------------------------------------------- */

function openRPE(ctx, key, { onPick } = {}) {
  const [slotKey, si] = splitKey(key);
  const st = ctx.state;
  const ses = sessionOf(st);
  const entry = entryOf(ses, slotKey);
  const target = entry.targetRPE ?? (entry.rpeRange ? (entry.rpeRange[0] + entry.rpeRange[1]) / 2 : null);
  const cur = entry.sets[si]?.rpe;

  sheet({
    title: 'How many reps did you leave?',
    body: `<div class="stack">
      <div class="rpegrid">
        ${RPE_SCALE.map((r) => `
          <button class="rpebtn ${target === r.rpe ? 'rpebtn--target' : ''}" data-rpe="${r.rpe}" aria-pressed="${cur === r.rpe}">
            <b>${fmtRPE(r.rpe)}</b><span>${esc(r.rir === '0' ? 'nothing left' : `${r.rir} left`)}</span>
          </button>`).join('')}
      </div>
      <div class="stack-sm">
        ${RPE_SCALE.filter((r) => [10, 9, 8, 7].includes(r.rpe)).map((r) =>
          `<div class="rpe-scale"><b class="mono">${fmtRPE(r.rpe)}</b> — ${esc(r.meaning)}</div>`).join('')}
      </div>
      ${target != null ? `<p class="cite">Today's target was RPE ${fmtRPE(target)}. Log what it actually was, not what it was supposed to be — the whole system runs on this number being honest.</p>` : ''}
    </div>`,
    onMount(root, close) {
      for (const b of $$('[data-rpe]', root)) {
        b.onclick = () => {
          const rpe = Number(b.dataset.rpe);
          close();
          onPick ? onPick(rpe) : setRPE(ctx, slotKey, si, rpe);
        };
      }
    },
  });
}

const splitKey = (k) => { const i = k.lastIndexOf('-'); return [k.slice(0, i), Number(k.slice(i + 1))]; };

function setRPE(ctx, slotKey, si, rpe) {
  ctx.store.update((s) => {
    const ses = sessionOf(s);
    const e = entryOf(ses, slotKey);
    if (e?.sets[si]) e.sets[si].rpe = rpe;
  });
}

/* ---- actions ---------------------------------------------------------- */

function logSet(ctx, key) {
  const [slotKey, si] = splitKey(key);
  const root = document.getElementById('view');
  const loadEl = $(`[data-set-load="${CSS.escape(key)}"]`, root);
  const repsEl = $(`[data-set-reps="${CSS.escape(key)}"]`, root);

  const st = ctx.state;
  const ses = sessionOf(st);
  const entry = entryOf(ses, slotKey);
  if (!entry) return;

  const already = entry.sets[si]?.done;
  if (already) {
    ctx.store.update((s) => {
      const e = entryOf(sessionOf(s), slotKey);
      e.sets[si].done = false;
      e.sets[si].ts = null;
    });
    return;
  }

  const load = num(loadEl?.value) ?? entry.plannedLoad;
  const reps = num(repsEl?.value) ?? entry.targetReps;
  if (!load || !reps) {
    toast('Put a weight and a rep count in first.', 'bad');
    return;
  }

  timer.unlockAudio();
  haptic(14);

  // Log the numbers immediately, then ask for RPE — never lose the set if the
  // RPE prompt gets dismissed.
  ctx.store.update((s) => {
    const e = entryOf(sessionOf(s), slotKey);
    const oldPlanned = e.plannedLoad;
    e.sets[si] = { ...e.sets[si], load, reps, done: true, ts: new Date().toISOString() };

    // You hold the load for the remaining sets, so carry it forward — this is
    // what makes a by-feel slot loggable in one tap after the first set. Only
    // overwrite sets still sitting on the old suggestion, never a load the
    // lifter typed in deliberately.
    if (load !== oldPlanned) {
      e.plannedLoad = load;
      for (let i = si + 1; i < e.sets.length; i++) {
        const set = e.sets[i];
        if (!set.done && (set.load == null || set.load === oldPlanned)) set.load = load;
      }
    }
  });

  const restFor = restSeconds(ctx, slotKey);
  openRPE(ctx, key, {
    onPick: (rpe) => {
      setRPE(ctx, slotKey, si, rpe);
      afterSet(ctx, slotKey, si, rpe, restFor);
    },
  });
}

function afterSet(ctx, slotKey, si, rpe, restFor) {
  const st = ctx.state;
  const ses = sessionOf(st);
  const entry = entryOf(ses, slotKey);
  const target = entry.targetRPE;

  // Start resting unless that was the last set of the last exercise.
  const more = ses.entries.some((e) => e.sets.some((s) => !s.done));
  if (more && st.settings.restTimerAuto) {
    timer.start(restFor, 'Rest');
  }

  // The book's own warning: if you blow past the target on the first set you
  // opened too heavy. Say it once, at the moment it is actionable.
  if (si === 0 && target != null && rpe >= target + 1.5 && entry.sets.length > 1) {
    toast(`That was RPE ${fmtRPE(rpe)} against a target of ${fmtRPE(target)} — consider dropping the load for the rest of the sets.`, 'bad', 5200);
  } else if (si === 0 && target != null && rpe <= target - 1.5) {
    toast(`RPE ${fmtRPE(rpe)} against a target of ${fmtRPE(target)} — you have room to add weight.`, '', 4200);
  }

  // move on when the exercise is finished
  if (entry.sets.every((s) => s.done)) {
    const next = firstUnfinished(ses);
    if (next) expanded = next;
  }
}

function restSeconds(ctx, slotKey) {
  const st = ctx.state;
  const ses = sessionOf(st);
  const resolved = resolveDay(st, { cycle: ses.cycle, week: ses.week, day: ses.day, phase: ses.phase });
  const slot = resolved.slots.find((s) => s.slotKey === slotKey);
  const role = slot?.role;
  return role === 'isolation' || role === 'accessory' ? REST_GUIDE.isolation : REST_GUIDE.compound;
}

const num = parseNum;

function openSwap(ctx, slotKey) {
  const st = ctx.state;
  const ses = sessionOf(st);
  const entry = entryOf(ses, slotKey);
  const tpl = templateOf(st.program);
  let slotDef = null;
  for (const d of tpl.days) { const f = d.slots.find((x) => x.key === slotKey); if (f) slotDef = f; }
  if (!slotDef) return;

  const info = SLOT_INFO[slotDef.slotType] || {};
  const opts = optionsForSlot(slotDef.slotType, { preferFreeWeight: slotDef.slotType === 'horizontalPull' });

  sheet({
    title: `Swap — ${info.label || slotDef.slotType}`,
    body: `<div class="stack">
      <p class="small muted">${esc(info.rule || '')}</p>
      <div class="banner">Changing this here changes it for this session only. Use the toggle below to change it for the whole program.</div>
      <label class="pick" style="cursor:pointer">
        <input type="checkbox" data-permanent style="width:20px;height:20px;accent-color:var(--accent)">
        <div class="pick__body"><div class="pick__title">Change it for every future session too</div></div>
      </label>
      <div class="stack-sm">
        ${opts.map((e) => `<button class="pick" data-pick="${esc(e.id)}" aria-pressed="${e.id === entry.exerciseId}">
          <span class="pick__mark">${icon('check')}</span>
          <div class="pick__body">
            <div class="pick__title">${esc(e.short)}</div>
            ${e.notes ? `<div class="pick__sub">${esc(e.notes.length > 140 ? e.notes.slice(0, 140) + '…' : e.notes)}</div>` : ''}
          </div>
        </button>`).join('')}
      </div>
    </div>`,
    onMount(root, close) {
      const permEl = $('[data-permanent]', root);
      for (const b of $$('[data-pick]', root)) {
        b.onclick = () => {
          const id = b.dataset.pick;
          const permanent = !!permEl?.checked;
          ctx.store.update((s) => {
            const e = entryOf(sessionOf(s), slotKey);
            e.exerciseId = id;
            if (permanent) s.program.choices[slotKey] = id;
          });
          close();
          toast(permanent ? 'Changed for the whole program.' : 'Changed for this session.');
        };
      }
    },
  });
}

function openNote(ctx, slotKey) {
  const st = ctx.state;
  const ses = sessionOf(st);
  const entry = slotKey ? entryOf(ses, slotKey) : null;
  const cur = slotKey ? entry?.note : ses.notes;

  sheet({
    title: slotKey ? `Note — ${byId(entry.exerciseId)?.short || ''}` : 'Session notes',
    body: `<div class="stack">
      <textarea class="input" data-note rows="5" placeholder="${slotKey ? 'Cues, how it felt, anything technical worth remembering.' : 'How the session went. Sleep, food, mood, anything that explains the numbers.'}">${esc(cur || '')}</textarea>
      ${!slotKey ? sessionRPEBlock(ses) : ''}
      <button class="btn btn--primary btn--block" data-save>Save</button>
    </div>`,
    onMount(root, close) {
      let pickedRPE = ses.sessionRPE;
      for (const b of $$('[data-srpe]', root)) {
        b.onclick = () => {
          pickedRPE = Number(b.dataset.srpe);
          for (const sib of $$('[data-srpe]', root)) sib.setAttribute('aria-pressed', String(sib === b));
        };
      }
      $('[data-save]', root).onclick = () => {
        const text = $('[data-note]', root).value;
        ctx.store.update((s) => {
          const sess = sessionOf(s);
          if (slotKey) entryOf(sess, slotKey).note = text;
          else { sess.notes = text; sess.sessionRPE = pickedRPE ?? null; }
        });
        close();
      };
    },
  });
}

function sessionRPEBlock(ses) {
  return `<div class="field">
    <div class="field__label">Session difficulty</div>
    <div class="seg">
      ${[1, 2, 3, 4, 5].map((n) => `<button class="seg__btn" data-srpe="${n}" aria-pressed="${ses.sessionRPE === n}">${n}</button>`).join('')}
    </div>
    <div class="field__hint">1 = easy, 5 = brutal. Worth logging — it feeds the deload checklist.</div>
  </div>`;
}

async function finish(ctx) {
  const st = ctx.state;
  const ses = sessionOf(st);
  const doneSets = ses.entries.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
  const totalSets = ses.entries.reduce((n, e) => n + e.sets.length, 0);
  const missingRPE = ses.entries.some((e) => e.sets.some((s) => s.done && s.rpe == null));

  if (doneSets === 0) {
    const bail = await confirmSheet({
      title: 'Discard this session?',
      message: 'Nothing was logged, so there is nothing to keep.',
      confirmLabel: 'Discard', danger: true,
    });
    if (!bail) return;
    ctx.store.update((s) => {
      s.sessions = s.sessions.filter((x) => x.id !== ses.id);
      s.activeSessionId = null;
    });
    expanded = null;
    ctx.go('today');
    return;
  }

  if (doneSets < totalSets) {
    const yes = await confirmSheet({
      title: 'Finish with sets left?',
      message: `${totalSets - doneSets} of ${totalSets} sets are unlogged. Unlogged sets are dropped, and coming up short on a strength day counts as a stall — which is exactly what you want it to do if you genuinely came up short.`,
      confirmLabel: 'Finish anyway',
    });
    if (!yes) return;
  }

  if (missingRPE) {
    const yes = await confirmSheet({
      title: 'Some sets have no RPE',
      message: 'RPE is what drives every load suggestion from here on. Finishing without it means those sets cannot inform your next session.',
      confirmLabel: 'Finish anyway',
    });
    if (!yes) return;
  }

  let notes = [];
  ctx.store.update((s) => {
    // Drop the sets that never happened so they do not count as misses.
    const sess = sessionOf(s);
    for (const e of sess.entries) e.sets = e.sets.filter((x) => x.done);
    notes = completeSession(s, ses.id).notes;
    s.activeSessionId = null;
  });

  timer.stop();
  expanded = null;

  // Queue then fire and forget: the summary sheet must appear instantly whether
  // or not there is signal in the gym, and the queue survives a closed app.
  sync.enqueue(ses.id);
  sync.flush({ reason: 'session-finish' });

  // Re-read from the store: `ses` is the pre-completion copy, so it has no
  // endedAt and its unlogged sets have not been dropped yet.
  showSummary(ctx, ses.id, notes);
}

function showSummary(ctx, sessionId, notes) {
  const st = ctx.state;
  const ses = st.sessions.find((s) => s.id === sessionId);
  if (!ses) { ctx.go('today'); return; }
  const units = st.profile.units;
  // Normally identical, but a unit switch between starting and finishing would
  // otherwise have this compare the session's raw numbers against a converted
  // history and invent a personal record.
  const from = ses.units || units;
  const sets = ses.entries.flatMap((e) => e.sets.filter((s) => s.done));
  const tonnage = sets.reduce((n, s) => n + convertLoad(s.load, from, units) * s.reps, 0);
  const avgRPE = sets.filter((s) => s.rpe != null);
  const dur = ses.startedAt && ses.endedAt ? (new Date(ses.endedAt) - new Date(ses.startedAt)) / 1000 : null;

  const prs = ses.entries.map((e) => {
    const best = e.sets.filter((s) => s.done).map((s) => e1RM(convertLoad(s.load, from, units), s.reps, s.rpe ?? e.targetRPE ?? 8) || 0);
    const hist = slotHistory(st, e.slotKey).filter((h) => h.sessionId !== ses.id);
    const prev = hist.length ? Math.max(...hist.map((h) => h.best1RM)) : 0;
    const now = best.length ? Math.max(...best) : 0;
    return now > prev && prev > 0 ? { name: byId(e.exerciseId)?.short, gain: now - prev, now } : null;
  }).filter(Boolean);

  sheet({
    title: 'Session logged',
    dismissable: false,
    body: `<div class="stack">
      <div class="statgrid">
        <div class="stat"><div class="stat__k">Sets</div><div class="stat__v">${sets.length}</div></div>
        <div class="stat"><div class="stat__k">Volume</div><div class="stat__v">${Math.round(tonnage).toLocaleString()}</div><div class="stat__s">${esc(units)} lifted</div></div>
        ${avgRPE.length ? `<div class="stat"><div class="stat__k">Avg RPE</div><div class="stat__v">${(avgRPE.reduce((n, s) => n + s.rpe, 0) / avgRPE.length).toFixed(1)}</div></div>` : ''}
        ${dur ? `<div class="stat"><div class="stat__k">Time</div><div class="stat__v">${Math.round(dur / 60)}<small style="font-size:.75rem"> min</small></div></div>` : ''}
      </div>

      ${prs.length ? `<div class="insight insight--good">
        <div class="insight__icon">${icon('trophy')}</div>
        <div><div class="insight__t">Estimated max up on ${prs.length} lift${prs.length === 1 ? '' : 's'}</div>
        <div class="insight__b">${prs.map((p) => `${esc(p.name)} +${fmtLoadBare(p.gain)} ${esc(units)}`).join(' · ')}</div></div>
      </div>` : ''}

      ${notes.map((n) => `<div class="insight insight--warn">
        <div class="insight__icon">${icon('warn')}</div>
        <div><div class="insight__t">Stall recorded</div><div class="insight__b">${esc(n.text)}</div></div>
      </div>`).join('')}

      <button class="btn btn--primary btn--lg btn--block" data-done>Done</button>
    </div>`,
    onMount(root, close) {
      $('[data-done]', root).onclick = () => { close(); ctx.go('today'); };
    },
  });
}

/* ---- mount ----------------------------------------------------------- */

function mount(root, ctx) {
  $$('[data-home]', root).forEach((b) => b.onclick = () => ctx.go('today'));
  $$('[data-expand]', root).forEach((b) => b.onclick = () => {
    expanded = expanded === b.dataset.expand ? null : b.dataset.expand;
    ctx.refresh();
  });
  $$('[data-tick]', root).forEach((b) => b.onclick = () => logSet(ctx, b.dataset.tick));
  $$('[data-set-rpe]', root).forEach((b) => b.onclick = () => openRPE(ctx, b.dataset.setRpe));
  $$('[data-swap]', root).forEach((b) => b.onclick = () => openSwap(ctx, b.dataset.swap));
  $$('[data-exnote]', root).forEach((b) => b.onclick = () => openNote(ctx, b.dataset.exnote));
  $$('[data-notes]', root).forEach((b) => b.onclick = () => openNote(ctx, null));
  $$('[data-finish]', root).forEach((b) => b.onclick = () => finish(ctx));

  $$('[data-addset]', root).forEach((b) => b.onclick = () => {
    ctx.store.update((s) => {
      const e = entryOf(sessionOf(s), b.dataset.addset);
      e.sets.push({ load: e.plannedLoad, reps: null, rpe: null, done: false, ts: null });
    });
  });

  // load stepper: changing the working load updates every unlogged set too
  $$('[data-load-delta]', root).forEach((b) => b.onclick = () => {
    const delta = Number(b.dataset.loadDelta);
    const slotKey = b.dataset.slot;
    ctx.store.update((s) => {
      const e = entryOf(sessionOf(s), slotKey);
      const base = e.plannedLoad ?? 0;
      const next = roundToLoadable(Math.max(0, base + delta), {
        barWeight: s.profile.barWeight, plates: s.profile.plates, microplates: s.profile.microplates,
      });
      e.plannedLoad = next;
      for (const set of e.sets) if (!set.done) set.load = next;
    });
    haptic(8);
  });

  $$('[data-load-set]', root).forEach((el) => el.onchange = () => {
    const slotKey = el.dataset.loadSet;
    const v = num(el.value);
    ctx.store.update((s) => {
      const e = entryOf(sessionOf(s), slotKey);
      e.plannedLoad = v;
      for (const set of e.sets) if (!set.done) set.load = v;
    });
  });

  // per-set inputs persist on blur so nothing is lost when navigating away
  $$('[data-set-load]', root).forEach((el) => el.onchange = () => {
    const [slotKey, si] = splitKey(el.dataset.setLoad);
    const v = num(el.value);
    ctx.store.update((s) => { const e = entryOf(sessionOf(s), slotKey); if (e?.sets[si]) e.sets[si].load = v; }, { silent: true });
  });
  $$('[data-set-reps]', root).forEach((el) => el.onchange = () => {
    const [slotKey, si] = splitKey(el.dataset.setReps);
    const v = num(el.value);
    ctx.store.update((s) => { const e = entryOf(sessionOf(s), slotKey); if (e?.sets[si]) e.sets[si].reps = v; }, { silent: true });
  });

  // rest timer
  unsubTimer?.();
  unsubTimer = timer.subscribe(paintTimer);
  paintTimer();

  if (ctx.state.settings.keepAwake) timer.keepAwake(true);
}

export default { id: 'session', render: view, mount };
