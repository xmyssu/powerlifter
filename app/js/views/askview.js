/* ==========================================================================
   views/askview.js — ask the coach a question, between sets
   --------------------------------------------------------------------------
   One running conversation, kept on this device. The coach's answer shows
   which of the app's tools it checked, and flags any weight it stated that no
   tool gave it — see `uncheckedLoads` in ask.js.

   Notes are the coach's memory: short standing instructions he writes, or the
   coach saves when he asks it to, read in front of every question. They live
   in the app state, so they sync and back up with everything else.

   Everything else in the app works without this screen: the calculator, the
   log and the program are all local. This is the one place that needs signal.
   ========================================================================== */

import { esc, icon, $, toast } from '../ui.js';
import { ask, MAX_NOTES, MAX_NOTE_CHARS } from '../ask.js';
import { todayISO, uid } from '../store.js';
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
  search_book: 'the book',
  remember: null,          // not a check; the answer shows a "Saved to your notes" line instead
};

/* ---- state that outlives a redraw ------------------------------------- */

let convo = load();      // { messages: [...api history], turns: [{q, a, tools, unchecked, truncated}] }
let draft = '';
let busy = null;         // null, or the label of what the coach is checking
let lastError = null;    // { q, error } of the question that failed, to retry
let showNotes = false;

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
  const names = [...new Set((tools || []).filter((t) => TOOL_LABELS[t] !== null).map((t) => TOOL_LABELS[t] || t))];
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
      ${t.saved?.length ? `<div class="banner ask__warn">Saved to your notes: ${esc(t.saved.join(' · '))}</div>` : ''}
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

function notesHTML(state) {
  const notes = state.coachNotes || [];
  return `<div class="card card--pad-sm stack-sm ask__notes" data-notes>
    <p class="tiny dim">The coach reads these before every answer. Write your own, or ask it to remember something.</p>
    ${notes.length ? notes.map((n) => `<div class="row-between ask__note">
        <span class="small grow">${esc(n.text)} <span class="tiny dim">· ${n.by === 'coach' ? 'saved by the coach' : 'you'}, ${esc(n.date || '')}</span></span>
        <button class="btn btn--bare" data-del-note="${esc(n.id)}" aria-label="Delete this note">${icon('x')}</button>
      </div>`).join('') : '<p class="small muted">No notes yet.</p>'}
    ${notes.length < MAX_NOTES ? `<form class="row-between" data-note-form>
        <input class="input grow" maxlength="${MAX_NOTE_CHARS}" placeholder="e.g. Keep accessories to 2 sets in the peak" data-note-input aria-label="New note">
        <button class="btn btn--ghost" type="submit">Add</button>
      </form>` : `<p class="tiny dim">That is the limit of ${MAX_NOTES}; delete one to add another.</p>`}
  </div>`;
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
      <button class="btn btn--bare small" data-toggle-notes aria-expanded="${showNotes}">Notes${(ctx.state.coachNotes || []).length ? ` (${ctx.state.coachNotes.length})` : ''}</button>
      <button class="btn btn--bare small" data-new ${convo.turns.length ? '' : 'hidden'}>New chat</button>
    </div>
    <div data-notes-slot>${showNotes ? notesHTML(ctx.state) : ''}</div>
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
    searchBook: sync.searchBook,
    remember: (note) => addNote(note),
    onStep(names) {
      const what = [...new Set(names.filter((n) => TOOL_LABELS[n] !== null).map((n) => TOOL_LABELS[n] || n))].join(', ');
      busy = { q, label: what ? `Checking ${what}…` : 'Saving a note…' };
      paint();
    },
  });
  busy = null;
  if (res.ok) {
    convo.messages = res.messages;
    convo.turns.push({ q, a: res.text, tools: res.tools, saved: res.saved, unchecked: res.unchecked, truncated: res.truncated });
    save();
  } else {
    lastError = { q, error: res.error };
  }
  paint();
  if (res.saved?.length) paintNotes();
}

/* ---- notes ------------------------------------------------------------- */

// Silent: a full redraw mid-answer would throw away the scroll position.
// The next sync still carries them, since sync reads the whole state.
function addNote({ text, by = 'you', date = todayISO() }) {
  ctxRef.store.update((s) => {
    s.coachNotes = [...(s.coachNotes || []), { id: uid('note'), text, date, by }];
  }, { silent: true });
}

function deleteNote(id) {
  ctxRef.store.update((s) => { s.coachNotes = (s.coachNotes || []).filter((n) => n.id !== id); }, { silent: true });
}

function paintNotes() {
  const root = $('#view');
  const slot = root && $('[data-notes-slot]', root);
  if (!slot) return;
  slot.innerHTML = showNotes ? notesHTML(ctxRef.state) : '';
  const n = (ctxRef.state.coachNotes || []).length;
  const btn = $('[data-toggle-notes]', root);
  if (btn) { btn.textContent = `Notes${n ? ` (${n})` : ''}`; btn.setAttribute('aria-expanded', String(showNotes)); }
  wireNotes(slot);
}

function wireNotes(slot) {
  for (const b of slot.querySelectorAll('[data-del-note]')) b.onclick = () => { deleteNote(b.dataset.delNote); paintNotes(); };
  const form = $('[data-note-form]', slot);
  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const text = $('[data-note-input]', form).value.replace(/\s+/g, ' ').trim();
      if (text.length < 3) return;
      addNote({ text });
      paintNotes();
      $('[data-note-input]', slot)?.focus();
    };
  }
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
  $('[data-toggle-notes]', root).onclick = () => { showNotes = !showNotes; paintNotes(); };
  wireNotes($('[data-notes-slot]', root));
  if (convo.turns.length || busy) $('[data-thread]', root).lastElementChild?.scrollIntoView({ block: 'end' });
}

export default { render: view, mount };
