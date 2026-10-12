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
     4. Commits the app's curated public projection to GitHub, which is what the
        public dashboard reads. Opt-in: skipped unless GITHUB_TOKEN and
        GITHUB_REPO are set.
     5. Relays the in-app coach to the Claude API (ask_) and searches the
        books in the private "Powerlifter library" Drive folder for it
        (book_). Opt-in: needs ANTHROPIC_API_KEY.

   Everything is upsert-by-key, so a resync is always safe: rows get rewritten
   in place rather than duplicated.

   SETUP — see README.md beside this file. In short: paste this into the
   Apps Script editor of a new Sheet, set SYNC_TOKEN and DISCORD_WEBHOOK_URL in
   Project Settings › Script properties, then Deploy › New deployment ›
   Web app, execute as *me*, access *anyone*.
   ========================================================================== */

/** Bump when Code.gs changes, so ping and diagnosePublish can report it. */
var SCRIPT_VERSION = 6;

/** Columns the script maintains itself; a push must never overwrite them. */
var SCRIPT_OWNED = ['discordPostedAt', 'discordMessageId', 'discordHash'];

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
      case 'ask': return ok(ask_(body));
      case 'book': return ok(book_(body));
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
    publishConfigured: !!(prop('GITHUB_TOKEN') && prop('GITHUB_REPO')),
    coachConfigured: !!prop('ANTHROPIC_API_KEY'),
    library: libraryFiles_().map(function (f) { return f.getName(); }),
    scriptVersion: SCRIPT_VERSION,
    snapshots: countSnapshots_(),
  };
}

/* ---- coach ------------------------------------------------------------- */

/**
 * Relay one coach request to the Claude API.
 *
 * The app sends the conversation, the system prompt and the tool definitions;
 * this adds the key and decides everything that costs money — model, effort,
 * output cap — so a leaked sync token cannot be used to run a bigger model.
 * The tools themselves run on the phone, against its own training log.
 *
 * Script properties:
 *   ANTHROPIC_API_KEY   required
 *   ANTHROPIC_MODEL     optional, default claude-opus-5-5
 *   ASK_EFFORT          optional, low | medium | high (default medium)
 *   ASK_DAILY_LIMIT     optional, model calls per day (default 80). One
 *                       question is usually two to five calls.
 */
var ASK_MODEL = 'claude-opus-5-5';
var ASK_MAX_TOKENS = 8000;

function ask_(body) {
  var key = prop('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in the script properties.');
  var req = body.request || {};
  if (!req.messages || !req.messages.length) throw new Error('No conversation to send.');
  countAsk_();

  var effort = prop('ASK_EFFORT') || 'medium';
  var payload = {
    model: prop('ANTHROPIC_MODEL') || ASK_MODEL,
    max_tokens: ASK_MAX_TOKENS,
    system: String(req.system || ''),
    tools: req.tools || [],
    messages: req.messages,
    output_config: { effort: effort },
    // Caches the system prompt, tools and conversation so far: each round of a
    // tool loop resends all of it.
    cache_control: { type: 'ephemeral' },
    // If a safety classifier declines, retry on the recommended fallback model
    // inside the same call rather than failing the question.
    fallbacks: 'default',
  };

  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  var code = res.getResponseCode();
  var data;
  try { data = JSON.parse(res.getContentText()); } catch (e) { data = null; }
  if (code !== 200 || !data) {
    // The API's own message, never the request: it carries no key.
    var why = data && data.error && data.error.message ? data.error.message : 'HTTP ' + code;
    if (code === 429) why = 'The API is rate-limiting this key. Wait a minute and ask again.';
    if (code === 401) why = 'The API rejected the key. Check ANTHROPIC_API_KEY in the script properties.';
    throw new Error('Coach: ' + why);
  }
  return {
    message: {
      content: data.content,
      stop_reason: data.stop_reason,
      model: data.model,
      usage: data.usage,
    },
  };
}

/** A daily ceiling on model calls, so a stuck loop or a leaked token has a bounded cost. */
function countAsk_() {
  var limit = Number(prop('ASK_DAILY_LIMIT')) || 80;
  var day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Busy, try again.');
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty('ASK_COUNT') || '';
    var parts = raw.split(':');
    var n = parts[0] === day ? Number(parts[1]) || 0 : 0;
    if (n >= limit) throw new Error('The coach has hit today\'s limit of ' + limit + ' calls (ASK_DAILY_LIMIT). It resets at midnight.');
    props.setProperty('ASK_COUNT', day + ':' + (n + 1));
  } finally {
    lock.releaseLock();
  }
}

/* ---- the book library ------------------------------------------------- */

/**
 * The coach's search over whole books.
 *
 * Each book is a passage index made by tools/build_book_index.py and dropped
 * into this Drive folder by hand. It is the book's own text, so it lives here,
 * private, and never in the public repository. Add a source by adding a file;
 * remove one by deleting it.
 */
var LIBRARY_FOLDER = 'Powerlifter library';
var BOOK_STOP = ('a an the and or of to in on for with is are was be it my i me you your do does how what why '
  + 'when should can could would at by as this that from not if than then so about into over').split(' ');

function libraryFiles_() {
  var it = DriveApp.getFoldersByName(LIBRARY_FOLDER);
  if (!it.hasNext()) return [];
  var files = [];
  var fit = it.next().getFiles();
  while (fit.hasNext()) {
    var f = fit.next();
    if (/\.json$/i.test(f.getName()) && !f.isTrashed()) files.push(f);
  }
  return files;
}

function book_(body) {
  var query = String(body.query || '').slice(0, 300);
  if (!query.trim()) throw new Error('No search query.');
  var limit = Math.min(8, Math.max(1, Number(body.limit) || 5));
  var sources = [];
  libraryFiles_().forEach(function (f) {
    try {
      var d = JSON.parse(f.getBlob().getDataAsString());
      if (d && d.passages && d.passages.length) sources.push(d);
    } catch (e) { /* a half-uploaded or foreign file: skip it */ }
  });
  return {
    configured: sources.length > 0,
    sources: sources.map(function (d) { return d.title; }),
    passages: searchPassages_(sources, query, limit),
  };
}

function bookTerms_(text) {
  var words = String(text).toLowerCase().normalize('NFKD').match(/[a-z0-9]+/g) || [];
  var out = [];
  for (var i = 0; i < words.length; i++) {
    if (BOOK_STOP.indexOf(words[i]) !== -1) continue;
    out.push(words[i].replace(/(ing|ed|es|s)$/, '') || words[i]);
  }
  return out;
}

/** BM25 over every passage of every book; the best `limit`, with where each came from. */
function searchPassages_(sources, query, limit) {
  var q = bookTerms_(query).filter(function (t, i, a) { return a.indexOf(t) === i; });
  if (!q.length) return [];
  var docs = [];
  sources.forEach(function (src) {
    src.passages.forEach(function (p) {
      var tf = {};
      var terms = bookTerms_((p.chapter || '') + ' ' + p.text);
      for (var i = 0; i < terms.length; i++) tf[terms[i]] = (tf[terms[i]] || 0) + 1;
      docs.push({ src: src, p: p, tf: tf, len: terms.length });
    });
  });
  if (!docs.length) return [];
  var avg = docs.reduce(function (n, d) { return n + d.len; }, 0) / docs.length;
  var idf = {};
  q.forEach(function (t) {
    var df = docs.filter(function (d) { return d.tf[t]; }).length;
    idf[t] = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
  });
  var k1 = 1.2, b = 0.75;
  var scored = [];
  docs.forEach(function (d) {
    var score = 0;
    q.forEach(function (t) {
      var f = d.tf[t];
      if (f) score += idf[t] * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avg));
    });
    if (score > 0) scored.push({ d: d, score: score });
  });
  scored.sort(function (x, y) { return y.score - x.score; });
  return scored.slice(0, limit).map(function (x) {
    var src = x.d.src;
    return {
      source: src.title,
      authors: src.authors || null,
      edition: src.edition || null,
      page: x.d.p.page,
      chapter: x.d.p.chapter || null,
      text: x.d.p.text,
    };
  });
}

/* ---- push -------------------------------------------------------------- */

/** Column order per tab. Adding a column here is enough — headers self-heal. */
var SCHEMA = {
  sets: {
    key: 'key',
    cols: ['key', 'date', 'sessionId', 'label', 'cycle', 'week', 'day', 'phase',
      'slotKey', 'exerciseId', 'exercise', 'setIndex', 'load', 'unit', 'loadKg',
      'reps', 'rpe', 'failed', 'e1rmKg', 'targetReps', 'targetRPE', 'plannedLoad', 'loggedAt', 'note'],
  },
  sessions: {
    key: 'key',
    cols: ['key', 'date', 'label', 'templateId', 'cycle', 'week', 'day', 'phase',
      'exercises', 'sets', 'reps', 'tonnage', 'unit', 'tonnageKg', 'avgRPE',
      'sessionRPE', 'minutes', 'readiness', 'bodyweight', 'startedAt', 'endedAt',
      'notes', 'discordPostedAt', 'discordMessageId', 'discordHash'],
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
    var published = publishPublic_(body.public);
    var weekly = postWeekly_(body.weekly);

    return {
      sets: counts.sets,
      sessions: counts.sessions,
      readiness: counts.readiness,
      bodyweight: counts.bodyweight,
      maxes: counts.maxes,
      discord: posted,
      weekly: weekly,
      snapshot: snapshot,
      published: published,
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
 *
 * The sheet is read once and written once. A full re-sync rewrites every row,
 * and one Sheets call per row took longer than the app waits for an answer.
 */
function upsert_(name, rows) {
  if (!rows.length) return 0;
  var schema = SCHEMA[name];
  var sh = tab_(name);
  var map = headerMap_(sh);
  var width = sh.getLastColumn();
  var keyCol = map[schema.key];

  var last = sh.getLastRow();
  var range = last > 1 ? sh.getRange(2, 1, last - 1, width) : null;
  var data = range ? range.getValues() : [];
  var index = {};
  for (var i = 0; i < data.length; i++) {
    var k = data[i][keyCol];
    if (k !== '' && k !== null) index[String(k)] = i;
  }

  var appends = [];
  var touched = {};
  var first = -1, lastTouched = -1;
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var line = new Array(width).fill('');
    for (var col in map) {
      if (Object.prototype.hasOwnProperty.call(row, col)) line[map[col]] = cell_(row[col]);
    }
    var at = index[String(row[schema.key])];
    if (at !== undefined && at >= data.length) {
      appends[at - data.length] = line;     // the same key twice in one push: the later wins
    } else if (at !== undefined) {
      // These columns are the script's own bookkeeping, not the app's — never
      // let a resend wipe them, or a session gets posted to Discord twice and
      // loses the message id that makes a later correction editable.
      if (name === 'sessions') {
        for (var o = 0; o < SCRIPT_OWNED.length; o++) {
          var oc = map[SCRIPT_OWNED[o]];
          if (oc !== undefined) line[oc] = data[at][oc];
        }
      }
      data[at] = line;
      touched[at] = true;
      if (first === -1 || at < first) first = at;
      if (at > lastTouched) lastTouched = at;
    } else {
      index[String(row[schema.key])] = data.length + appends.length;
      appends.push(line);
    }
  }

  if (first !== -1) {
    // Rows between the first and last update that were not resent are written
    // back as they were; keep any formula in them a formula.
    var span = sh.getRange(first + 2, 1, lastTouched - first + 1, width);
    var formulas = span.getFormulas();
    var out = data.slice(first, lastTouched + 1).map(function (line, j) {
      if (touched[first + j]) return line;
      return line.map(function (v, c) { return formulas[j][c] || v; });
    });
    span.setValues(out);
  }
  if (appends.length) sh.getRange(last + 1, 1, appends.length, width).setValues(appends);
  return rows.length;
}

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

/* ---- publishing the public dashboard file ------------------------------- */

/**
 * Commit the curated public projection into the GitHub repo, which redeploys
 * Pages and updates the public dashboard.
 *
 * The app builds the projection (js/sync.js `publicSnapshot`) so that what is
 * public is decided by an allowlist with tests around it, not by whatever this
 * script happens to read off the sheet. This function is a dumb pipe: it does
 * not inspect or add to the payload, it just commits the bytes it was handed.
 *
 * Needs two script properties. Skips silently if either is missing, so the
 * dashboard is opt-in on top of a working sync rather than a prerequisite:
 *   GITHUB_TOKEN — a fine-grained PAT with Contents: read+write on this one repo
 *   GITHUB_REPO  — "owner/name", e.g. "xmyssu/powerlifter"
 */
var PUBLIC_PATH = 'app/data/stats.json';

function publishPublic_(publicData) {
  var token = prop('GITHUB_TOKEN');
  var repo = prop('GITHUB_REPO');
  if (!token || !repo || !publicData) return null;

  var api = 'https://api.github.com/repos/' + repo + '/contents/' + PUBLIC_PATH;
  var headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  var body = JSON.stringify(publicData, null, 1);

  // The API needs the blob's current sha to replace it, and omitting the sha on
  // an existing path is a 422 rather than an overwrite.
  var sha = null;
  try {
    var head = UrlFetchApp.fetch(api + '?ref=main', {
      method: 'get', headers: headers, muteHttpExceptions: true,
    });
    if (head.getResponseCode() === 200) {
      var existing = JSON.parse(head.getContentText());
      sha = existing.sha;
      // Nothing changed since the last push, so skip the commit entirely and
      // save the repo a no-op Pages rebuild.
      if (existing.content && sameContent_(existing.content, body)) {
        return { skipped: 'unchanged' };
      }
    }
  } catch (err) {
    // No sha means we attempt a create; a real conflict surfaces below.
  }

  var payload = {
    message: 'Update public stats',
    content: Utilities.base64Encode(body, Utilities.Charset.UTF_8),
    branch: 'main',
  };
  if (sha) payload.sha = sha;

  var res = UrlFetchApp.fetch(api, {
    method: 'put',
    headers: headers,
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code >= 200 && code < 300) {
    return { committed: true, bytes: body.length };
  }
  // Reported, never thrown: the sheet write already succeeded, and a broken
  // token must not make the phone think its workout failed to sync.
  return { error: 'GitHub returned ' + code, detail: res.getContentText().slice(0, 200) };
}

/** Compare the API's base64 blob against what we are about to write. */
function sameContent_(base64FromApi, text) {
  try {
    var current = Utilities.newBlob(Utilities.base64Decode(base64FromApi.replace(/\n/g, ''))).getDataAsString();
    // The generated timestamp changes every push, so comparing raw text would
    // never match. Ignore it and compare the data that actually matters.
    return strip_(current) === strip_(text);
  } catch (err) {
    return false;
  }
}

function strip_(text) {
  return text.replace(/"generatedAt"\s*:\s*"[^"]*",?/, '');
}

/* ---- Discord ----------------------------------------------------------- */

var ACCENT     = 0xE8552D;   // ordinary session
var ACCENT_PR  = 0xF2B01E;   // an estimated max went up
var ACCENT_DL  = 0x4DA3FF;   // deload week — light on purpose
var ACCENT_ST  = 0xFFC53D;   // something fell short of what was prescribed

/** A session older than this is history being backfilled, not news. */
var FRESH_HOURS = 24;
/** Belt and braces against Discord's rate limit if something goes wrong above. */
var MAX_POSTS_PER_PUSH = 4;
var MAX_EDITS_PER_PUSH = 4;

/** The webhook URL with any query string stripped, ready to build endpoints on. */
function webhookBase_() {
  var url = prop('DISCORD_WEBHOOK_URL');
  if (!url) return '';
  return url.split('?')[0].replace(/\/+$/, '');
}

function hash_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

/** The app's own icon, derived from the dashboard URL rather than configured. */
function avatarFor_(url) {
  if (!url) return null;
  return url.replace(/dash\.html.*$/, 'icons/icon-192.png');
}

function webhookPayload_(embed, url) {
  var body = { username: 'Powerlifter', embeds: [embed] };
  var avatar = avatarFor_(url);
  if (avatar) body.avatar_url = avatar;
  return body;
}

/**
 * One embed per session, at most once, and only for sessions that just happened.
 *
 * Three things have to hold. Switching sync on uploads the entire back
 * catalogue, and restoring onto a new phone does it again — neither should
 * replay months of workouts. Each session gets one message, forever. And when a
 * mis-typed entry is corrected, the message already in the channel has to be
 * rewritten rather than left standing as the wrong record.
 */
function postToDiscord_(cards) {
  var base = webhookBase_();
  if (!base || !cards.length) return 0;

  var sh = tab_('sessions');
  var map = headerMap_(sh);
  if (map.discordPostedAt === undefined || map.key === undefined) return 0;

  var last = sh.getLastRow();
  var rowOf = {};
  if (last > 1) {
    var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
    for (var i = 0; i < vals.length; i++) {
      rowOf[String(vals[i][map.key])] = {
        row: i + 2,
        posted: vals[i][map.discordPostedAt],
        msgId: map.discordMessageId === undefined ? '' : vals[i][map.discordMessageId],
        hash: map.discordHash === undefined ? '' : vals[i][map.discordHash],
      };
    }
  }

  var setCell = function (found, col, value) {
    if (found && map[col] !== undefined) sh.getRange(found.row, map[col] + 1).setValue(value);
  };

  var sent = 0, edited = 0;
  for (var c = 0; c < cards.length; c++) {
    var card = cards[c];
    var found = rowOf[String(card.sessionId)];
    var embed = embed_(card);
    var digest = hash_(JSON.stringify(embed));

    // Already in the channel: rewrite it only if what it should say has changed.
    if (found && found.posted) {
      if (found.posted === 'backfill' || !found.msgId) continue;
      if (String(found.hash) === digest || edited >= MAX_EDITS_PER_PUSH) continue;
      try {
        var patch = UrlFetchApp.fetch(base + '/messages/' + found.msgId, {
          method: 'patch',
          contentType: 'application/json',
          payload: JSON.stringify({ embeds: [embed] }),
          muteHttpExceptions: true,
        });
        if (patch.getResponseCode() < 300) {
          edited++;
          setCell(found, 'discordHash', digest);
        }
      } catch (err) { /* the rows are already right; the message is cosmetic */ }
      continue;
    }

    if (!isFresh_(card) || sent >= MAX_POSTS_PER_PUSH) {
      setCell(found, 'discordPostedAt', 'backfill');
      continue;
    }

    try {
      // wait=true makes Discord return the created message, which is the only
      // way to get an id we can edit later.
      var res = UrlFetchApp.fetch(base + '?wait=true', {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(webhookPayload_(embed, card.url)),
        muteHttpExceptions: true,
      });
      var code = res.getResponseCode();
      if (code >= 200 && code < 300) {
        sent++;
        setCell(found, 'discordPostedAt', new Date().toISOString());
        setCell(found, 'discordHash', digest);
        try {
          var body = JSON.parse(res.getContentText());
          if (body && body.id) setCell(found, 'discordMessageId', String(body.id));
        } catch (e) { /* posted fine; just cannot edit it later */ }
      }
      // A non-2xx leaves the stamp empty on purpose, so the next push retries.
    } catch (err) {
      // A dead webhook must not fail the sync — the rows are already written,
      // and the notification is the disposable half of this request.
    }
  }
  return sent + edited;
}

/** Did this session finish recently enough to be worth a notification? */
function isFresh_(card) {
  var when = card.endedAt || card.date;
  if (!when) return false;
  var t = new Date(when).getTime();
  if (isNaN(t)) return false;
  return (new Date().getTime() - t) < FRESH_HOURS * 3600 * 1000;
}

/**
 * The weekly summary, posted at most once per week.
 *
 * The app works out which week has just closed and what happened in it; this
 * only decides whether that week has already been reported, keyed on the week's
 * Monday. So it survives a re-sync, a restore, and syncing twice in a day.
 */
function postWeekly_(weekly) {
  var base = webhookBase_();
  if (!base || !weekly || !weekly.weekKey) return false;

  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('LAST_WEEKLY_POSTED') === weekly.weekKey) return false;

  try {
    var res = UrlFetchApp.fetch(base, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(webhookPayload_(weeklyEmbed_(weekly), weekly.url)),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() < 300) {
      // Only recorded on success, so a failed week is retried next sync.
      props.setProperty('LAST_WEEKLY_POSTED', weekly.weekKey);
      return true;
    }
  } catch (err) { /* cosmetic */ }
  return false;
}

/* ---- embeds ------------------------------------------------------------ */

// A zero-width space: Discord requires a non-empty name/value, and this is the
// conventional way to spend a grid cell on nothing.
var BLANK = '\u200b';

/** Discord lays inline fields out three to a row; pad so none is left stranded. */
function packInline_(fields) {
  var out = fields.slice();
  while (out.length % 3 !== 0) out.push({ name: BLANK, value: BLANK, inline: true });
  return out;
}

function embed_(card) {
  var u = card.unit || 'kg';
  var inline = [];

  inline.push({ name: 'Volume', value: fmtNum_(card.tonnage) + ' ' + u, inline: true });
  inline.push({ name: 'Sets', value: String(card.sets) + ' · ' + String(card.reps) + ' reps', inline: true });
  if (card.minutes) inline.push({ name: 'Time', value: card.minutes + ' min', inline: true });
  if (card.avgRPE !== null && card.avgRPE !== undefined) {
    inline.push({ name: 'Avg RPE', value: oneDp_(card.avgRPE), inline: true });
  }
  if (card.avgTargetRPE !== null && card.avgTargetRPE !== undefined) {
    inline.push({ name: 'Prescribed', value: oneDp_(card.avgTargetRPE), inline: true });
  }
  if (card.sessionRPE) inline.push({ name: 'Felt like', value: card.sessionRPE + '/5', inline: true });

  var fields = packInline_(inline);

  if (card.sparks && card.sparks.length) {
    fields.push({
      name: 'Estimated max',
      value: card.sparks.map(function (s) {
        var delta = s.change > 0 ? ' (+' + oneDp_(s.change) + ')' : s.change < 0 ? ' (' + oneDp_(s.change) + ')' : '';
        return (s.mark ? s.mark + ' ' : '') + '**' + s.label + '**  `' + s.spark + '`  '
          + oneDp_(s.current) + ' kg' + delta;
      }).join('\n'),
      inline: false,
    });
  }

  if (card.prs && card.prs.length) {
    fields.push({
      name: '🏆 New best',
      value: card.prs.map(function (p) {
        return '**' + p.exercise + '** +' + oneDp_(p.gain) + ' ' + (p.unit || u) + ' → ' + oneDp_(p.e1rm);
      }).join('\n'),
      inline: false,
    });
  }

  if (card.stalled && card.stalled.length) {
    fields.push({
      name: '⚠️ Short of the prescription',
      // Says only what is true. Whether this becomes a recorded stall and forces
      // a deload depends on the cycle's history, which this message cannot see,
      // so it must not promise that the program will act.
      value: card.stalled.join(', '),
      inline: false,
    });
  }

  var work = (card.lines || []).map(function (l) {
    return (l.mark ? l.mark + ' ' : '') + '**' + l.exercise + '**\n' + l.detail + (l.note ? '\n_' + l.note + '_' : '');
  }).join('\n');
  if (work) fields.push({ name: 'The work', value: clip_(work, 1024), inline: false });

  var footer = card.date + ' · loads in ' + u;
  if (card.correctedAt) footer += ' · corrected';

  return {
    title: (card.deload ? 'Deload · ' : '') + (card.title || 'Session logged'),
    url: card.url || undefined,
    description: card.notes ? clip_(card.notes, 400) : undefined,
    color: card.prs && card.prs.length ? ACCENT_PR
      : card.stalled && card.stalled.length ? ACCENT_ST
      : card.deload ? ACCENT_DL
      : ACCENT,
    timestamp: card.endedAt || new Date().toISOString(),
    footer: { text: footer },
    fields: fields,
  };
}

function weeklyEmbed_(w) {
  var inline = [];
  inline.push({
    name: 'Sessions',
    value: String(w.sessions) + (w.planned ? ' of ' + w.planned : ''),
    inline: true,
  });

  var vol = fmtNum_(w.tonnage) + ' kg';
  if (w.prevTonnage) {
    var d = w.tonnage - w.prevTonnage;
    var pct = Math.round((d / w.prevTonnage) * 100);
    vol += '\n' + (d >= 0 ? '+' : '−') + fmtNum_(Math.abs(d)) + ' (' + (d >= 0 ? '+' : '−') + Math.abs(pct) + '%)';
  }
  inline.push({ name: 'Volume', value: vol, inline: true });
  inline.push({ name: 'Sets', value: String(w.sets) + ' · ' + String(w.reps) + ' reps', inline: true });

  if (w.avgRPE !== null && w.avgRPE !== undefined) {
    var rpe = oneDp_(w.avgRPE);
    if (w.avgTargetRPE !== null && w.avgTargetRPE !== undefined) {
      var gap = w.avgRPE - w.avgTargetRPE;
      rpe += '\nvs ' + oneDp_(w.avgTargetRPE) + ' planned';
      inline.push({ name: 'Avg RPE', value: rpe, inline: true });
      inline.push({
        name: 'Calibration',
        value: Math.abs(gap) < 0.25 ? 'on target'
          : gap > 0 ? oneDp_(gap) + ' harder than planned'
          : oneDp_(Math.abs(gap)) + ' easier than planned',
        inline: true,
      });
    } else {
      inline.push({ name: 'Avg RPE', value: rpe, inline: true });
    }
  }

  var fields = packInline_(inline);

  if (w.volumeSpark) {
    fields.push({
      name: 'Volume, last ' + (w.volumeWeeks || 6) + ' weeks',
      value: '`' + w.volumeSpark + '`',
      inline: false,
    });
  }

  if (w.maxes && w.maxes.length) {
    fields.push({
      name: 'Where the lifts stand',
      value: w.maxes.map(function (m) {
        var ch = m.change === null || m.change === undefined ? ''
          : m.change > 0 ? '  (+' + oneDp_(m.change) + ')'
          : m.change < 0 ? '  (' + oneDp_(m.change) + ')'
          : '  (level)';
        return m.mark + ' **' + m.label + '** ' + oneDp_(m.value) + ' kg' + ch;
      }).join('\n'),
      inline: false,
    });
  }

  return {
    title: 'Week of ' + w.weekKey + (w.deloadWeek ? ' · deload' : ''),
    url: w.url || undefined,
    color: w.deloadWeek ? ACCENT_DL : ACCENT,
    timestamp: new Date(w.weekEnd + 'T12:00:00Z').toISOString(),
    footer: { text: w.label + ' · estimated maxes in kg' },
    fields: fields,
  };
}

function fmtNum_(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function oneDp_(n) { return (Math.round(n * 10) / 10).toFixed(1); }
function round1_(n) { return Math.round(n * 10) / 10; }
function clip_(s, max) { return s.length > max ? s.slice(0, max - 1) + '…' : s; }

/* ---- diagnostics ------------------------------------------------------- */

/**
 * Run this from the Apps Script editor (pick `diagnosePublish` in the function
 * dropdown, press Run, read the Execution log) to check the dashboard wiring
 * without doing a workout.
 *
 * It answers the three questions separately, because "no data on the page" has
 * three different causes and they need different fixes: is this script the
 * current version, is the GitHub token valid, and has the app sent anything yet.
 */
function diagnosePublish() {
  var token = prop('GITHUB_TOKEN');
  var repo = prop('GITHUB_REPO');
  var lines = [];

  lines.push('This script version: ' + SCRIPT_VERSION + ' (publishing code present)');
  lines.push('SYNC_TOKEN set: ' + (prop('SYNC_TOKEN') ? 'yes' : 'NO — sync itself will not work'));
  lines.push('DISCORD_WEBHOOK_URL set: ' + (prop('DISCORD_WEBHOOK_URL') ? 'yes' : 'no (optional)'));
  lines.push('GITHUB_REPO: ' + (repo || 'NOT SET'));
  lines.push('GITHUB_TOKEN: ' + (token ? 'set, ' + token.length + ' chars, starts "' + token.slice(0, 4) + '"' : 'NOT SET'));

  if (!token || !repo) {
    lines.push('');
    lines.push('=> Set both properties, then run this again.');
    Logger.log(lines.join('\n'));
    return lines.join('\n');
  }

  if (repo.indexOf('/') === -1) {
    lines.push('=> GITHUB_REPO must be "owner/name", e.g. xmyssu/powerlifter');
  }

  var api = 'https://api.github.com/repos/' + repo + '/contents/' + PUBLIC_PATH + '?ref=main';
  var res = UrlFetchApp.fetch(api, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  lines.push('');
  lines.push('GitHub API GET ' + PUBLIC_PATH + ' -> HTTP ' + code);

  var scopes = res.getHeaders()['x-oauth-scopes'] || res.getHeaders()['X-OAuth-Scopes'];
  if (scopes !== undefined) lines.push('token scopes: ' + (scopes || '(none — fine-grained token)'));

  if (code === 200) {
    var info = JSON.parse(res.getContentText());
    lines.push('found the file, ' + info.size + ' bytes, sha ' + String(info.sha).slice(0, 8));
    lines.push('');
    lines.push('=> Read access works. Testing write access with a real commit...');

    var current = Utilities.newBlob(Utilities.base64Decode(String(info.content).replace(/\n/g, ''))).getDataAsString();
    var probe = UrlFetchApp.fetch('https://api.github.com/repos/' + repo + '/contents/' + PUBLIC_PATH, {
      method: 'put',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      contentType: 'application/json',
      // Rewrites the file with exactly what is already there, so a successful
      // probe changes nothing except proving the token can commit.
      payload: JSON.stringify({
        message: 'Verify dashboard publishing',
        content: Utilities.base64Encode(current, Utilities.Charset.UTF_8),
        sha: info.sha,
        branch: 'main',
      }),
      muteHttpExceptions: true,
    });
    var pcode = probe.getResponseCode();
    lines.push('GitHub API PUT -> HTTP ' + pcode);
    if (pcode >= 200 && pcode < 300) {
      lines.push('=> WRITE ACCESS WORKS. Publishing is correctly configured.');
      lines.push('   The dashboard fills in the next time the app syncs a session.');
    } else if (pcode === 403 || pcode === 404) {
      lines.push('=> The token can read but not write. Give it Contents: Read and WRITE');
      lines.push('   (fine-grained), or the public_repo scope (classic).');
      lines.push('   ' + probe.getContentText().slice(0, 200));
    } else {
      lines.push('=> ' + probe.getContentText().slice(0, 300));
    }
  } else if (code === 404) {
    lines.push('=> Either the repo name is wrong, the token cannot see this repo,');
    lines.push('   or app/data/stats.json is missing from the default branch.');
  } else if (code === 401) {
    lines.push('=> The token is rejected. It may be expired, revoked, or mistyped');
    lines.push('   (watch for a trailing space or a truncated paste).');
  } else {
    lines.push('=> ' + res.getContentText().slice(0, 300));
  }

  Logger.log(lines.join('\n'));
  return lines.join('\n');
}
