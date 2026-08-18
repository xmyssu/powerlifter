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

   Everything is upsert-by-key, so a resync is always safe: rows get rewritten
   in place rather than duplicated.

   SETUP — see README.md beside this file. In short: paste this into the
   Apps Script editor of a new Sheet, set SYNC_TOKEN and DISCORD_WEBHOOK_URL in
   Project Settings › Script properties, then Deploy › New deployment ›
   Web app, execute as *me*, access *anyone*.
   ========================================================================== */

/** Bump when Code.gs changes, so ping and diagnosePublish can report it. */
var SCRIPT_VERSION = 2;

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
    publishConfigured: !!(prop('GITHUB_TOKEN') && prop('GITHUB_REPO')),
    scriptVersion: SCRIPT_VERSION,
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
    var published = publishPublic_(body.public);

    return {
      sets: counts.sets,
      sessions: counts.sessions,
      readiness: counts.readiness,
      bodyweight: counts.bodyweight,
      maxes: counts.maxes,
      discord: posted,
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
