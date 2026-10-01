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
import { fmtLoadBare, plateBreakdown, roundToLoadable, loadStep, e1RM, fmtRPE, normalizeRPE, loadFor, parseNum, convertLoad,
         rpeFor, pctOf1RM, repsLeftWords, RPE_MIN, RPE_MAX } from '../rpe.js';
import { resolveDay, completeSession, discardSession, slotHistory, lastComparable, templateOf,
         loadOptsFor, warmupFor, isSubmaximalSlot, isCompetitionSlot, easyMaxDetail, RELIABLE_E1RM_REPS,
         pctCaption, heavyCheckMax, readsHeavy, cardDropLoad } from '../program.js';
import { RPE_SCALE, REST_GUIDE } from '../templates.js';
// `fmtMax` is the shared formatter for a max, a rate or a gap: to a tenth, never
// snapped to the plate grid — the same one the goal line and the meet sheet use.
import { sessionBriefing, goalNotes, fmtMax } from '../coach.js';
import { meetProgress, targetLine, attemptAdvice, ATTEMPT_NAMES as MEET_ATTEMPT_NAMES } from '../meet.js';
import { optionsForSlot, SLOT_INFO, byId } from '../exercises.js';
import * as timer from '../timer.js';
import * as sync from '../sync.js';

let expanded = null;      // slotKey of the open exercise card
let unsubTimer = null;
/**
 * What the open card's weight readout is rated from, by slotKey — filled in by
 * the render and read by the input handlers, so the readout can follow the
 * lifter's typing without a store update (and so without a re-render that would
 * take the caret away mid-number).
 */
const liveCards = new Map();
/** `${sessionId}:${slotKey}` pairs already given the RPE-calibration note, so it is said once per lift per session. */
const calibrationShown = new Set();

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
  // One pass for the whole day rather than one per card: every note runs the
  // same working-max reconciliation, and the day has at most three of them.
  // With the loads on the cards now, so a top set already stepped down to the
  // weight the goal line asked for is not still called too heavy.
  const goals = goalNotes(resolved, st, { loads: Object.fromEntries(ses.entries.map((e) => [e.slotKey, e.plannedLoad])) });
  if (expanded == null) expanded = firstUnfinished(ses) || ses.entries[0]?.slotKey;
  liveCards.clear();

  const totalSets = ses.entries.reduce((n, e) => n + e.sets.length, 0);
  const doneSets = ses.entries.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
  const allDone = doneSets === totalSets;

  return html`
    <div class="row-between" style="margin-bottom:14px">
      <button class="btn btn--bare" data-home aria-label="Back">${raw(icon('back'))}</button>
      <div class="center grow">
        <div class="eyebrow">${esc(resolved.isMeet ? 'Meet day' : resolved.isTest ? 'Test day' : resolved.isPeak ? resolved.label : resolved.isDeload ? 'Deload' : resolved.isPainWeek ? 'High-rep week' : `Cycle ${ses.cycle} · Week ${ses.week} · Day ${ses.day}`)}</div>
        <div class="tiny dim" style="margin-top:2px">${doneSets} / ${totalSets} sets</div>
      </div>
      <button class="btn btn--bare" data-notes aria-label="Session notes">${raw(icon('note'))}</button>
    </div>

    <div class="stack">
      ${raw(brief.notes.filter((n) => n.kind !== 'cycle').slice(0, 1).map((n) =>
        `<div class="banner ${n.kind === 'deload' ? 'banner--good' : n.kind === 'technique' ? '' : ''}">
          <b>${esc(n.title)}</b><br>${esc(n.text)}</div>`).join(''))}

      ${raw(resolved.isMeet ? meetCard(st, ses) : '')}

      ${raw(ses.entries.map((entry, i) => exerciseCard(entry, resolved, i, st, ses, goals)).join(''))}

      <div class="stack-sm" style="margin-top:8px">
        <button class="btn ${allDone ? 'btn--primary' : 'btn--ghost'} btn--lg btn--block" data-finish>
          ${esc(allDone ? 'Finish session' : `Finish early (${doneSets}/${totalSets})`)}
        </button>
        <button class="btn btn--bare btn--block" data-discard style="color:var(--bad)">Discard session</button>
      </div>

      <p class="cite">${esc(REST_GUIDE.principle)} If you know you rush it: at least 2.5 min on compounds, 1.5 min on the smaller stuff.</p>
    </div>

    <div id="timerslot"></div>`;
}

/* ---- meet day --------------------------------------------------------- */

const ATTEMPT_CLS = { good: 'good', missed: 'bad', pending: '' };

/**
 * The board, between attempts.
 *
 * Nine loads logged one at a time told the lifter nothing about the only number
 * that counts, at exactly the moment every remaining decision is made against
 * it. This is the scoreboard, the goal, and the handler's advice in one card,
 * recomputed from the log so a changed attempt is reflected instantly.
 */
function meetCard(st, ses) {
  const p = meetProgress(st, ses);
  if (!p) return '';
  const units = st.profile.units;
  const goal = st.program?.goalTotal || null;
  const t = targetLine(p, goal);
  const step = units === 'kg' ? 2.5 : 5;
  const advice = p.nextUp ? attemptAdvice(p.nextUp.liftState, { step }) : null;

  const chip = (a) => `<span class="pill ${a.status === 'good' ? 'pill--good' : a.status === 'missed' ? 'pill--bad' : ''} mono"
      title="${esc(a.name)}">${a.load ? fmtLoadBare(a.load) : '—'}${a.status === 'missed' ? ' ✕' : a.status === 'good' ? ' ✓' : ''}</span>`;

  const rows = p.lifts.map((l) => `<div class="kv" style="align-items:center">
    <span class="kv__k">${esc(l.name)}${l.bombed ? ' <span class="pill pill--bad">no lift</span>' : ''}</span>
    <span class="kv__v" style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end">${l.attempts.map(chip).join('')}</span>
  </div>`).join('');

  return `<div class="card ${p.bombed ? 'card--flat' : 'card--accent'}">
    <div class="row-between" style="align-items:flex-end;margin-bottom:10px">
      <div>
        <div class="eyebrow" style="${p.bombed ? '' : 'color:var(--accent)'}">${p.bombed ? 'No total' : 'On the board'}</div>
        <div class="mono" style="font-size:2rem;font-weight:700;letter-spacing:-.03em;line-height:1.1">
          ${p.bombed ? '—' : fmtLoadBare(p.total)}<small style="font-size:.9rem;font-weight:500"> ${esc(units)}</small></div>
      </div>
      <div style="text-align:right">
        <div class="tiny dim">${p.attemptsLeft} attempt${p.attemptsLeft === 1 ? '' : 's'} left</div>
        ${!p.bombed && p.ifAllMade > p.total
          ? `<div class="tiny mono">${fmtLoadBare(p.ifAllMade)} if they all go up</div>` : ''}
      </div>
    </div>

    ${rows}

    ${p.bombed ? `<div class="banner banner--bad" style="margin-top:10px">
      Three misses on one lift is no total, whatever the other two did. It is a bad day and it is not a verdict —
      the loads you made today are still in your log and still count as training.</div>` : ''}

    ${p.nextUp?.liftState?.lastChance ? `<div class="banner banner--bad" style="margin-top:10px">
      <b>Last attempt on the ${esc(p.nextUp.name.toLowerCase())}, nothing on the board.</b>
      Miss this and there is no total at all — not a smaller one. Take a weight you know you have.</div>` : ''}

    <div class="field" style="margin-top:12px;margin-bottom:0">
      <label class="field__label" for="goaltotal">Total you are chasing</label>
      <div class="row" style="gap:8px">
        <input class="input input--num grow" id="goaltotal" type="text" inputmode="decimal"
               value="${goal ?? ''}" placeholder="—" data-goal data-focus-key="goaltotal">
        <span class="pill mono" style="flex:0 0 auto">${esc(units)}</span>
      </div>
      ${t ? `<div class="field__hint">${t.hit
        ? `<b>Done — you are ${fmtLoadBare(-t.toGo)} over.</b> Everything from here is a bigger number, not a safer one.`
        : t.reachable
          ? `<b>${fmtLoadBare(t.toGo)} to go</b>, and the attempts now loaded are worth ${fmtLoadBare(t.headroom)}. It is there.`
          : `<b>${fmtLoadBare(t.toGo)} to go</b> and only ${fmtLoadBare(t.headroom)} loaded — ${fmtLoadBare(t.short)} short. Something left has to go up, or the number does not.`}</div>` : ''}
    </div>

    ${advice && p.nextUp ? `<div class="insight ${advice.kind === 'repeat' || advice.kind === 'grind' ? 'insight--warn' : 'insight--info'}" style="margin-top:12px">
      <div class="insight__icon">${icon('coach')}</div>
      <div class="grow">
        <div class="insight__t">${esc(p.nextUp.name)} · ${esc(p.nextUp.attempt.name.toLowerCase())}</div>
        <div class="insight__b">${esc(advice.text)}</div>
        ${advice.changed && advice.load != null ? `<button class="btn btn--ghost" style="margin-top:10px"
          data-advice="${esc(p.nextUp.slotKey)}" data-advice-n="${p.nextUp.attempt.n - 1}" data-advice-load="${advice.load}">
          ${icon('swap')} Change it to ${fmtLoadBare(advice.load)} ${esc(units)}</button>` : ''}
      </div>
    </div>` : ''}
  </div>`;
}

function exerciseCard(entry, resolved, i, st, ses, goals = []) {
  const slot = resolved.slots.find((s) => s.slotKey === entry.slotKey);
  const ex = byId(entry.exerciseId);
  const isOpen = expanded === entry.slotKey;
  const done = entry.sets.every((s) => s.done);
  const units = st.profile.units;
  const nextIdx = entry.sets.findIndex((s) => !s.done);
  const attemptMode = !!(resolved.isTest || resolved.isMeet);
  const rate = isOpen && !attemptMode ? rateCard(entry, slot, st, nextIdx) : null;
  if (rate) liveCards.set(entry.slotKey, rate);

  const a = slot?.attempts;
  const targetStr = resolved.isTest || resolved.isMeet
    ? (a ? `<b>${fmtLoadBare(a.opener)}</b> · <b>${fmtLoadBare(a.second)}</b> · <b>${fmtLoadBare(a.third)}</b> ${esc(units)}`
         : '<b>Work up by feel</b>')
    : `<b>${entry.targetSets} × ${entry.targetReps ?? '—'}</b>`
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
      ${attemptMode ? rampStrip(slot, units) : lastTimeStrip(st, entry, slot)}
      ${nextIdx === 0 && !attemptMode ? warmupStrip(entry, st) : ''}
      ${slot?.loadNote && nextIdx === 0 ? `<p class="cite" style="margin-bottom:10px">${esc(slot.loadNote)}</p>` : ''}
      ${coarseNote(slot, st)}
      ${rpeCheckNote(slot, entry, units)}
      ${loadStepper(entry, st, { attempts: attemptMode, index: Math.max(0, nextIdx), platform: !!resolved.isMeet })}
      ${rate ? `<div data-readout="${esc(entry.slotKey)}" aria-live="polite">${readoutInner(rate, rateInputs(rate))}</div>` : ''}
      ${goalStrip(goals.find((g) => g.slotKey === entry.slotKey))}
      <div class="sets">
        ${entry.sets.map((s, si) => setRow(entry, s, si, si === nextIdx, units, !!(resolved.isTest || resolved.isMeet))).join('')}
      </div>
      <div class="row" style="gap:8px;margin-top:12px">
        <button class="btn btn--ghost" data-rmset="${esc(entry.slotKey)}" aria-label="Remove the last set"
                ${entry.sets.length <= 1 ? 'disabled' : ''} style="flex:0 0 auto">${icon('minus')}</button>
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
  const grid = loadOptsFor(st, entry.exerciseId);
  const pb = entry.plannedLoad ? plateBreakdown(entry.plannedLoad, grid) : null;
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
    pctCaption(slot, st),
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

/**
 * The goal line, on the card of the lift it is about.
 *
 * On the card rather than at the top of the session, because it is a statement
 * about *this* bar: at the top of the screen it is a slogan, and next to the
 * weight it is a comparison. Folded into a single block with no button on it —
 * there is nothing to tap, because the whole point is that the prescription
 * stays the prescription and this is the context around it.
 *
 * It sits *after* the weight readout and its warning, not above them. Above
 * them, the card could say "take the prescription as written" in the goal
 * line and then, one block further down, "check this weight — take it down";
 * the lifter reads top to bottom and acts on the first instruction. What the
 * weight is for them comes first, and the goal is the context around it. For
 * the same reason a goal note that has found the card itself too heavy
 * (`cardHeavy`) is never shown in the good-news colour, whatever tone it arrives
 * with.
 */
function goalStrip(note) {
  if (!note) return '';
  const tone = note.verdict === 'cardHeavy' && note.tone === 'good' ? 'warn' : note.tone;
  return `<div class="insight insight--${esc(tone)}" style="margin-bottom:12px">
    <div class="insight__icon">${icon('target')}</div>
    <div class="grow">
      <div class="insight__t">${esc(note.title)}</div>
      <div class="insight__b">${esc(note.text)}</div>
      ${note.cite ? `<p class="cite" style="margin:8px 0 0">${esc(note.cite)}</p>` : ''}
    </div>
  </div>`;
}

function plateStrip(pb, units) {
  // A weight stack has no plates and no bar. Drawing one round it was the
  // visible half of the app assuming everything is a barbell.
  if (pb.ladder) {
    return `<div style="margin-bottom:12px"><div class="plates">
      <span class="plates__label">Stack</span>
      <span class="plate">${fmtLoadBare(pb.achieved)} ${esc(units)}</span>
    </div></div>`;
  }
  if (pb.tooLight) return `<p class="cite" style="margin-bottom:10px">Lighter than the bar — use dumbbells or a machine and log the load you use. If this slot always loads that way, set its weight steps in Settings › Equipment.</p>`;
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
  const prev = lastComparable(st, entry.slotKey, {
    reps: entry.targetReps,
    excludeSessionId: st.activeSessionId,
  });
  if (!prev) return '';
  const sets = prev.sets.map((s) => `${fmtLoadBare(s.load)}×${s.reps}${s.rpe ? `@${fmtRPE(s.rpe)}` : ''}`).join('  ');
  // Say which comparison this is. "Last time at 5 reps" from three weeks ago is
  // a useful number; the same numbers labelled "last time" right after a deload
  // are how a lifter concludes they have gone backwards.
  const label = prev.matchedReps
    ? `Last time at ${entry.targetReps} reps · wk ${prev.week}`
    : prev.phase === 'deload' ? `Last time · deload` : `Last time · wk ${prev.week}`;
  return `<div class="card card--flat card--pad-sm" style="margin-bottom:12px">
    <div class="row-between" style="gap:8px">
      <span class="tiny dim">${esc(label)}</span>
      <span class="tiny mono" style="text-align:right">${esc(sets)}</span>
    </div>
  </div>`;
}

/**
 * The ramp to this exercise's working weight, in weights.
 *
 * Shown once per exercise, on the card of the set you are about to do, and
 * folded away by default — a lifter who knows their own ramp should not have to
 * scroll past it six times a session, and one who does not should not have to
 * do percentage arithmetic between sets.
 */
function warmupStrip(entry, st) {
  const w = warmupFor(entry.plannedLoad, entry.targetReps, loadOptsFor(st, entry.exerciseId));
  if (!w) return '';
  const units = st.profile.units;
  return `<details class="acc" style="margin-bottom:12px">
    <summary class="acc__head" style="list-style:none;cursor:pointer">
      ${icon('chevron')}<b style="font-size:.813rem">Warm up to ${fmtLoadBare(entry.plannedLoad)}</b>
      <span class="tiny dim">${w.sets.length} set${w.sets.length === 1 ? '' : 's'}</span>
    </summary>
    <div class="acc__body">
      <div class="tiny mono">${w.sets.map((x) =>
        `${fmtLoadBare(x.load)} × ${esc(String(x.reps))}`).join('  ·  ')}</div>
      <p class="cite" style="margin-top:8px">${esc(w.label)}. Rest as little as you like down here — the ramp is
      preparation, not training, and the only set that counts is the one at ${fmtLoadBare(entry.plannedLoad)} ${units}.</p>
    </div>
  </details>`;
}

/** The warm-up ramp to the opener. On a test day this is most of the session. */
function rampStrip(slot, units) {
  const a = slot?.attempts;
  if (!a || !a.ramp?.length) return '';
  return `<div class="card card--flat card--pad-sm" style="margin-bottom:12px">
    <div class="tiny dim" style="margin-bottom:4px">Warm up to the opener</div>
    <div class="tiny mono">${a.ramp.map((w) => `${fmtLoadBare(w.load)}×${w.reps}`).join('  ·  ')}</div>
    <div class="tiny dim" style="margin-top:6px">Then ${fmtLoadBare(a.opener)} ${esc(units)}. Rest 3-5 min between attempts.</div>
  </div>`;
}

/**
 * Why the weight has not moved since last week on a machine.
 *
 * The anchor goes up every week; a stack with an eight-kilo step cannot express
 * a 2.5 kg rise, so the printed load holds and then jumps three weeks' worth at
 * once. Without a word of explanation that looks exactly like a program that
 * has stopped working, and the obvious response — adding a plate anyway — puts
 * the lifter three weeks ahead of their own progression.
 */
function coarseNote(slot, st) {
  if (!slot || !slot.gridStep || !slot.increment) return '';
  if (slot.gridStep <= slot.increment + 1e-9) return '';
  const weeks = Math.ceil(slot.gridStep / slot.increment);
  return `<p class="cite" style="margin-bottom:10px">The smallest jump here is ${fmtLoadBare(slot.gridStep)} ${esc(st.profile.units)} — about ${weeks} weeks of this lift's ${fmtLoadBare(slot.increment)} ${esc(st.profile.units)} increment. The weight holds and then steps; that is the progression working, not stalling. Add reps inside the range rather than weight while it holds.</p>`;
}

/* ---- what this weight is for you --------------------------------------- */

/**
 * How far above the lifter's own call the table has to put a set before the
 * call is worth questioning out loud. A point either way is ordinary noise in a
 * rating out of ten; a point and a half is the same margin `afterSet` uses for
 * "you opened too heavy", and on a technique day it is the difference between
 * the RPE 5 the day is written at and a set with three reps left in it.
 */
const CALIBRATION_GAP = 1.5;

/** The RPE a card is asked for: a single target, or the middle of a range. */
const targetRPEOf = (entry) => entry.targetRPE ?? (entry.rpeRange ? (entry.rpeRange[0] + entry.rpeRange[1]) / 2 : null);

/**
 * What `load` × `reps` asks of a lifter whose max is `max`, read off the same
 * table every prescription in the app is built from.
 *
 * `rpeFor` pins to the ends of the table outside it, and both ends are worth
 * naming instead of printing: "RPE 10" for a double heavier than the max says is
 * possible, and "RPE 4" for a bar that is barely a warm-up, are each an
 * understatement a lifter would take as the real number.
 */
function rateLoad(max, load, reps) {
  const rpe = rpeFor(max, load, reps);
  if (rpe == null) return null;
  const pct = (load / max) * 100;
  return {
    rpe, pct,
    over: pct > pctOf1RM(reps, RPE_MAX) + 0.05,
    under: rpe <= RPE_MIN && pct < pctOf1RM(reps, RPE_MIN) - 0.05,
  };
}

const rpeWords = (r, { about = true } = {}) => r.over ? 'past RPE 10'
  : r.under ? `under RPE ${RPE_MIN}` : `${about ? 'about ' : ''}RPE ${fmtRPE(r.rpe)}`;
// Reps left in the app's one phrasing (`repsLeftWords`). Under the floor the
// table cannot count, and its floor's own words — "6+ reps left" — are the
// true thing to say about a bar lighter than it.
const leftWords = (r) => r.over ? 'more than that max has in it'
  : repsLeftWords(r.under ? RPE_MIN : r.rpe);

/**
 * The max a readout is rated against, named so the lifter can tell which one it
 * is. Only the app's own estimate is labelled: a tested, recorded or miss-capped
 * figure is simply theirs, and the recorded one is named in full wherever it is
 * the *other* number on the line.
 */
const maxWords = (basis) => basis.basis === 'estimate' ? `your estimated ${fmtMax(basis.value)}`
  : basis.basis === 'miss' ? `your ${fmtMax(basis.value)} (held under your miss)`
  : `your ${fmtMax(basis.value)}`;

/**
 * The app's working max, named by what it was read from — for the one line
 * that sets it beside the recorded max and has to say which is which.
 */
const workingWords = (basis) => {
  const v = fmtMax(basis.value);
  if (basis.basis === 'estimate') return `your recent sets (${v})`;
  if (basis.basis === 'miss') return `the app's working max (${v}, held under your miss)`;
  if (basis.basis === 'tested') return `your tested max (${v})`;
  return `the app's working max (${v})`;
};

/**
 * Everything the weight readout needs, fixed when the card renders.
 *
 * The max comes from the resolved slot (`rateBasis`) rather than being worked
 * out again here, so the readout and the prescription cannot disagree about
 * which number the day was built from: the lower of the working and recorded
 * maxes on easy work, the working max on everything else. Null on a card with
 * no competition-lift max behind it — an accessory, or a lift with no data yet.
 */
function rateCard(entry, slot, st, nextIdx) {
  const basis = slot?.rateBasis;
  if (!basis?.value) return null;
  const next = nextIdx >= 0 ? entry.sets[nextIdx] : null;
  return {
    slotKey: entry.slotKey,
    nextIdx,
    basis,
    // What "too heavy" is judged against, and the weight to come down to —
    // from program.js, so the goal line on the same card uses the same two.
    check: heavyCheckMax(slot),
    dropTo: cardDropLoad(st, slot),
    recorded: slot.recordedMax,
    recordedFresh: !!slot.recordedFresh,
    step: loadStep(loadOptsFor(st, entry.exerciseId)),
    target: targetRPEOf(entry),
    prescribed: slot.plannedLoad,
    working: entry.plannedLoad,
    targetReps: entry.targetReps,
    nextLoad: next?.load ?? null,
    nextReps: next?.reps ?? null,
    submax: isSubmaximalSlot(st, entry.slotKey),
    units: st.profile.units,
  };
}

/**
 * The set the tick would log right now: the next set's own load and reps if it
 * has them, otherwise the working load and the target — the same fallbacks
 * `logSet` uses, so the readout describes exactly the set about to be recorded.
 *
 * With `root` it reads what is typed in the next set's boxes, for the input
 * handlers; `load` is a value being typed into the stepper, which only reaches
 * the sets when it is committed.
 */
function rateInputs(c, { root = null, load = null, reps = null } = {}) {
  const k = c.nextIdx >= 0 ? `${c.slotKey}-${c.nextIdx}` : null;
  const loadEl = root && k ? root.querySelector(`[data-set-load="${CSS.escape(k)}"]`) : null;
  const repsEl = root && k ? root.querySelector(`[data-set-reps="${CSS.escape(k)}"]`) : null;
  return {
    load: load ?? (loadEl ? num(loadEl.value) : c.nextLoad) ?? c.working,
    reps: reps ?? (repsEl ? num(repsEl.value) : c.nextReps) ?? c.targetReps,
  };
}

/**
 * What this weight is for you: the load about to go on the bar, as a percentage
 * of the lifter's max and as the RPE the table says it is.
 *
 * The app has always had this number and has only ever used it on itself. A
 * lifter asked for RPE 5 had to judge RPE 5 — at four to six reps shy of
 * failure, exactly where RPE calls are least accurate (Zourdos et al. 2016, JSCR
 * 30(1); 2021, JSCR 35(S1)) — and nothing on the screen said what the bar in
 * front of them was against their own max. The book's advice is to use %1RM
 * alongside RPE rather than instead of it (Helms, Pyramid Training v2,
 * pp. 65-66, 217), and this is that, for the one set about to be taken: it
 * follows the stepper and the typed load, so the lifter who reads 130 where the
 * card says 122.5 sees, before loading it, that 130 × 2 is RPE 7 for them.
 *
 * When the card is rated against something other than the recorded max — the
 * working max on a heavy day — and the two are more than a plate step apart,
 * the recorded figure gets its own clause, so the number the lifter actually
 * knows is never hidden behind one the app worked out.
 *
 * Only up to `RELIABLE_E1RM_REPS`, for the reason that constant exists: past
 * about six reps the table stops describing individuals.
 */
function readoutInner(c, { load, reps }) {
  if (!(load > 0) || !(reps >= 1) || reps > RELIABLE_E1RM_REPS) return '';
  const r = rateLoad(c.basis.value, load, reps);
  if (!r) return '';
  let line = `<b class="mono">${esc(`${fmtLoadBare(load)} × ${reps}`)}</b> — `
    // To a tenth, like the caption beside it (`pctCaption`): one bar, one percentage.
    + esc(`${fmtMax(r.pct)}% of ${maxWords(c.basis)} · ${rpeWords(r)} (${leftWords(r)})`);
  const rec = c.recorded;
  // Only a record recent enough to count (`RECORD_BINDS_DAYS`): a max from a
  // previous block, quoted on every heavy card as "past RPE 10", is noise.
  if (c.basis.basis !== 'recorded' && c.recordedFresh && rec > 0 && Math.abs(rec - c.basis.value) > c.step + 1e-9) {
    const rr = rateLoad(rec, load, reps);
    if (rr) line += `<span class="dim">${esc(` · ${rpeWords(rr, { about: false })} against the ${fmtMax(rec)} you recorded`)}</span>`;
  }
  return `<div class="card card--flat card--pad-sm" style="margin-bottom:12px">
      <div class="tiny dim" style="margin-bottom:2px">What this weight is for you</div>
      <div class="small">${line}</div>
    </div>
    ${c.nextIdx >= 0 ? weightWarning(c, load, reps) : ''}`;
}

/**
 * If the weight about to go on the bar is heavier than the RPE on the card, say
 * so before the set.
 *
 * Every other check on this screen compares the prescription against the
 * lifter's logged RPEs, which is the wrong way round when the logged RPEs are
 * the thing that has drifted. A load prescribed at RPE 5, completed, and then
 * logged at RPE 5 agrees with itself perfectly while being an RPE 8 triple.
 * This compares it against the max the card was built from instead, and does it
 * before the bar is loaded rather than three cycles later.
 *
 * It rates the load the lifter is about to take, not the one the app printed.
 * Checking only the prescription made it circular — the easy-day load is a
 * percentage of a max, so rated against the same max it always agrees with
 * itself — and it said nothing at all about the weight the lifter actually
 * steps or types, which on the day that prompted this was 130 on a card that
 * meant 122.5. On easy work it is phrased for easy work: the question there is
 * not whether the set is completable (it always is) but whether it is still the
 * day it is written as.
 *
 * Only in the heavy direction. "Your recent sets say you could do more" is a
 * real thing to tell someone, but `rpeCheckNote` already tells them, off this
 * slot's own comparable sets rather than off a cross-slot max, which is the
 * better comparison for it. Firing here as well turned one competition-lift slot
 * in ten into a warning; kept to the direction nothing else covers, it is three
 * in a thousand, and every one of them is a load the lifter should question.
 *
 * One threshold and one max, shared with the goal line on the same card: the
 * load is judged by `readsHeavy` (one `CARD_RPE_SLACK` over the target) against
 * `heavyCheckMax` — the lower of the card's own rating max and the recorded
 * one — both from program.js. Judged against the working max alone, a heavy
 * day could never warn, because its card is a percentage of that max; and the
 * goal line, judging by the lower figure, said "take the top set down to
 * 157.5" over a banner that said nothing.
 *
 * But on a heavy day the lower figure and the working max can genuinely
 * disagree, and the working max is not a guess to be overruled: it is what the
 * lifter's recent sets say, the day is autoregulated, and its first set is
 * rated near failure, where calls are accurate. So when the weight is heavy
 * against the recorded max and *not* against the working max, the banner does
 * not tell the lifter to take it down. It shows both readings, lets the first
 * set decide, names the weight to drop to if it grinds (`cardDropLoad`, the
 * goal line's number too), and points at Settings for the case where the
 * recorded max is the stale one. Only when the working max agrees that it is
 * heavy is the wording firm.
 */
function weightWarning(c, load, reps) {
  const target = c.target;
  const check = c.check;
  if (target == null || !check || !readsHeavy(check.value, load, reps, target)) return '';
  const r = rateLoad(check.value, load, reps);
  if (!r) return '';
  const what = `${fmtLoadBare(load)} ${c.units} × ${reps}`;
  const rx = c.prescribed != null ? `${fmtLoadBare(c.prescribed)} ${c.units}` : null;
  const atRx = rx == null || Math.abs(load - c.prescribed) < 1e-9;
  const agree = 'take it down until the two agree — the RPE is the prescription and the weight is only the app\'s guess at it.';
  // The card's own max finds it heavy too — or is the same number.
  const same = Math.abs(check.value - c.basis.value) < 1e-9;
  const firm = same || readsHeavy(c.basis.value, load, reps, target);
  const w = same ? null : rateLoad(c.basis.value, load, reps);
  let title = 'Check this weight.';
  let body;
  if (c.submax) {
    // Easy work: `rateBasis` is already the lower max, so there is nothing to disagree about.
    // Past the table there is no "kind" of day it belongs to: it is more than
    // the max says the lifter can do at all, and that is the whole sentence.
    const reads = r.over ? `is more than ${maxWords(check)} says you can do` : `is ${rpeWords(r)} for you`;
    const kind = r.over ? '' : r.rpe >= 7 ? ' — a strength-day weight' : ' — more than an easy day asks for';
    body = `${what} ${reads}${kind}. Today is written at RPE ${fmtRPE(target)}; `
      + (atRx ? agree : `the prescription is ${rx}.`);
  } else if (!firm) {
    title = 'Your two maxes disagree.';
    body = `${what} is ${rpeWords(r)} against the ${fmtMax(check.value)} you recorded, `
      + `${rpeWords(w, { about: false })} against ${workingWords(c.basis)}. Let the first set decide`
      + (c.dropTo != null ? `: if it grinds, drop to ${fmtLoadBare(c.dropTo)} ${c.units}.` : '.')
      + ' If you have got stronger, record the new max in Settings.';
  } else {
    // Heavy against both. Name both when they are different numbers, so the
    // lifter can see the app's own estimate is not what is being overruled.
    const both = w && Math.abs(check.value - c.basis.value) > c.step + 1e-9;
    const reads = both
      ? `${rpeWords(r)} against the ${fmtMax(check.value)} you recorded and ${rpeWords(w, { about: false })} against ${workingWords(c.basis)}`
      : `${rpeWords(r)} against ${maxWords(check)}`;
    body = `${what} is ${reads}, and this slot is asking for RPE ${fmtRPE(target)}`
      + (atRx ? `. ${agree[0].toUpperCase()}${agree.slice(1)}`
        : ` — the prescription is ${rx}. Take it back down: the RPE is the prescription, and this weight is past it.`);
  }
  return `<div class="banner banner--warn" style="margin-bottom:12px"><b>${esc(title)}</b> ${esc(body)}</div>`;
}

/**
 * The one moment a call can be checked against something that is not a call.
 *
 * A set logged with an RPE on a competition lift, rated against the max the
 * lifter recorded — tested, entered, or typed in Settings; any source, because
 * the point is the lifter's own number — and the two compared. When the table
 * puts the set well above the call, the call is the less likely of the two to
 * be right: RPE is least accurate far from failure, and the error runs in the
 * lifter's favour (Zourdos et al. 2016, 2021). The app used to take the call
 * and build the next easy day from it. It no longer does, and this is where the
 * lifter is told so, at the moment the evidence is fresh.
 *
 * Not on meet or test attempts — a single there is a measurement in its own
 * right, not a call about one — and not past `RELIABLE_E1RM_REPS`, where the
 * table stops being the better witness.
 *
 * And only on submaximal work (`isSubmaximalSlot`). That is where a call is
 * furthest from failure and least accurate, and it is the only place the note's
 * own claim is true — easy days are built from the recorded max, heavy days are
 * not. On a strength day the call is five reps closer to failure, the day is
 * autoregulated off it, and a toast after every heavy set disputing it with a
 * max the card was not built from is the app arguing with the lifter mid-session
 * about a number it has already said (the weight readout, before the set).
 * Heavy-day calls still count: the Coach tab's calibration insight
 * (`rpeCalibration` in coach.js) reads all of them, in aggregate, where a
 * pattern means something and a single call does not.
 */
function calibrationNote(st, ses, slot, set, rpe) {
  const lift = slot?.slot?.lift;
  if (!lift || !isCompetitionSlot(slot.slot) || rpe == null) return null;
  if (!isSubmaximalSlot(st, slot.slotKey)) return null;
  // The same window the Coach tab's calibration uses: a record is evidence
  // about a call only near the day it was recorded.
  const rec = slot.recordedFresh ? slot.recordedMax : null;
  if (!(rec > 0) || !set || set.failed || !(set.reps >= 1) || set.reps > RELIABLE_E1RM_REPS || !(set.load > 0)) return null;
  const units = st.profile.units;
  const from = ses.units || units;
  const load = convertLoad(set.load, from, units);
  const r = rateLoad(rec, load, set.reps);
  // A set heavier than the recorded max allows is not a light call, it is a
  // stale max: the lifter has just done something that number says they cannot.
  // Settings and the test day are where that gets fixed, not this note.
  if (!r || r.over || r.rpe - rpe < CALIBRATION_GAP) return null;
  const shown = from === units ? fmtLoadBare(set.load) : fmtMax(load);
  const easy = easyMaxDetail(st, lift);
  const tail = easy?.basis === 'recorded'
    ? 'Easy days now go by your recorded max, not the call.'
    : 'Easy days are built from the lower of that and the app\'s working max, never from the call.';
  return `${shown} × ${set.reps} is ${rpeWords(r)} against your ${fmtMax(rec)} — you called it ${fmtRPE(rpe)}. ${tail}`;
}

/** If the lifter's own RPE data disagrees with the wave, say so plainly. */
function rpeCheckNote(slot, entry, units) {
  // Measured against what the program prescribed, not against the stepper: a
  // lifter who has just stepped down to the weight the heavy-card banner named
  // must not be told "the program says" their own weight, and pushed back up.
  const rx = entry.prescribedLoad ?? slot?.plannedLoad;
  if (!slot || !slot.rpeCheckLoad || !rx) return '';
  const diff = slot.rpeCheckLoad - rx;
  if (Math.abs(diff) < (slot.increment || 2.5) * 1.5) return '';
  const heavier = diff > 0;
  // And never suggest a heavier weight that the card's own heavy check calls
  // too heavy: the app would be giving both halves of an argument with itself.
  if (heavier && readsHeavy(heavyCheckMax(slot)?.value, slot.rpeCheckLoad, entry.targetReps, targetRPEOf(entry))) return '';
  return `<div class="banner banner--warn" style="margin-bottom:12px">
    <b>Worth a look.</b> The program says ${fmtLoadBare(rx)} ${esc(units)}, but your recent
    sets suggest ${fmtLoadBare(slot.rpeCheckLoad)} ${esc(units)} is what ${entry.targetReps} reps at RPE
    ${fmtRPE(entry.targetRPE ?? 8)} actually looks like for you right now — ${fmtLoadBare(Math.abs(diff))} ${esc(units)}
    ${heavier ? 'heavier' : 'lighter'}. The RPE is the prescription; the number is a guess. Your call.
  </div>`;
}

/**
 * The +/- on the working load.
 *
 * On an ordinary day there is one working load and it carries across the sets,
 * so nudging it nudges everything unlogged. On a day of attempts there are
 * three different weights in one exercise and they are not a series — changing
 * your second attempt must not silently rewrite your third, which is what this
 * did before it knew the difference. In attempt mode it moves exactly the one
 * you are about to take, in the increment that day is contested in: the
 * platform's 2.5 kg on meet day, the gym's own step on a test day.
 */
function loadStepper(entry, st, { attempts = false, index = 0, platform = false } = {}) {
  const grid = loadOptsFor(st, entry.exerciseId);
  const step = attempts && platform ? (st.profile.units === 'kg' ? 2.5 : 5) : loadStep(grid);
  const set = attempts ? entry.sets[index] : null;
  const value = attempts ? (set?.load ?? '') : (entry.plannedLoad ?? '');
  const tag = attempts ? ` data-attempt="${index}" data-attempt-step="${step}"` : '';
  const label = attempts ? `${MEET_ATTEMPT_NAMES[index] || `Attempt ${index + 1}`} load` : 'Working load';

  return `<div class="stepper" style="margin-bottom:12px">
    <button class="stepper__btn" data-load-delta="${-step}" data-slot="${esc(entry.slotKey)}"${tag} aria-label="Less weight">−</button>
    <div class="stepper__val">
      <input type="text" inputmode="decimal" value="${value}" placeholder="—"
             data-load-set="${esc(entry.slotKey)}"${tag} data-focus-key="load-${esc(entry.slotKey)}" aria-label="${esc(label)}">
      <span class="stepper__unit">${esc(st.profile.units)}</span>
    </div>
    <button class="stepper__btn" data-load-delta="${step}" data-slot="${esc(entry.slotKey)}"${tag} aria-label="More weight">+</button>
  </div>
  ${attempts ? `<p class="cite" style="margin:-4px 0 10px">Moves your ${esc((MEET_ATTEMPT_NAMES[index] || 'next').toLowerCase())} only — the other attempts stay where you put them.</p>` : ''}`;
}

/** On a test day the three sets are not "1, 2, 3" — they have names. */
const ATTEMPT_NAMES = ['1st', '2nd', '3rd'];

function setRow(entry, s, si, isNext, units, isTest = false) {
  const cls = s.failed ? 'set--failed' : s.done ? 'set--done' : isNext ? 'set--next' : '';
  const k = `${entry.slotKey}-${si}`;
  const label = isTest ? esc(ATTEMPT_NAMES[si] || si + 1) : si + 1;

  // A miss has no rep count and no RPE to report — the weight and the fact that
  // it did not go up is the whole record. Collapsing those two cells says that
  // more plainly than a zero and a 10 sitting in boxes that mean something else.
  const body = s.failed
    ? `<div class="set__miss">missed</div>`
    : `<div class="set__cell">
      <span class="set__k">Reps</span>
      <input class="set__in" type="text" inputmode="numeric"
             value="${s.reps ?? ''}" placeholder="${entry.targetReps ?? '—'}"
             data-set-reps="${k}" data-focus-key="sr-${k}" aria-label="Set ${si + 1} reps">
    </div>
    <div class="set__cell">
      <span class="set__k">RPE</span>
      <button class="set__in set__in--rpe" data-set-rpe="${k}" aria-label="Set ${si + 1} RPE">${s.rpe != null ? fmtRPE(s.rpe) : '–'}</button>
    </div>`;

  return `<div class="set ${cls}">
    <div class="set__n"${isTest ? ' style="font-size:.688rem;letter-spacing:0"' : ''}>${label}</div>
    <div class="set__cell">
      <span class="set__k">${esc(units)}</span>
      <input class="set__in" type="text" inputmode="decimal"
             value="${s.load ?? ''}" placeholder="${entry.plannedLoad ?? '—'}"
             data-set-load="${k}" data-focus-key="sl-${k}" aria-label="Set ${si + 1} load"${s.failed ? ' disabled' : ''}>
    </div>
    ${body}
    <button class="set__tick" data-tick="${k}" aria-label="${s.done ? 'Unlog' : 'Log'} set ${si + 1}">${icon(s.failed ? 'x' : 'check')}</button>
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

/**
 * The RPE picker, asked as the question the number stands for.
 *
 * "How many reps did you leave?" invites the answer the lifter hoped for; "how
 * many more good reps could you have done?" is the definition (RPE = 10 − RIR)
 * put as something to count. Every button says its reps left in plain words and
 * the whole ladder is printed under them, not only 10 to 7: the technique day is
 * written at 5 and the primer at 4, and a picker that only explained the heavy
 * end left the calls that are hardest to make — and that an easy day is made of
 * — as bare numbers.
 */
function openRPE(ctx, key, { onPick } = {}) {
  const [slotKey, si] = splitKey(key);
  const st = ctx.state;
  const ses = sessionOf(st);
  const entry = entryOf(ses, slotKey);
  const target = targetRPEOf(entry);
  const cur = entry.sets[si]?.rpe;
  const load = entry.sets[si]?.load ?? entry.plannedLoad;

  sheet({
    title: 'How many more good reps could you have done?',
    body: `<div class="stack">
      <div class="rpegrid">
        ${RPE_SCALE.map((r) => `
          <button class="rpebtn ${target === r.rpe ? 'rpebtn--target' : ''}" data-rpe="${r.rpe}" aria-pressed="${cur === r.rpe}"
                  aria-label="${esc(`RPE ${fmtRPE(r.rpe)}: ${r.meaning}`)}">
            <b>${fmtRPE(r.rpe)}</b><span>${esc(r.left)}</span>
          </button>`).join('')}
      </div>
      <div class="stack-sm">
        ${RPE_SCALE.map((r) => target === r.rpe
          ? `<div class="rpe-scale" style="color:var(--accent)"><b class="mono">${fmtRPE(r.rpe)}</b> — ${esc(r.meaning)} <b>Today's target.</b></div>`
          : `<div class="rpe-scale"><b class="mono">${fmtRPE(r.rpe)}</b> — ${esc(r.meaning)}</div>`).join('')}
      </div>
      ${target != null ? `<p class="cite">Today's target was RPE ${fmtRPE(target)}. Log what it actually was, not what it was supposed to be — the whole system runs on this number being honest.</p>` : ''}

      <div class="stack-sm">
        <button class="btn btn--danger btn--block" data-miss>${icon('x')} I missed it</button>
        <p class="cite">RPE 10 means you finished the rep with nothing left — there is no RPE for a lift
        that did not go up, and logging one as a ten tells the app you did something you did not do.
        A miss is recorded as an attempt at ${load ? `${fmtLoadBare(load)} ` : ''}that failed: it counts
        against the set, it never feeds an estimate, and the app will remember you have already found
        out about that weight today.</p>
      </div>
    </div>`,
    onMount(root, close) {
      for (const b of $$('[data-rpe]', root)) {
        b.onclick = () => {
          const rpe = Number(b.dataset.rpe);
          close();
          onPick ? onPick(rpe) : setRPE(ctx, slotKey, si, rpe);
        };
      }
      $('[data-miss]', root).onclick = () => {
        close();
        markMissed(ctx, slotKey, si);
      };
    },
  });
}

/**
 * Record an attempt that did not come back up.
 *
 * Reps go to zero rather than staying at whatever the target was: every reader
 * downstream — the estimate, the tested max, the tonnage — is already written to
 * ignore a set with no reps in it, so the one honest number does all the work
 * and nothing has to learn a new special case. The RPE is cleared for the same
 * reason: there was no RPE.
 */
function markMissed(ctx, slotKey, si) {
  ctx.store.update((s) => {
    const e = entryOf(sessionOf(s), slotKey);
    if (!e?.sets[si]) return;
    e.sets[si] = {
      ...e.sets[si],
      load: e.sets[si].load ?? e.plannedLoad,
      reps: 0, rpe: null, failed: true, done: true,
      ts: e.sets[si].ts || new Date().toISOString(),
    };
  });
  haptic(24);
  toast('Logged as a miss. It will not be counted as a lift.', 'bad', 3200);
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
      // Un-ticking a miss puts the row back to an empty attempt rather than to
      // an attempt of zero reps, which is not a thing anyone logs on purpose.
      if (e.sets[si].failed) { e.sets[si].failed = false; e.sets[si].reps = null; }
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

  const day = resolvedSlot(ctx, slotKey);
  const restFor = restSeconds(day.slot);
  openRPE(ctx, key, {
    onPick: (rpe) => {
      setRPE(ctx, slotKey, si, rpe);
      afterSet(ctx, slotKey, si, rpe, restFor, day);
    },
  });
}

function afterSet(ctx, slotKey, si, rpe, restFor, { resolved = null, slot = null } = {}) {
  const st = ctx.state;
  const ses = sessionOf(st);
  const entry = entryOf(ses, slotKey);
  const target = entry.targetRPE;

  // Start resting unless that was the last set of the last exercise.
  const more = ses.entries.some((e) => e.sets.some((s) => !s.done));
  if (more && st.settings.restTimerAuto) {
    timer.start(restFor, 'Rest');
  }

  // The call against the lifter's own recorded max, once per lift per session
  // — three identical toasts for three identical triples is nagging, and the
  // first one has already made the point. Toasts are set as text, not markup,
  // so nothing in them needs escaping.
  const attempts = !resolved || resolved.isTest || resolved.isMeet;
  const calibration = attempts ? null : calibrationNote(st, ses, slot, entry.sets[si], rpe);
  const shownKey = `${ses.id}:${slotKey}`;
  if (calibration && !calibrationShown.has(shownKey)) {
    calibrationShown.add(shownKey);
    toast(calibration, '', 6400);
  }

  // The book's own warning: if you blow past the target on the first set you
  // opened too heavy. Say it once, at the moment it is actionable. "Room to add
  // weight" is not said when the table has just disagreed with the call it
  // rests on: that would be the app believing the one number it has just
  // pointed out is light.
  if (si === 0 && target != null && rpe >= target + 1.5 && entry.sets.length > 1) {
    toast(`That was RPE ${fmtRPE(rpe)} against a target of ${fmtRPE(target)} — consider dropping the load for the rest of the sets.`, 'bad', 5200);
  } else if (si === 0 && target != null && rpe <= target - 1.5 && !calibration) {
    toast(`RPE ${fmtRPE(rpe)} against a target of ${fmtRPE(target)} — you have room to add weight.`, '', 4200);
  }

  // move on when the exercise is finished
  if (entry.sets.every((s) => s.done)) {
    const next = firstUnfinished(ses);
    if (next) expanded = next;
  }
}

/** The running session's day, resolved once per logged set, and the slot being logged on it. */
function resolvedSlot(ctx, slotKey) {
  const st = ctx.state;
  const ses = sessionOf(st);
  const resolved = resolveDay(st, { cycle: ses.cycle, week: ses.week, day: ses.day, phase: ses.phase });
  return { resolved, slot: resolved.slots.find((s) => s.slotKey === slotKey) || null };
}

function restSeconds(slot) {
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
  const missingRPE = ses.entries.some((e) => e.sets.some((s) => s.done && !s.failed && s.rpe == null));

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

/**
 * Bin the session and go home.
 *
 * The confirmation names the number of logged sets rather than asking a generic
 * "are you sure", because those two cases deserve different amounts of hesitation
 * — a session opened to look at and a session with nine sets in it are the same
 * tap and very different mistakes.
 */
async function discard(ctx) {
  const st = ctx.state;
  const ses = sessionOf(st);
  if (!ses) { ctx.go('today'); return; }
  const logged = ses.entries.reduce((n, e) => n + e.sets.filter((x) => x.done).length, 0);

  const okToGo = await confirmSheet({
    title: 'Discard this session?',
    message: logged
      ? `${logged} logged set${logged === 1 ? '' : 's'} will be deleted and nothing will be written to your history. Your cycle stays exactly where it is.`
      : 'Nothing has been logged, so nothing is lost. Your cycle stays exactly where it is.',
    confirmLabel: logged ? `Discard ${logged} set${logged === 1 ? '' : 's'}` : 'Discard',
    danger: true,
  });
  if (!okToGo) return;

  timer.stop();
  expanded = null;
  ctx.store.update((s) => { discardSession(s, ses.id); });
  toast('Session discarded.');
  ctx.go('today');
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
  const logged = ses.entries.flatMap((e) => e.sets.filter((s) => s.done));
  const sets = logged.filter((s) => !s.failed);
  const misses = ses.entries.flatMap((e) => e.sets
    .filter((s) => s.done && s.failed)
    .map((s) => ({ ...s, name: byId(e.exerciseId)?.short || e.slotKey })));
  const tonnage = sets.reduce((n, s) => n + convertLoad(s.load, from, units) * s.reps, 0);
  const avgRPE = sets.filter((s) => s.rpe != null);
  const dur = ses.startedAt && ses.endedAt ? (new Date(ses.endedAt) - new Date(ses.startedAt)) / 1000 : null;

  const prs = ses.entries.map((e) => {
    const best = e.sets.filter((s) => s.done && !s.failed)
      .map((s) => e1RM(convertLoad(s.load, from, units), s.reps, s.rpe ?? e.targetRPE ?? 8) || 0);
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

      ${misses.length ? `<div class="insight insight--warn">
        <div class="insight__icon">${icon('x')}</div>
        <div><div class="insight__t">${misses.length} missed attempt${misses.length === 1 ? '' : 's'}</div>
        <div class="insight__b">${misses.map((m) => `${esc(m.name)} ${fmtLoadBare(convertLoad(m.load, from, units))} ${esc(units)}`).join(' · ')}.
        Logged as attempts, not as lifts — nothing here moves your estimate. A weight you missed once is
        worth another go on a fresher day; a weight you have missed twice is telling you something else.</div></div>
      </div>` : ''}

      ${prs.length ? `<div class="insight insight--good">
        <div class="insight__icon">${icon('trophy')}</div>
        <div><div class="insight__t">Estimated max up on ${prs.length} lift${prs.length === 1 ? '' : 's'}</div>
        <div class="insight__b">${prs.map((p) => `${esc(p.name)} +${fmtLoadBare(p.gain)} ${esc(units)}`).join(' · ')}</div></div>
      </div>` : ''}

      ${notes.map((n) => `<div class="insight insight--${n.kind === 'tested' ? 'good' : n.kind === 'deloadHard' || n.kind === 'shortfall' ? 'info' : 'warn'}">
        <div class="insight__icon">${icon(n.kind === 'tested' ? 'trophy' : n.kind === 'deloadHard' ? 'rest' : n.kind === 'shortfall' ? 'info' : 'warn')}</div>
        <div><div class="insight__t">${esc(n.title || 'Worth knowing')}</div><div class="insight__b">${esc(n.text)}</div></div>
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
  $$('[data-discard]', root).forEach((b) => b.onclick = () => discard(ctx));

  // Adding or removing a set is the lifter re-prescribing, not failing to
  // complete a prescription — so the target moves with it. Without this,
  // trimming a set you never meant to do read as coming up short of the program.
  $$('[data-addset]', root).forEach((b) => b.onclick = () => {
    ctx.store.update((s) => {
      const e = entryOf(sessionOf(s), b.dataset.addset);
      e.sets.push({ load: e.plannedLoad, reps: null, rpe: null, done: false, ts: null });
      e.targetSets = e.sets.length;
    });
  });

  // Removing takes the last set, which is the one an extra set always is. A set
  // with something logged in it asks first: an extra set added by a mis-tap and
  // a set with three logged reps in it are the same button and very different
  // mistakes, and only one of them is recoverable by tapping again.
  $$('[data-rmset]', root).forEach((b) => b.onclick = async () => {
    const slotKey = b.dataset.rmset;
    const entry = entryOf(sessionOf(ctx.state), slotKey);
    if (!entry || entry.sets.length <= 1) return;
    const last = entry.sets[entry.sets.length - 1];
    if (last.done) {
      const yes = await confirmSheet({
        title: 'Delete the last set?',
        message: last.failed
          ? `A missed attempt at ${fmtLoadBare(last.load)} ${ctx.state.profile.units} is logged here. Deleting it removes it from your history.`
          : `${fmtLoadBare(last.load)} ${ctx.state.profile.units} × ${last.reps} is logged here. Deleting it removes it from your history.`,
        confirmLabel: 'Delete it', danger: true,
      });
      if (!yes) return;
    }
    ctx.store.update((s) => {
      const e = entryOf(sessionOf(s), slotKey);
      if (e && e.sets.length > 1) { e.sets.pop(); e.targetSets = e.sets.length; }
    });
    haptic(8);
  });

  // load stepper: changing the working load updates every unlogged set too —
  // except in attempt mode, where it moves only the attempt you are about to take
  $$('[data-load-delta]', root).forEach((b) => b.onclick = () => {
    const delta = Number(b.dataset.loadDelta);
    const slotKey = b.dataset.slot;
    const ai = b.dataset.attempt == null ? null : Number(b.dataset.attempt);
    const astep = Number(b.dataset.attemptStep) || Math.abs(delta);
    ctx.store.update((s) => {
      const e = entryOf(sessionOf(s), slotKey);
      if (ai != null) {
        const set = e.sets[ai];
        if (!set || set.done) return;
        set.load = Math.max(0, Math.round(((set.load ?? 0) + delta) / astep) * astep);
        return;
      }
      const base = e.plannedLoad ?? 0;
      const next = roundToLoadable(Math.max(0, base + delta), loadOptsFor(s, e.exerciseId));
      e.plannedLoad = next;
      for (const set of e.sets) if (!set.done) set.load = next;
    });
    haptic(8);
  });

  // The weight readout follows the typing, not only the commit. A typed load
  // reaches the store on change (blur or enter), and the store re-renders the
  // screen; doing that per keystroke would take the caret away mid-number. So
  // while typing, only the readout's own box is repainted, from what is in the
  // inputs — nothing is saved, and nothing else on the card moves under the
  // lifter's thumb. The stepper's +/- and the commit re-render as they always
  // did, and the readout is recomputed from the store then.
  const relive = (slotKey, over = {}) => {
    const c = liveCards.get(slotKey);
    const box = root.querySelector(`[data-readout="${CSS.escape(slotKey)}"]`);
    if (!c || !box) return;
    box.innerHTML = readoutInner(c, rateInputs(c, { root, ...over }));
  };

  $$('[data-load-set]', root).forEach((el) => {
    el.onchange = () => {
      const slotKey = el.dataset.loadSet;
      const ai = el.dataset.attempt == null ? null : Number(el.dataset.attempt);
      const v = num(el.value);
      ctx.store.update((s) => {
        const e = entryOf(sessionOf(s), slotKey);
        if (ai != null) { if (e.sets[ai] && !e.sets[ai].done) e.sets[ai].load = v; return; }
        e.plannedLoad = v;
        for (const set of e.sets) if (!set.done) set.load = v;
      });
    };
    // The working load becomes every unlogged set's load on commit, so while it
    // is being typed it *is* the load the readout rates.
    if (el.dataset.attempt == null) el.oninput = () => relive(el.dataset.loadSet, { load: num(el.value) });
  });

  // the goal total, and the handler's advice about the next attempt
  $$('[data-goal]', root).forEach((el) => el.onchange = () => {
    const v = num(el.value);
    ctx.store.update((s) => { s.program.goalTotal = v && v > 0 ? v : null; });
    ctx.refresh();
  });

  $$('[data-advice]', root).forEach((b) => b.onclick = () => {
    const slotKey = b.dataset.advice;
    const i = Number(b.dataset.adviceN);
    const load = Number(b.dataset.adviceLoad);
    ctx.store.update((s) => {
      const e = entryOf(sessionOf(s), slotKey);
      if (e?.sets[i] && !e.sets[i].done) e.sets[i].load = load;
    });
    haptic(14);
    toast(`Attempt changed to ${fmtLoadBare(load)} ${ctx.state.profile.units}.`);
    ctx.refresh();
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
  // ...and the next set's boxes are what the tick will log, so the readout
  // follows them too. Those saves are silent, so this is also the only thing
  // that keeps the readout current once they are committed.
  for (const [sel, attr] of [['[data-set-load]', 'setLoad'], ['[data-set-reps]', 'setReps']]) {
    $$(sel, root).forEach((el) => el.oninput = () => {
      const [slotKey, si] = splitKey(el.dataset[attr]);
      if (liveCards.get(slotKey)?.nextIdx === si) relive(slotKey);
    });
  }

  // rest timer
  unsubTimer?.();
  unsubTimer = timer.subscribe(paintTimer);
  paintTimer();

  if (ctx.state.settings.keepAwake) timer.keepAwake(true);
}

export default { id: 'session', render: view, mount };
