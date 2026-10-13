# Powerlifter

An RPE-driven powerlifting program tracker, built on Eric Helms' *Muscle &
Strength Pyramid*. It writes the program, prescribes each set's load from how
hard the last one felt, logs the session, and adjusts as you go: stalls,
deloads, a peaking block, meet attempts.

It is a plain-JavaScript progressive web app with no build step and no server
of its own. Everything you log lives on your phone. Optional extras (a cloud
log, backups, Discord posts, a public dashboard, an AI coach) go through a
Google Apps Script that you deploy into your own Google account.

- **App:** <https://xmyssu.github.io/powerlifter/> (add it to your home screen)
- **Public dashboard:** <https://xmyssu.github.io/powerlifter/dash.html>

## What's in it

| Tab | What it does |
|---|---|
| Today | What you're doing today and why: the session, warm-ups, plates |
| Progress | Estimated maxes, volume, history, corrections |
| Ask | An AI coach that answers from your own log, using the app's own calculator for every load |
| Coach | The decisions the book would make: stalls, deloads, plateaus, pain, faults |
| Library | The principles behind the program: the RPE scale, volume, rest, the exercises |
| Settings | Equipment and plates, program, backups, cloud sync |

## Layout

```
app/                 the deployed site (GitHub Pages serves this folder)
  index.html         the app
  dash.html          the public dashboard; reads data/stats.json only
  data/stats.json    the dashboard's data, committed by the sync script
  js/                engine (rpe, program, coach, meet), store, sync, views
  sw.js              service worker; bump VERSION when assets change
server/appsscript/   Code.gs: cloud sync, backups, Discord, publishing, coach relay
tools/               offline helpers
```

## Running it locally

There is nothing to install. Serve `app/` and open it:

```sh
cd app && python3 -m http.server 8000
# http://localhost:8000
```

Tests use plain Node, with no framework and no dependencies:

```sh
cd app
node --test js/engine.test.mjs   # the program engine
node --test js/sync.test.mjs     # what sync puts on the wire, and backup safety
node --test js/ask.test.mjs      # the coach's tools
node --test js/fuzz.test.mjs     # property sweeps over every template and plate set
```

Every push to `main` runs these tests and redeploys Pages
(`.github/workflows/pages.yml`).

## Cloud sync, Discord, dashboard, coach

All optional. They are set up through one Apps Script; see
[`server/appsscript/README.md`](server/appsscript/README.md). The phone holds
the script's URL and a shared token. The Discord webhook, GitHub token and
Anthropic API key live in the script's properties, never in this repo.

When `Code.gs` changes, `SCRIPT_VERSION` (in `Code.gs`) and
`EXPECTED_SCRIPT_VERSION` (in `js/sync.js`) are bumped together. The script then
has to be re-pasted and redeployed by hand, and the app warns until it is.

## Security notes

This repo is public, and anything committed to it is world-readable.

- **No secrets in the repo.** Credentials live on the device or in the script's
  properties. Copyrighted books and their indexes stay out (`.gitignore`).
- **Backups are untrusted input.** Restoring a file brings in training data only.
  It never changes where the phone syncs to, or with what token. Exports and
  cloud snapshots carry neither.
- **Requests only go to Apps Script.** The app refuses to send to any other URL,
  however that URL got into its state.
- **Everything drawn is escaped**, and both pages set a Content-Security-Policy
  with no inline script. The dashboard shares an origin with the app, so it
  also sanitizes `stats.json` before drawing it.
- **The public file is an allowlist.** `publicSnapshot` in `js/sync.js` decides
  what the dashboard shows, and tests pin it down. The script checks the file's
  shape and size before committing it.
- **The sync token** must be at least 24 random characters. It is the key to
  the sheet, the backups and the coach's API budget.

Found something? Open an issue, but leave out exploit details. For anything
sensitive, contact the owner privately.
