# Contributing / how this is built

This is the technical companion to [README.md](README.md) — the "why," not
the "how do I use it." Read this if you want to modify the code, understand
a design decision, or build against the home API.

---

## Platform support

| Platform | Collection method | Official? |
|---|---|---|
| Google Classroom | Reads the rendered page directly (`05-playwright-draft.js`) | Not an API at all — Classroom doesn't offer one to students. This is the one genuinely fragile source: it can break if Google changes the page. |
| Canvas | Canvas's own REST API (`10-canvas.js`) — the same one documented at `canvas.instructure.com/doc/api/` | Official API, but not accessed the official way: no OAuth app registration or access token, the request just rides the already-open browser page's existing session cookies (see `10-canvas.js`'s own comment). Works fine headless. |
| Edpuzzle | Edpuzzle's internal REST endpoints (`11-edpuzzle.js`) | Unofficial — no public docs, no token; the endpoints were found by watching the site's own network traffic, and the shape of what they return was confirmed against real responses, not a spec. Actively detects and refuses headless browsers ("Error 18"), so any collection pass that includes it needs a real, visible (if off-screen) browser window — see that file's own top comment for why, and `05-playwright-draft.js` for how `withEdpuzzle` decides when that's worth it. |

**Materials** (`type: 'Material'` — something to read, not turn in, no due
date, shown once) come from both Classroom and Canvas: Classroom scrapes
them off the same stream Assignments come from, Canvas fetches them
separately via its own Pages endpoint (`/api/v1/courses/:id/pages`), also
official and also cookie-riding, same as Canvas Assignments. Both feed the
exact same shared item shape, so nothing downstream (bucketing, the "New
materials" section, the API) needs to know which platform a material came
from. Canvas Files aren't collected — too broad and noisy (every upload,
including things like the syllabus PDF) to map cleanly onto "new material
worth mentioning" the way a Page is.

All three run through one shared Playwright browser instance per pass —
not three separate ones — so Edpuzzle's headless restriction ends up
governing the whole pass: the moment it's included, the entire browser
goes visible, whether or not Classroom or Canvas individually need
that. Positioned off-screen (`--window-position=-3000,-3000`) so it
doesn't actually get in the way; confirmed compatible with both
Edpuzzle and Classroom.

---

## Building from source

```bash
npm install
npm run setup-browser
cp settings.example.json settings.json    # then edit it
npm run login
npm run build
npm start
```

Each of those is covered for an end user in the README's [Get it](README.md#get-it)
section — this is the same steps, without the explanation. A few things
specifically worth knowing as a contributor:

**Why a real browser, not Playwright's bundled one.** Google's login flow
blocks plain automated Chromium as "not secure," so `setup-browser` either
uses an already-installed Google Chrome or downloads an isolated copy of
Brave into `.browser/` — never your everyday browser profile.
`--user-data-dir` keeps the automated session separate from your normal
one, and that isolation is confirmed correct for Chrome and Brave
specifically. It *isn't* safe with every Chromium fork: Arc was confirmed
to ignore its assigned profile folder entirely and write into the real
one instead, corrupting real saved logins on the next normal launch. That
failure is exactly what this setup avoids by sticking to browsers
confirmed to respect the flag.

**Filenames and code comments were originally Russian**, translated to
English so contributors who don't read Russian can follow the code. The
bilingual `ru`/`en` interface on the summary page itself is unrelated and
still works the same — only the *source* changed language. A few `.txt`
state files (`не-срочно.txt`, `скрытые.txt`, `уведомление.txt`) are still
named in Russian: internal state nobody but this code ever reads, so
there was no real reason to touch them.

### The stable code-signing certificate

By default `npm run build` signs ad-hoc, and macOS treats every rebuild
as a brand-new app — any Automation/Files permission grant stops applying
the moment you rebuild again. To make a grant stick across rebuilds:

1. Open **Keychain Access** (Spotlight → "Keychain Access")
2. **Keychain Access → Certificate Assistant → Create a Certificate…**
3. Name it exactly `SHREK School Software Local`, **Identity Type** →
   *Self Signed Root*, **Certificate Type** → *Code Signing*
4. Click Create, then Done
5. Under **My Certificates**, double-click it, expand **Trust**, set
   **Code Signing** to *Always Trust*

`npm run build` detects and uses it automatically from then on. (The
certificate's own name still says "SHREK School Software" — deliberately
untouched during the rename to ClassDash, since renaming it would silently
break every permission grant already tied to that identity. Not a
leftover to clean up.)

### The .dmg release pipeline

`.github/workflows/release.yml` builds, packages, and publishes a release
whenever a `v*` tag is pushed:

```bash
git tag v1.0.0
git push fork v1.0.0
```

It runs `build.sh` on a `macos-latest` runner, stages `ClassDash.app`
alongside an `/Applications` symlink (the standard drag-to-install
layout), packages that into a `.dmg` with `hdiutil` (already a dependency
via `20-browser.js`'s own Brave download — no new tool to trust), and
publishes it as a GitHub Release with `gh release create --generate-notes`
using the default `GITHUB_TOKEN`. No signing secrets involved at all: the
build is ad-hoc signed, same as any local build without the certificate
above, which is why the README documents the Gatekeeper warning as
expected rather than a bug.

**Why a CI-built copy needs to ask where the project folder is.** A local
build bakes the real project path into `Info.plist` at build time; a
runner's own throwaway path is meaningless on whatever Mac later
downloads it. `16-summary.swift`'s `resolveProjectDir()` tries, in order:
the baked path, the folder right next to the `.app` itself, then a path
saved in `UserDefaults` from a previous run. If none of those resolve, and
only from `applicationDidFinishLaunching` (never from the `--notify`
headless launch path, which should fail quietly like it already does for
other missing files) — it shows an `NSOpenPanel` once, remembers the
choice, and never asks again. Verified live by launching a copy with a
deliberately bogus baked path from outside both `/Applications` and the
project folder.

---

## Update check

`build.sh` bakes the real version into `CFBundleShortVersionString` —
`VERSION`, passed in explicitly by the release workflow (the tag, "v"
stripped), or `git describe --tags --always --dirty` for a local build
(honest about not being a tagged release, rather than a hardcoded "1.0"
that was never actually true — see `build.sh`'s own comment for that
history).

`checkForUpdates()` in `16-summary.swift` runs on launch and every 24
hours after (`setupUpdateCheck()`), plus on demand from **Check for
Updates…** in the menu bar. It hits GitHub's `releases/latest` API
directly (no auth — the public unauthenticated rate limit is nowhere
close to what this needs), compares `tag_name` against the app's own
`CFBundleShortVersionString` with a plain numeric per-component compare
(`isNewer`), and writes the result to `update-status.json`:
`{"currentVersion", "latestVersion", "url", "checkedAt",
"updateAvailable", "dismissedVersion"}`. A manual check shows an
`NSAlert` either way — "you're up to date" or (bringing the window
forward and reloading it) the new banner; the automatic checks stay
silent unless there's actually something to show.

`dismissedVersion` is the one field Swift never writes — `08-page.js`
reads the whole file to decide whether to show the banner (only when
`updateAvailable` and `latestVersion !== dismissedVersion`, so
dismissing v1.3.0 today doesn't swallow v1.4.0's banner later), and the
dismiss button goes through the normal napominalka:// bridge
(`dismissUpdate`, arg = the version being dismissed) to
`26-update-check.js`, the same file-based handoff every other piece of
state shared between the app and the collector already uses. Also
surfaced as a read-only row in Settings → Advanced, regardless of
whether the banner's been dismissed, and through the home API —
`GET /api/update-status` returns the exact same object
(`update-status.json`'s own shape, `dismissedVersion` included), for
something like a Home Assistant sensor that watches `updateAvailable`
without needing to open the app at all. `null` fields there mean no
check has completed yet, not an error. `POST /api/update-status/dismiss`
(body `{"version": "..."}`) is the write side — the exact same
`dismissUpdate` the page's own banner button calls.

**`status` and `downloadedVersion`** are computed on read, not their
own stored fields — `computeStatus()` in `26-update-check.js` is the
one place that logic lives, so `readUpdateStatus()` (used by both
`08-page.js` and `17-api.js`) always agrees with itself regardless of
which of the three writers (`checkForUpdates()`, `installReadyUpdate()`
in `16-summary.swift`, `downloadUpdate()` here) touched the file last.
`status` is one of `unknown` (no check yet) / `error` (the last check
or download failed — see `error`) / `downloading` / `ready` (downloaded,
waiting on the native install confirmation) / `available` (newer
version exists, nothing downloaded) / `up_to_date`. `downloadedVersion`
is the version actually sitting downloaded — `null` until something
is, distinct from `currentVersion` (what's running) and `latestVersion`
(what GitHub has); internally still stored under `readyVersion`, kept
for the three places already writing that field name, just exposed
under the clearer one. Both a stale-state bug fix in one: previously,
successfully installing an update left `readyToInstall`/`readyVersion`/
`downloadedPath` on file describing an install that had already
happened (`installReadyUpdate()` deleted the `.dmg` but never told
`update-status.json` about it) — `status` would have read `"ready"`
for something already done. `installReadyUpdate()` now clears all
three right before relaunching.

**Downloading and installing** are two more actions, split across the
same two processes for a real reason, not by accident:

- **`POST /api/update-status/download`** starts the actual `.dmg`
  download — no body needed. Runs in `26-update-check.js`, in
  **Node**, not Swift: `17-api.js` is a fully independent, detached
  process (`startApiServer()` in `21-notifier-actions.js`), whose
  lifetime has nothing to do with whether `ClassDash.app` is even
  open, so a download that only worked while the app happened to be
  running would defeat the point of triggering it over the API at
  all. `checkForUpdates()` captures the release's `.dmg` asset URL
  (matched by `.hasSuffix(".dmg")` among the release's `assets`, not
  the release PAGE url) into `downloadURL`; `fetchToFile()` follows
  GitHub's redirect to the actual S3-hosted file itself (`https.get`
  never follows redirects on its own). Same async contract as
  `/api/reload`/`/api/check` — answers immediately, a client polls
  `GET /api/update-status`'s `downloading`/`readyToInstall` fields for
  progress. Quarantine is a non-issue here: macOS only tags a
  downloaded file `com.apple.quarantine` when the fetching app opts
  into `LSFileQuarantineEnabled` or calls the quarantine APIs directly
  (Safari, Mail) — a plain Node `https.get` never does either, so
  there's nothing to strip afterward, unlike a hypothetical
  `URLSession`-based Swift download would have needed to handle.
- **Installing is never reachable through the API, on purpose, at
  all.** It replaces `ClassDash.app`'s own running binary in
  `/Applications` and relaunches it — get that interrupted and there's
  nothing left running to notice or recover it — so it's gated behind
  a real `NSAlert` in `16-summary.swift` that nothing outside that
  process can trigger or skip. `maybeShowInstallPrompt()` checks
  `update-status.json`'s `readyToInstall` on launch and every 60
  seconds after (`installPromptTimer` — a separate, faster timer than
  `updateCheckTimer`'s 24-hour one, specifically so an API-triggered
  download that finishes while the app happens to be open gets noticed
  within a minute, not up to a day later). Declining ("Later") is
  remembered only for that version and only for the current launch
  (`declinedInstallVersion`, in-memory, not written to disk) — a fresh
  launch, or a newer release becoming ready, asks again.
  `installReadyUpdate()` mounts the `.dmg` with `hdiutil attach`,
  copies `ClassDash.app` over the one in `/Applications` (no
  sudo/elevation — the same unprivileged permissions `build.sh`'s own
  install step already relies on), detaches the volume, deletes the
  downloaded `.dmg`, and relaunches via `NSWorkspace.openApplication`
  before this instance quits. Any failure along the way shows what
  went wrong and leaves the currently-installed version untouched —
  never a partial copy.
- **Check for Updates…** in the menu bar is the one-stop version of
  all of the above, for anyone who'd rather not go find the API or
  wait for the 24-hour automatic check. `checkForUpdatesManually()`
  goes straight to `maybeShowInstallPrompt()` if a download is already
  sitting there ready (no reason to hit GitHub again just to report
  "up to date" relative to a version that isn't even installed yet);
  otherwise it runs a real check and, if there's something newer,
  `offerToDownload()` asks right there whether to start pulling it
  down. That reuses the exact same `downloadUpdate` action the API
  triggers — through `runAction()`, the normal node-CLI bridge path —
  safe to fire-and-forget from a menu click specifically because
  nothing here needs to wait synchronously on the result the way a
  page button would (see `downloadUpdate`'s own case in
  `21-notifier-actions.js`): `installPromptTimer`'s existing poll
  notices once it's actually done, the same way it already does for a
  download that came from the API instead.

---

## Settings reference

Almost everything below now has a control in the settings panel (gear
icon on the summary page) — this table exists for anyone editing
`settings.json` directly or scripting `node 19-settings.js --set`.

| key | meaning |
|---|---|
| `email` | your school email — goes into assignment links as `?authuser=` |
| `canvas` | your school's Canvas address; leave empty to skip Canvas |
| `account` | Google multi-login index inside the browser profile; usually `0` |
| `language` | `ru` or `en` |
| `summaryHours` | hours for the full daily reminder, e.g. `[8, 18]` |
| `exclusions` | class names to skip — applies to both Classroom and Edpuzzle |
| `edpuzzleEnabled` | `true` (default) — `false` skips Edpuzzle entirely, overriding both of its normal triggers (digest hours and a manual Fresh check alike): no tab opened, no visible browser window. Meant for a school where teachers already re-post every Edpuzzle assignment through Google Classroom, making the separate fetch redundant |
| `treatUndatedAsUrgent` | `true` (default) treats an assignment with no due date as due tomorrow; `false` treats it like a material instead — shown once, never due soon |
| `skipStaleClasses` | `true` (default) — a class with no assignment or announcement in `staleMonths` gets treated as done and stops being checked, on Classroom and Canvas as well as Edpuzzle. Edpuzzle has a real `updatedAt` per class to check directly; Classroom and Canvas don't, so staleness there is judged from this project's own memory of what it's ever seen for that class instead (see `22-class-activity.js`) |
| `staleMonths` | `3` (default), 1–12 — how long a class can go quiet before `skipStaleClasses` treats it as stale |
| `hideInactiveClasses` | `false` (default) — a class this project has **never once** recorded an assignment, material, or announcement for still gets listed by `showEmptyClasses` as just another empty one; this hides those specifically, leaving classes that are merely quiet for now still listed. Display only — doesn't change what gets fetched, unlike `skipStaleClasses` |
| `showEmptyClasses` | `false` (default) — the class filter only lists classes with something currently due/overdue/removed; `true` always lists every known class with a 0 next to the empty ones instead of them disappearing |
| `apiEnabled` | `false` (default) — starts or stops the home API when toggled from the settings panel |
| `apiNetwork` | `true` (default, only meaningful while `apiEnabled` is on) — binds `0.0.0.0` (LAN-visible) instead of `127.0.0.1` (this machine only). Defaults on because the main reason to enable the API at all is usually a client on a different device (Home Assistant); the actual protection is TLS + the bearer token, not which interface it's bound to. Changing this restarts the server — the bind address is only decided at its own startup |
| `apiPort` | port for the home API, default `8734`. **CLI/config-file only, deliberately not in the settings panel** — a user-changeable port would mean any client integration (e.g. a Home Assistant component) has to discover or be told about a moving target instead of a fixed default |
| `classTimeoutMs` | how long to wait for a class page, ms — panel's Advanced section |
| `emptyTimeoutMs` | shorter wait for classes that never had assignments, ms — Advanced |
| `passLimitMs` | a pass longer than this is treated as hung and killed, ms — Advanced |
| `browserPath` | advanced override for which browser binary to automate; leave empty — Advanced |

---

## Home API — technical detail

The user-facing version is in the [README](README.md#home-api). This is
the actual protocol, for anything consuming it (a Home Assistant
integration, a script, a phone shortcut).

- **Transport:** `https.createServer`. First run generates `api-cert.pem`
  + `api-key.pem` (self-signed, `openssl req`, RSA 2048, CN=`classdash-local`,
  10-year expiry) and `api-token.txt` (32 random bytes, hex) next to
  `17-api.js` — gitignored, unique per install, never regenerated on their
  own. A client should pin the certificate's SHA-256 fingerprint rather
  than doing normal CA validation — there's no real CA for a private home
  address.
- **Network binding:** controlled by `apiNetwork` (default `true` while
  `apiEnabled` is on) — `21-notifier-actions.js`'s `startApiServer()`
  passes `--network` through to `17-api.js` when set, which is the same
  flag `node 17-api.js --network` uses when run by hand. Binds `0.0.0.0`
  instead of `127.0.0.1`. Decided once at the server's own startup, so
  changing this setting stops and restarts the process rather than
  reconfiguring a running one — see the `'config'` case in
  `21-notifier-actions.js`, which does that whenever `apiNetwork` changes,
  not only when `apiEnabled` itself does.
- **Auth:** every route, root included, needs
  `Authorization: Bearer <token>` — 401 otherwise, checked with
  `crypto.timingSafeEqual`. The token is read fresh from disk on every
  request, not cached, so rolling it from the settings panel takes effect
  on the very next request with no server restart.
- **Adding a new write handle is not a bigger decision than adding a
  button.** Every write here (see `WRITE_HANDLERS` in `17-api.js`) is
  TLS + bearer-token authenticated, same as every read, and routes
  through the exact same `notifierActions.main()` dispatcher a click on
  the page itself uses — exposing one through the API isn't opening a
  new trust boundary, it's just letting an already-authenticated client
  press a button that already exists locally. When a page-local action
  (a toggle, a dismiss, anything `notifierActions.main()` already
  handles) has an obvious API shape, add the `WRITE_HANDLERS` entry in
  the same pass, don't treat it as needing separate justification. The
  two real exceptions: `apiEnabled`/`apiNetwork` are deliberately kept
  out (changing them restarts the very process that would be answering
  the request — see that handle's own comment, a technical constraint,
  not caution), and a genuinely irreversible action (`/api/virtual/delete`)
  should say so in its own comment the way that one already does.
- **REST (GET, read-only):** `/api/status` `/api/due-soon` `/api/ahead`
  `/api/overdue` `/api/done` `/api/assignments` `/api/announcements`
  `/api/removed` `/api/classes` `/api/virtual` `/api/check-status`
  `/api/update-status`.
- **Tags:** every assignment object (from any of the handles above that
  return one) carries a `tags` array — `"hidden"`, `"muted"`, `"done"`,
  `"removed"`, any combination, or empty. This replaced the API
  silently deciding what a client does and doesn't get to see:
  - `/api/overdue` used to filter hidden items out entirely; now they're
    in the list, tagged `"hidden"`, same as `/api/assignments` (which
    was already including them, just without any way to tell).
    `/api/status`'s `overdue` COUNT is still the filtered, actionable
    number — that distinction is deliberate, see its own comment in
    `17-api.js`.
  - `/api/done` is new — turned-in work ("Completed Assignment" /
    "Completed Question" in Classroom's own type field) used to be
    dropped from `sortIntoBuckets()` entirely, invisible everywhere,
    API included. Now it lands in its own bucket, tagged `"done"`, with
    its own handle — same reasoning as `/api/removed` already being
    separate from `/api/assignments`: it's not "what needs doing", so
    it doesn't belong mixed in there, but it's real data and deserves a
    real handle instead of just vanishing. `/api/status` gained a
    matching `done` count.
  - `/api/removed` items get `tags: ["removed"]` for free — `x.removed`
    is the same field that already routed them there.
  - An item that's BOTH removed and completed (the teacher took down
    something already turned in) goes to `/api/removed`, not
    `/api/done` — `sortIntoBuckets()` checks `removed` first, unchanged
    from before this.
- **`/api/classes`, specifically:** the full class roster, merged across
  Classroom/Canvas/Edpuzzle (`allKnownClasses()` in `08-page.js`, not
  just Classroom's own `classes.json` — that was the old shape).
  `[{"name": "...", "dueSoon": 0, "ahead": 0, "overdue": 0, "status":
  "known"}, ...]`. A class with all-zero counts only appears here when
  `showEmptyClasses` is on — same setting, same meaning, as the "show
  classes with nothing due" toggle in the settings panel;
  `hideInactiveClasses` narrows it further the same way it does there
  (a class with zero history, not just zero due right now, stays out
  either way); `skipStaleClasses` narrows it again the same way (a
  class gone quiet longer than `staleMonths` stays out too — see
  `filtersPanel`'s own comment in `08-page.js`); an excluded class is
  left out unconditionally. `/api/status`'s own `classes` count is NOT
  gated by any of this — it's `allKnownClasses().length`,
  unconditionally, so an existing client's "how many classes total"
  number doesn't start moving on its own the moment someone flips a
  display setting it's never heard of.
  - **`status`** — `"known"` (the platform still lists this class) or
    `"orphaned"` (it doesn't anymore, but `last-collection.json` still
    has old data for it — see `knownClassStatus()` in `08-page.js`).
    Comes up for a real class transfer, or a class hidden on Classroom's
    own side (its "hide this class from me" feature — the only option
    when a student genuinely can't leave a class outright). Without
    this a client can't tell an orphaned class apart from a real one;
    exactly this ambiguity flooded a Home Assistant integration with an
    entity for a class the student had already moved on from — the
    exclusions list is the actual fix (once excluded, the class and its
    old data both disappear for good), `status` is just so a client
    doesn't have to guess in the meantime.
- **Virtual assignments** — reminders the user types in themselves; see
  `24-virtual-assignments.js`'s own header comment for the full "why".
  `GET /api/virtual` returns all of them (active, hidden, and done
  alike) through the same `toPublic()`/`tags` shape everything else
  uses — a done one comes back tagged `"done"`, a hidden one tagged
  `"hidden"`. Writes: `POST /api/virtual/create` (body
  `{"title": "...", "class": "...", "due": "..."}` — only `title` is
  required) and `/edit` (same body plus a required `"id"` — `title` is
  still required on every edit too, `class`/`due` are always
  overwritten with whatever's sent, including back to `null`; a full
  snapshot each time, not a partial diff, same as `saveSettings()` does
  for the settings panel), `/done` and `/undone`, `/hide` and `/unhide`
  (all body `{"id": "..."}`), and `/delete` (same body) — the one
  genuinely irreversible handle in this whole API, matching `remove()`
  in `24-virtual-assignments.js` being a real deletion rather than a
  flag. A done reminder clears itself automatically 7 days after being
  marked done (pruned lazily, on the next read of the file — see that
  file's own comment); a hidden one stays hidden until explicitly
  un-hidden, no expiry.
- **`/api/check-status`** — "did the last check actually work?", per
  platform: `{"classroom": {...}, "canvas": {...}, "edpuzzle": {...}}`,
  each `{"status": "ok"|"problem"|"unknown", "at": "<ISO>"|null,
  "detail": "<string>"|null}`. `ok`/`problem` come from the last real
  attempt at that platform; `unknown` means never attempted — either no
  address configured (Canvas) or turned off (`edpuzzleEnabled`), or no
  check has completed yet at all. Classroom's status is an AND across
  every class actually read that pass, not a per-class breakdown — one
  broken class is enough to call the whole platform `"problem"`, with
  the failing class's name and error in `detail`. Canvas/Edpuzzle being
  off overrides whatever was last recorded immediately, live at read
  time — see `25-check-status.js`'s own header comment for the full
  reasoning, including why this doesn't share a handle with
  `/api/status` (a different question — pipeline health, not "what's
  due" — and a separate handle avoids any risk of changing a shape
  existing clients already depend on).
- **Push:** `/api/stream` — Server-Sent Events, not WebSocket, since
  push here only ever needs to go server → client. Two event names on
  the same connection:
  - `event: update` — sent immediately on connect (every REST handle's
    output bundled into one object, keyed by name with `/api/`
    stripped), then again only when a collection pass actually changes
    something — detected by watching
    `last-collection.json`/`messages.json` and comparing snapshots with
    `status.collectedAt`/`minutesAgo` zeroed out specifically, since
    those drift on their own every single collection pass even when
    nothing real changed. A client should treat this as real new data.
  - `event: heartbeat` — sent on a fixed 1-minute timer regardless of
    whether anything changed, payload is just `/api/status` (not a full
    snapshot). Exists because a push-only client — this was built for
    exactly one, the [ha-classdash](https://github.com/vemboy200/ha-classdash)
    Home Assistant integration, which deliberately stayed `local_push`
    with no periodic REST fallback — has no way to tell "checked,
    genuinely nothing new" apart from "stopped running an hour ago"
    without it: both look identical to a client that only ever hears
    about real changes. A client should treat this as a freshness
    signal only, distinguished purely by the SSE event name — never
    merge it in as if it were new assignment/announcement data.
- **Writes (POST):** `/api/hide` `/api/unhide` `/api/mute` `/api/unmute`
  — body `{"id": "..."}`, the same id `/api/due-soon` etc. hand out.
  `/api/settings` — body is any subset of the settings table below (a
  partial update, not a full snapshot); `apiEnabled` and `apiNetwork` are
  refused with a 400 specifically (see below). `/api/reload` and
  `/api/check` take no body — `reload` is the quick pass (Classroom +
  Canvas, ~17s), `check` is the full one (~1 min, Edpuzzle included).
  Both only START the pass and answer right away; `/api/status`'s
  `collectedAt`/`minutesAgo` is how a client finds out when it's
  actually done. Every one of these calls straight into
  `21-notifier-actions.js`'s `main()` — the exact same function
  `16-summary.swift`'s bridge calls for a click on the actual page, so
  there's one implementation of "what hiding an assignment does," not
  two that could drift apart. A non-`POST` request to any of these gets
  405; a `GET`-only handle gets 405 back for anything but `GET`, the
  same way. `OPTIONS` is answered before the token check (with CORS
  headers, no auth) so a browser's own preflight for a `POST` succeeds —
  a preflight deliberately never carries `Authorization`.
- **Why `apiEnabled`/`apiNetwork` are refused through `/api/settings`:**
  changing either one stops and restarts the API process itself. From
  the settings panel that's safe — a separate, short-lived CLI process
  (`node 21-notifier-actions.js config ...`) does the stopping while the
  long-running server just gets replaced. From inside the *server's own*
  request handler it isn't: it would be asked to signal itself mid-
  response. Traced through `stopApiServer()`'s wait loop to confirm —
  it polls its own pid with `process.kill(pid, 0)`, which trivially
  keeps succeeding because the process doing the checking is the same
  one still synchronously running this very request, so it can never
  observe itself as gone. It stalls out the full 2-second deadline and
  then `SIGKILL`s itself, before a response could ever go out. Refusing
  the two keys up front avoids that outright rather than working around it.
- Cert/token generation, the pid file, and the auth check itself live in
  `23-api-security.js`, shared between `17-api.js` and
  `21-notifier-actions.js` — the latter needs the exact same logic to
  start/stop the server and roll the token from the settings panel,
  without requiring the whole HTTP server module.

---

## How it is put together

| file | what it does |
|---|---|
| `05-playwright-draft.js` | the collector: reads sources, diffs against memory, notifies |
| `08-page.js` | builds `summary.html` — plain code, no model involved |
| `10-canvas.js` | Canvas through its official REST API; courses are discovered, not hardcoded; assignments and Pages (materials) both |
| `11-edpuzzle.js` | Edpuzzle through its own internal API (no public one exists — learned by watching the site itself); needs a visible window |
| `12-feed.js` | teacher announcements from the Classroom stream |
| `13-transcripts.js` | video → audio (ffmpeg) → text (Whisper), all local — **not wired in yet** |
| `14-transcript-page.js` | renders one transcript as its own page — **not wired in yet** |
| `16-summary.swift` | the app — the summary window, the `napominalka://` bridge and its browser-tab fallback, notifications, and locating the project folder, all in one |
| `17-api.js` | the home API |
| `18-language.js` | Russian and English wording |
| `19-settings.js` | settings: read, write, validate |
| `20-browser.js` | downloads and installs the project's own isolated Brave |
| `21-notifier-actions.js` | the actual logic behind every `napominalka://` action — run by 16-summary.swift directly, not a separate app |
| `22-class-activity.js` | "has this class gone quiet?" — shared by Classroom's and Canvas's own staleness checks |
| `23-api-security.js` | the home API's certificate/token generation, auth check, and running-process tracking — shared by 17-api.js and 21-notifier-actions.js |
| `24-virtual-assignments.js` | reminders the user types in themselves — storage, done/hidden/delete, and bucketing by due date |
| `25-check-status.js` | per-platform "did the last check work?" — ok/problem/unknown |
| `26-update-check.js` | reads the update check 16-summary.swift already ran; writes dismissedVersion; downloads the release .dmg (the one piece of "update support" that lives in Node, not Swift) |
| `build.sh` | builds the app, registers its URL scheme, bakes in the project path |
| `.github/workflows/release.yml` | builds and publishes a `.dmg` release on a `v*` tag push |

The code comments are fairly heavy. Those comments are not decoration: nearly
every one of them records a failure that already happened and explains why
the obvious approach does not work.

There used to be a *second app* here too — first `Напоминалка.app`, briefly
`SHREK Notifier.app` — whose name showed up in Privacy & Security prompts
and notification banners, which read as alarming to anyone who didn't know
this project. It's one app now, ClassDash, doing both jobs.

## A few things learned the hard way

- **Silence is the worst failure.** A pass that reads nothing looks exactly like
  a pass that found nothing. Several fixes here exist only to make failures
  loud.
- **Check what was printed, not what printed it.** A generator can be
  syntactically perfect and still emit broken output. Once, a single escaped
  character killed every script on the page for a week and nobody noticed.
- **A source that was not read is not a source that is empty.** Assignments
  from a source that failed are carried over from memory, or they come back
  tomorrow pretending to be new.
- **Things that disappear are marked, not deleted.** A list that silently gets
  shorter is worse than one that admits what happened.
