/* ==========================================================================
   Powerlifter — cloud log, backup and Discord relay
   --------------------------------------------------------------------------
   One Apps Script web app bound to one Google Sheet. It does three things:

     1. Upserts flat rows into `sets`, `sessions`, `readiness`, `bodyweight`
        and `maxes` — the tables you chart.
     2. Writes the app's full state snapshot to a Drive folder, so a wiped
        phone restores exactly. `latest.json` is the one the app reads back.
     3. Posts one embed per finished session to a Discord webhook, exactly
        once per session, no matter how many times the app resends.

   Everything is upsert-by-key, so a resync is always safe: rows get rewritten
   in place rather than duplicated.

   SETUP — see README.md beside this file. In short: paste this into the
   Apps Script editor of a new Sheet, set SYNC_TOKEN and DISCORD_WEBHOOK_URL in
   Project Settings › Script properties, then Deploy › New deployment ›
   Web app, execute as *me*, access *anyone*.
   ========================================================================== */

var SNAPSHOT_FOLDER = 'Powerlifter snapshots';
var SNAPSHOTS_TO_KEEP = 60;

/* ---- entry points ------------------------------------------------------ */

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    requireToken(body.token);

    switch (body.kind) {
      case 'ping': return ok(ping_());
      case 'pull': return ok(pull_());
      case 'push': return ok(push_(body));
      default: return fail('Unknown request kind: ' + body.kind);
    }
  } catch (err) {
    return fail(err && err.message ? err.message : String(err));
  }
}

/**
 * A GET is only ever a human poking the URL in a browser to check it is live.
 * The real protocol is POST-only, because that is what keeps the request
 * "simple" enough to skip a CORS preflight Apps Script cannot answer.
 */
function doGet() {
  return ContentService
    .createTextOutput('Powerlifter sync endpoint is live. Point the app at this URL.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function ok(payload) {
  payload = payload || {};
  payload.ok = true;
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function fail(message) {
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

function prop(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

function requireToken(given) {
  var want = prop('SYNC_TOKEN');
  if (!want) throw new Error('SYNC_TOKEN is not set in the script properties.');
  if (!given || String(given) !== want) throw new Error('Bad token.');
}

/* ---- ping -------------------------------------------------------------- */

function ping_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    sheetUrl: ss.getUrl(),
    sheetName: ss.getName(),
    discordConfigured: !!prop('DISCORD_WEBHOOK_URL'),
    snapshots: countSnapshots_(),
  };
}

/* ---- push -------------------------------------------------------------- */

/** Column order per tab. Adding a column here is enough — headers self-heal. */
var SCHEMA = {
  sets: {
    key: 'key',
    cols: ['key', 'date', 'sessionId', 'label', 'cycle', 'week', 'day', 'phase',
      'slotKey', 'exerciseId', 'exercise', 'setIndex', 'load', 'unit', 'loadKg',
      'reps', 'rpe', 'e1rmKg', 'targetReps', 'targetRPE', 'plannedLoad', 'loggedAt', 'note'],
  },
  sessions: {
    key: 'key',
    cols: ['key', 'date', 'label', 'templateId', 'cycle', 'week', 'day', 'phase',
      'exercises', 'sets', 'reps', 'tonnage', 'unit', 'tonnageKg', 'avgRPE',
      'sessionRPE', 'minutes', 'readiness', 'bodyweight', 'startedAt', 'endedAt',
      'notes', 'discordPostedAt'],
  },
  readiness: { key: 'date', cols: ['date', 'sleep', 'stress', 'soreness', 'motivation', 'score'] },
  bodyweight: { key: 'date', cols: ['date', 'value', 'unit'] },
  maxes: { key: 'lift', cols: ['lift', 'value', 'unit', 'valueKg', 'date', 'source', 'reps'] },
};

function push_(body) {
  // One writer at a time: two phones flushing at once could otherwise both read
  // "row 41 is free" and one would overwrite the other.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Sheet is busy, try again.');

  try {
    var counts = {
      sets: upsert_('sets', body.sets || []),
      sessions: upsert_('sessions', body.sessions || []),
      readiness: upsert_('readiness', body.readiness || []),
      bodyweight: upsert_('bodyweight', body.bodyweight || []),
      maxes: upsert_('maxes', body.maxes || []),
    };

    var snapshot = body.snapshot ? saveSnapshot_(body.snapshot, body.sessions || []) : null;
    var posted = postToDiscord_(body.discord || []);

    return {
      sets: counts.sets,
      sessions: counts.sessions,
      readiness: counts.readiness,
      bodyweight: counts.bodyweight,
      maxes: counts.maxes,
      discord: posted,
      snapshot: snapshot,
      sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
    };
  } finally {
    lock.releaseLock();
  }
}

function tab_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  var schema = SCHEMA[name];
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(schema.cols);
    sh.setFrozenRows(1);
  }
  // Self-heal headers so a schema change does not need a manual sheet edit.
  var width = Math.max(schema.cols.length, sh.getLastColumn());
  var header = sh.getRange(1, 1, 1, width).getValues()[0];
  var missing = schema.cols.filter(function (c) { return header.indexOf(c) === -1; });
  if (missing.length) {
    var start = header.filter(String).length + 1;
    sh.getRange(1, start, 1, missing.length).setValues([missing]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function headerMap_(sh) {
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var map = {};
  for (var i = 0; i < header.length; i++) if (header[i]) map[header[i]] = i;
  return map;
}

/**
 * Write rows by key: existing keys are updated in place, new ones appended in
 * one block. Idempotent, so the app can resend a session as often as it likes.
 */
function upsert_(name, rows) {
  if (!rows.length) return 0;
  var schema = SCHEMA[name];
  var sh = tab_(name);
  var map = headerMap_(sh);
  var width = sh.getLastColumn();
  var keyCol = map[schema.key];

  var last = sh.getLastRow();
  var index = {};
  if (last > 1) {
    var keys = sh.getRange(2, keyCol + 1, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i][0];
      if (k !== '' && k !== null) index[String(k)] = i + 2;
    }
  }

  var appends = [];
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var line = new Array(width).fill('');
    for (var col in map) {
      if (Object.prototype.hasOwnProperty.call(row, col)) line[map[col]] = cell_(row[col]);
    }
    var at = index[String(row[schema.key])];
    if (at) {
      // `discordPostedAt` is the script's own bookkeeping, not the app's —
      // never let a resend wipe it, or the session gets posted twice.
      if (name === 'sessions' && map.discordPostedAt !== undefined) {
        line[map.discordPostedAt] = sh.getRange(at, map.discordPostedAt + 1).getValue();
      }
      sh.getRange(at, 1, 1, width).setValues([line]);
    } else {
      appends.push(line);
    }
  }
  if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, width).setValues(appends);
  return rows.length;
}

/** null/undefined become blank cells rather than the strings "null"/"undefined". */
function cell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

/* ---- snapshots --------------------------------------------------------- */

function snapshotFolder_() {
  var it = DriveApp.getFoldersByName(SNAPSHOT_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(SNAPSHOT_FOLDER);
}

/**
 * Snapshots go to Drive, not into a cell: a sheet cell caps at 50k characters
 * and a couple of years of training blows straight through that.
 */
function saveSnapshot_(text, sessionRows) {
  var folder = snapshotFolder_();
  var stamp = Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd'T'HH-mm-ss'Z'");

  var latest = folder.getFilesByName('latest.json');
  if (latest.hasNext()) latest.next().setContent(text);
  else folder.createFile('latest.json', text, MimeType.PLAIN_TEXT);

  folder.createFile('powerlifter-' + stamp + '.json', text, MimeType.PLAIN_TEXT);
  pruneSnapshots_(folder);

  logSnapshot_(stamp, text.length, sessionRows.length, folder.getUrl());
  return { savedAt: new Date().toISOString(), bytes: text.length, folderUrl: folder.getUrl() };
}

function logSnapshot_(stamp, bytes, sessions, folderUrl) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('snapshots');
  if (!sh) {
    sh = ss.insertSheet('snapshots');
    sh.appendRow(['savedAt', 'bytes', 'sessionsInPush', 'folder']);
    sh.setFrozenRows(1);
  }
  sh.appendRow([stamp, bytes, sessions, folderUrl]);
}

/** Keep the dated history bounded; `latest.json` is never a candidate. */
function pruneSnapshots_(folder) {
  var files = [];
  var it = folder.getFilesByType(MimeType.PLAIN_TEXT);
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName() !== 'latest.json') files.push(f);
  }
  if (files.length <= SNAPSHOTS_TO_KEEP) return;
  files.sort(function (a, b) { return a.getName() < b.getName() ? -1 : 1; });
  for (var i = 0; i < files.length - SNAPSHOTS_TO_KEEP; i++) files[i].setTrashed(true);
}

function countSnapshots_() {
  var n = 0;
  var it = snapshotFolder_().getFilesByType(MimeType.PLAIN_TEXT);
  while (it.hasNext()) { it.next(); n++; }
  return n;
}

function pull_() {
  var it = snapshotFolder_().getFilesByName('latest.json');
  if (!it.hasNext()) return { snapshot: null };
  var f = it.next();
  var text = f.getBlob().getDataAsString();
  var sessions = null;
  try { sessions = (JSON.parse(text).sessions || []).length; } catch (e) { /* report null */ }
  return { snapshot: text, savedAt: f.getLastUpdated().toISOString(), sessions: sessions };
}

/* ---- Discord ----------------------------------------------------------- */

var ACCENT = 0xE8552D;
var ACCENT_PR = 0xF2B01E;

/** A session older than this is history being backfilled, not news. */
var FRESH_HOURS = 24;
/** Belt and braces against Discord's rate limit if something goes wrong above. */
var MAX_POSTS_PER_PUSH = 4;

/**
 * One embed per session, at most once, and only for sessions that just happened.
 *
 * Two things have to be true here. Switching sync on uploads your entire back
 * catalogue in one push, and restoring onto a new phone does it again — neither
 * should replay months of workouts into the channel. So old sessions are stamped
 * as backfill without being sent, and the `discordPostedAt` stamp then keeps
 * every session to one post forever after.
 */
function postToDiscord_(cards) {
  var url = prop('DISCORD_WEBHOOK_URL');
  if (!url || !cards.length) return 0;

  var sh = tab_('sessions');
  var map = headerMap_(sh);
  if (map.discordPostedAt === undefined || map.key === undefined) return 0;

  var last = sh.getLastRow();
  var rowOf = {};
  if (last > 1) {
    var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
    for (var i = 0; i < vals.length; i++) {
      rowOf[String(vals[i][map.key])] = { row: i + 2, posted: vals[i][map.discordPostedAt] };
    }
  }

  var stamp = function (found, value) {
    if (found) sh.getRange(found.row, map.discordPostedAt + 1).setValue(value);
  };

  var sent = 0;
  for (var c = 0; c < cards.length; c++) {
    var card = cards[c];
    var found = rowOf[String(card.sessionId)];
    if (found && found.posted) continue;

    if (!isFresh_(card) || sent >= MAX_POSTS_PER_PUSH) {
      stamp(found, 'backfill');
      continue;
    }

    try {
      var res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ embeds: [embed_(card)] }),
        muteHttpExceptions: true,
      });
      var code = res.getResponseCode();
      if (code >= 200 && code < 300) {
        sent++;
        stamp(found, new Date().toISOString());
      }
      // A non-2xx leaves the stamp empty on purpose, so the next push retries.
    } catch (err) {
      // A dead webhook must not fail the sync — the rows are already written,
      // and the notification is the disposable half of this request.
    }
  }
  return sent;
}

/** Did this session finish recently enough to be worth a notification? */
function isFresh_(card) {
  var when = card.endedAt || card.date;
  if (!when) return false;
  var t = new Date(when).getTime();
  if (isNaN(t)) return false;
  return (new Date().getTime() - t) < FRESH_HOURS * 3600 * 1000;
}

function embed_(card) {
  var u = card.unit || 'kg';
  var fields = [];

  fields.push({ name: 'Volume', value: fmtNum_(card.tonnage) + ' ' + u, inline: true });
  fields.push({ name: 'Sets', value: String(card.sets) + ' · ' + String(card.reps) + ' reps', inline: true });
  if (card.avgRPE !== null && card.avgRPE !== undefined) {
    fields.push({ name: 'Avg RPE', value: String(round1_(card.avgRPE)), inline: true });
  }
  if (card.minutes) fields.push({ name: 'Time', value: card.minutes + ' min', inline: true });
  if (card.sessionRPE) fields.push({ name: 'Felt like', value: card.sessionRPE + '/5', inline: true });

  if (card.prs && card.prs.length) {
    fields.push({
      name: '🏆 Estimated max up',
      value: card.prs.map(function (p) {
        return '**' + p.exercise + '** +' + round1_(p.gain) + ' ' + (p.unit || u) + ' → ' + round1_(p.e1rm);
      }).join('\n'),
      inline: false,
    });
  }

  var work = (card.lines || []).map(function (l) {
    return '**' + l.exercise + '**\n' + l.detail + (l.note ? '\n_' + l.note + '_' : '');
  }).join('\n');
  if (work) fields.push({ name: 'The work', value: clip_(work, 1024), inline: false });

  return {
    title: card.title || 'Session logged',
    description: card.notes ? clip_(card.notes, 400) : undefined,
    color: card.prs && card.prs.length ? ACCENT_PR : ACCENT,
    timestamp: new Date().toISOString(),
    footer: { text: card.date + ' · loads in ' + u },
    fields: fields,
  };
}

function fmtNum_(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function round1_(n) { return Math.round(n * 10) / 10; }
function clip_(s, max) { return s.length > max ? s.slice(0, max - 1) + '…' : s; }
