# Cloud sync setup

Twenty minutes, once. You end up with a Google Sheet that holds every set you
log, a Drive folder of full backups, and a Discord channel that gets one message
per session.

Nothing here goes into the repo — the repo is public. The sheet, the token and
the webhook all live in your own Google and Discord accounts.

---

## 1. The sheet and the script

1. Go to [sheets.new](https://sheets.new). Name it something like
   **Powerlifter log**. Don't add any tabs — the script creates them.
2. **Extensions › Apps Script**. Delete the `myFunction` stub in `Code.gs`.
3. Paste in the entire contents of [`Code.gs`](./Code.gs). Save (⌘S).

## 2. The token

The token is the only thing stopping a stranger who guesses your web app URL
from writing to your sheet. Make it long and random.

1. In the Apps Script editor: **Project Settings** (gear, left sidebar).
2. Scroll to **Script properties** › **Add script property**.
   - Property: `SYNC_TOKEN`
   - Value: a long random string. Generate one in a terminal:
     ```
     openssl rand -hex 24
     ```
3. **Save script properties**.

Keep that value somewhere you can paste it from — you'll type it into the app
once, and you'll want it again if you ever set up a second device.

## 3. Deploy it

1. **Deploy › New deployment**.
2. Gear icon next to "Select type" › **Web app**.
3. Settings:
   - Description: `powerlifter sync`
   - **Execute as: Me**
   - **Who has access: Anyone** ← this matters. Not "Anyone with Google account".
     The app is not signed in to Google; the token is what does the
     authorising. With any other setting you get a login page instead of data,
     and the app will tell you so.
4. **Deploy**. Google asks you to authorise the script — it wants Sheets, Drive
   and external-request access. It will warn that the app "isn't verified";
   that's just because it's your own unpublished script. **Advanced › Go to
   (unsafe)** › **Allow**.
5. Copy the **Web app URL**. It ends in `/exec`.

## 4. Point the app at it

In Powerlifter: **Settings › Cloud sync › Set up cloud sync**. Paste the URL and
the token, hit **Test the connection**, then **Turn on sync**.

Turning it on for the first time queues your whole existing history, so the
first upload takes a few seconds longer than the ones after it.

## 5. Discord (optional, do it after sync works)

A webhook is not a bot. No application to register, nothing to host, and it
doesn't show up in your member list as an app.

1. In Discord, make a server for yourself if you don't have one: **+** at the
   bottom of the server rail › **Create My Own** › **For me and my friends**.
   Add one channel, e.g. `#training-log`.
2. Webhooks post to a channel, never to a DM — that's why the private server is
   necessary rather than just tidy.
3. Right-click the channel › **Edit Channel** › **Integrations** › **Webhooks**
   › **New Webhook**. Name it whatever you want the messages to be signed as.
   **Copy Webhook URL**.
4. Back in Apps Script: **Project Settings › Script properties › Add**:
   - Property: `DISCORD_WEBHOOK_URL`
   - Value: the URL you copied.
5. Save. No redeploy needed — properties are read live.
6. Optional: right-click the channel › **Notification Settings › All Messages**
   so your phone buzzes when a session lands.

Treat that URL like a password. Anyone holding it can post into your channel.

Two guards keep the channel readable, and they're worth knowing about because
they also explain the silences:

- **Only sessions that finished in the last 24 hours are posted.** Switching sync
  on uploads your entire back catalogue in one go, and restoring onto a new phone
  does it again — neither should replay months of workouts. Older sessions get
  marked `backfill` in the `sessions` tab and are never sent.
- **Each session posts at most once**, guarded by the `discordPostedAt` column.

So the way to test it is to finish a workout. If you want to test it right now
without training, log a session today — even a single set — and it'll post. If
you'd rather see an old one, clear that session's `discordPostedAt` cell and
temporarily raise `FRESH_HOURS` at the top of `Code.gs` (then redeploy).


## 6. The public dashboard (optional)

A page anyone can open — `https://<your-github-user>.github.io/powerlifter/dash.html` —
showing estimated maxes, trends, volume, consistency and PRs. It updates itself
after every sync.

**What is on it, and what is not.** The app builds a curated file
(`publicSnapshot` in `app/js/sync.js`) containing only: lifts, loads, reps, RPE,
dates, estimated maxes, PRs and bodyweight. Deliberately excluded — and asserted
by name in `sync.test.mjs`, so a future change that leaks one fails CI:

- session notes and per-exercise notes (free text)
- readiness check-ins (sleep, stress, soreness, motivation)
- the session difficulty rating
- your surname — only a first name is published

It is an allowlist, so a new field added to the log never becomes public by
accident. Everything is in kilograms; the page has a kg/lb toggle.

**Bear in mind it is genuinely public.** Search engines index it and archive
sites cache it, so removing it later does not reliably un-publish it.

### Setup

1. Make a fine-grained personal access token:
   [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   - Repository access: **Only select repositories** → your `powerlifter` repo
   - Permissions → Repository permissions → **Contents: Read and write**
   - Nothing else. Set an expiry you are happy to renew.
2. In Apps Script: **Project Settings › Script properties**, add both:
   - `GITHUB_TOKEN` — the token you just made
   - `GITHUB_REPO` — `owner/name`, e.g. `xmyssu/powerlifter`
3. Save. No redeploy needed.

Sync once, and the script commits `app/data/stats.json`, which redeploys Pages.
The dashboard is live about 40 seconds later. **Settings › Cloud sync › Test the
connection** confirms whether publishing is configured.

Leave those two properties unset and nothing is published — the dashboard is
opt-in on top of a working sync, and the committed `stats.json` stays an empty
placeholder.

### Notes

- Each sync is one commit and one Pages rebuild. At four workouts a week that is
  nothing; the script also skips the commit entirely when the data has not
  changed, so a re-sync does not churn the repo.
- If the token expires, syncing still works — only publishing stops. The push
  reports the failure rather than failing the workout.
- To stop publishing, delete `GITHUB_TOKEN`. To take the dashboard down, delete
  `app/dash.html` and `app/data/stats.json` from the repo.

---

## What lands where

| Tab | One row per | Good for |
| --- | --- | --- |
| `sets` | logged set | the raw table; pivot and chart from here |
| `sessions` | session | volume, avg RPE, duration, bodyweight over time |
| `readiness` | day | sleep/stress/soreness against performance |
| `bodyweight` | weigh-in | bodyweight trend |
| `maxes` | lift | current working maxes |
| `snapshots` | sync | audit trail of backups, with a link to the folder |

Loads appear twice in `sets` and `sessions`: `load`/`tonnage` in the unit you
actually logged in (`unit` column), and `loadKg`/`tonnageKg` normalised. Chart
the kg columns — those are the ones that stay on a single axis if you ever
switch units or log a lift in pounds.

`e1rmKg` is blank for sets logged without an RPE, deliberately. An estimated max
invented from a default RPE would sit in the same column as the measured ones
and quietly bend every trend line.

Full backups: **Drive › Powerlifter snapshots**. `latest.json` is what
**Restore from the sheet** reads. The dated files are history, newest 60 kept.

## Charting it

Everything below is done in the Sheet, not in the app — change it as often as
you like without touching any code.

- **Est. 1RM over time**: `sets` › Insert › Pivot table. Rows `date`, Columns
  `exercise`, Values `e1rmKg` summarised by MAX. Then Insert › Chart › Line.
- **Weekly volume**: pivot `sessions` with Rows `week`, Values `tonnageKg` (SUM).
- **Are you actually getting close to your RPE targets**: in `sets`, chart
  `rpe` against `targetRPE`.

## When something breaks

| What you see | What it is |
| --- | --- |
| "The endpoint answered with a page, not data" | Deployed with access set to anything other than **Anyone**. Redeploy. |
| "Bad token." | The token in the app doesn't match `SYNC_TOKEN`. Watch for a trailing space. |
| "Could not reach the sheet" | Wrong URL, or no connection. The URL must end in `/exec`, not `/dev`. |
| Rows sync but Discord is silent | `DISCORD_WEBHOOK_URL` isn't set, or that session's `discordPostedAt` already says `backfill` or a timestamp. |
| Sessions stuck in "waiting to upload" | Failures back off up to 30 minutes. **Sync now** forces an immediate retry and shows the real error. |

### After editing `Code.gs`

Changes don't go live until you redeploy: **Deploy › Manage deployments** ›
pencil icon › **Version: New version** › **Deploy**. The URL stays the same, so
you don't need to touch the app.

## Cost and limits

Free. Apps Script's free quota is 20,000 outbound requests and 90 minutes of
runtime per day; four workouts a week uses a rounding error of that.
