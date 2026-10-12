/* ==========================================================================
   views/askview.js — ask the coach a question, between sets
   --------------------------------------------------------------------------
   One running conversation, kept on this device. The coach's answer shows
   which of the app's tools it checked, and flags any weight it stated that no
   tool gave it — see `uncheckedLoads` in ask.js.

   Everything else in the app works without this screen: the calculator, the
   log and the program are all local. This is the one place that needs signal.
   ========================================================================== */

import { esc, icon, $, toast } from '../ui.js';
import { ask } from '../ask.js';
import * as sync from '../sync.js';

const KEY = 'plv2:ask';
/** Past this the conversation is costly to resend each question; start afresh. */
const MAX_SAVED_CHARS = 300000;

const SUGGESTIONS = [
  'What should I load for 3×2 @ RPE 5 on squat?',
  'What should my deadlift attempts be?',
  'How has my bench moved over the last 8 weeks?',
  'Should I change anything in today\'s session?',
];

const TOOL_LABELS = {
  get_overview: 'your maxes',
  get_today: 'today\'s session',
  get_sessions: 'your log',
  load_for_rpe: 'the RPE calculator',
  rate_set: 'the RPE calculator',
  meet_attempts: 'meet attempts',
  missed_attempts: 'your misses',
  strength_trend: 'your trend',
  rpe_calibration: 'your RPE calls',
  search_library: 'the library',
};

/* ---- state that outlives a redraw ------------------------------------- */

let convo = load();      // { messages: [...api history], turns: [{q, a, tools, unchecked, truncated}] }
let draft = '';
let busy = null;         // null, or the label of what the coach is checking
let lastError = null;    // { q, error } of the question that failed, to retry

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && Array.isArray(v.messages) && Array.isArray(v.turns)) return v;
  } catch (e) { /* private mode or a bad save: start empty */ }
  return { messages: [], turns: [] };
}

function save() {
  try {
    const s = JSON.stringify(convo);
    if (s.length > MAX_SAVED_CHARS) return;
    localStorage.setItem(KEY, s);
  } catch (e) { /* storage full: the conversation just will not survive a reload */ }
}

function reset() {
  convo = { messages: [], turns: [] };
  lastError = null;
  try { localStorage.removeItem(KEY); } catch (e) { /* nothing to clear */ }
}

/* ---- rendering --------------------------------------------------------- */

/** The coach writes plain sentences with the odd **bold** load and "- " list; render just that. */
function fmt(text) {
  const blocks = esc(text).split(/\n{2,}/);
  return blocks.map((b) => {
    const lines = b.split('\n');
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
      return `<ul class="ask__list">${lines.map((l) => `<li>${inline(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    return `<p>${inline(lines.join('<br>'))}</p>`;
  }).join('');
}

function checkedLine(tools) {
  const names = [...new Set((tools || []).map((t) => TOOL_LABELS[t] || t))];
  return names.length ? `Checked ${names.join(', ')}.` : 'Answered without checking your data.';
}

function turnHTML(t) {
  return `<div class="ask__q">${esc(t.q)}</div>
    <div class="ask__a">
      ${fmt(t.a)}
      ${t.truncated ? '<p class="tiny dim">The answer was cut off at its length limit.</p>' : ''}
      ${t.unchecked?.length ? `<div class="banner banner--warn ask__warn">
          Not from the calculator: ${esc(t.unchecked.join(', '))}. Check ${t.unchecked.length === 1 ? 'it' : 'them'} before you load ${t.unchecked.length === 1 ? 'it' : 'them'}.
        </div>` : ''}
      <div class="tiny dim ask__meta">${esc(checkedLine(t.tools))}</div>
    </div>`;
}

function threadHTML() {
  const parts = convo.turns.map(turnHTML);
  if (!convo.turns.length && !busy && !lastError) {
    parts.push(`<div class="stack-sm">
      <p class="muted small">Ask about loads, your log, your maxes or the meet. Every weight comes from the app's own
        calculator and your logged sets; book claims come with a page number.</p>
      ${SUGGESTIONS.map((s) => `<button class="btn btn--ghost btn--block ask__chip" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}
    </div>`);
  }
  if (busy) {
    parts.push(`<div class="ask__q">${esc(busy.q)}</div>
      <div class="ask__a ask__a--busy" aria-live="polite"><span class="ask__dots"></span> ${esc(busy.label)}</div>`);
  }
  if (lastError && !busy) {
    parts.push(`<div class="ask__q">${esc(lastError.q)}</div>
      <div class="banner banner--bad" role="alert">${esc(lastError.error)}
        <div style="margin-top:8px"><button class="btn btn--ghost" data-retry>Try again</button></div></div>`);
  }
  return parts.join('');
}

function configured() {
  const c = sync.config();
  return !!(c.endpoint && c.token);
}

function view(ctx) {
  const back = ctx.params.from === 'session' ? 'session' : null;
  return `
    <div class="row-between" style="margin-bottom:12px">
      ${back ? `<button class="btn btn--bare" data-back aria-label="Back to the session">${icon('back')}</button>` : ''}
      <h1 class="grow" style="margin:0">Ask</h1>
      <button class="btn btn--bare small" data-new ${convo.turns.length ? '' : 'hidden'}>New chat</button>
    </div>
    ${configured() ? '' : `<div class="banner banner--warn" style="margin-bottom:12px">
        The coach goes through your sync script. Set up sync in Settings, then add your Claude API key to the script
        (Settings › Sync explains it). Everything else in the app works without it.
      </div>`}
    <div class="ask__thread stack" data-thread>${threadHTML()}</div>
    <form class="ask__bar" data-form>
      <textarea class="input ask__input" rows="1" placeholder="Ask the coach…" data-input data-focus-key="ask-input"
        enterkeyhint="send" ${busy ? 'disabled' : ''}>${esc(draft)}</textarea>
      <button class="btn btn--primary ask__send" type="submit" aria-label="Send" ${busy ? 'disabled' : ''}>${icon('chevron')}</button>
    </form>`;
}

/** Repaint the thread in place — a full redraw would scroll to the top. */
function paint() {
  const root = $('#view');
  const thread = root && $('[data-thread]', root);
  if (!thread) return;
  thread.innerHTML = threadHTML();
  wireThread(thread);
  const input = $('[data-input]', root);
  const send = $('.ask__send', root);
  if (input) input.disabled = !!busy;
  if (send) send.disabled = !!busy;
  const newBtn = $('[data-new]', root);
  if (newBtn) newBtn.hidden = !convo.turns.length;
  thread.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });
}

function wireThread(thread) {
  for (const b of thread.querySelectorAll('[data-suggest]')) b.onclick = () => submit(b.dataset.suggest);
  const retry = $('[data-retry]', thread);
  if (retry) retry.onclick = () => submit(lastError.q);
}

let ctxRef = null;

async function submit(question) {
  const q = String(question || '').trim();
  if (!q || busy) return;
  if (!configured()) { toast('Set up sync in Settings first.', 'bad'); return; }
  draft = '';
  const input = $('#view [data-input]');
  if (input) input.value = '';
  lastError = null;
  busy = { q, label: 'Thinking…' };
  paint();

  const res = await ask({
    state: ctxRef.state,
    history: convo.messages,
    question: q,
    send: sync.askClaude,
    onStep(names) {
      const what = [...new Set(names.map((n) => TOOL_LABELS[n] || n))].join(', ');
      busy = { q, label: `Checking ${what}…` };
      paint();
    },
  });
  busy = null;
  if (res.ok) {
    convo.messages = res.messages;
    convo.turns.push({ q, a: res.text, tools: res.tools, unchecked: res.unchecked, truncated: res.truncated });
    save();
  } else {
    lastError = { q, error: res.error };
  }
  paint();
}

function mount(root, ctx) {
  ctxRef = ctx;
  wireThread($('[data-thread]', root));
  const input = $('[data-input]', root);
  // One line until there is more to show; textareas otherwise open several rows tall.
  const grow = () => {
    input.style.height = '';
    if (input.value) input.style.height = `${Math.min(input.scrollHeight + 2, 140)}px`;
  };
  input.oninput = () => { draft = input.value; grow(); };
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input.value); }
  };
  grow();
  $('[data-form]', root).onsubmit = (e) => { e.preventDefault(); submit(input.value); };
  const back = $('[data-back]', root);
  if (back) back.onclick = () => ctx.go('session');
  const fresh = $('[data-new]', root);
  if (fresh) fresh.onclick = () => { reset(); paint(); };
  if (convo.turns.length || busy) $('[data-thread]', root).lastElementChild?.scrollIntoView({ block: 'end' });
}

export default { render: view, mount };
