# Contributing / how this is built

This is the technical companion to [README.md](README.md) — the "why," not
the "how do I use it." Read this if you want to modify the code, understand
a design decision, or build against the home API.

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
| `treatUndatedAsUrgent` | `true` (default) treats an assignment with no due date as due tomorrow; `false` treats it like a material instead — shown once, never due soon |
| `skipStaleClasses` | `true` (default) — a class with no assignment or announcement in `staleMonths` gets treated as done and stops being checked, on Classroom and Canvas as well as Edpuzzle. Edpuzzle has a real `updatedAt` per class to check directly; Classroom and Canvas don't, so staleness there is judged from this project's own memory of what it's ever seen for that class instead (see `22-class-activity.js`) |
| `staleMonths` | `3` (default), 1–12 — how long a class can go quiet before `skipStaleClasses` treats it as stale |
| `hideInactiveClasses` | `false` (default) — a class this project has **never once** recorded an assignment or announcement for still gets listed by `showEmptyClasses` as just another empty one; this hides those specifically, leaving classes that are merely quiet for now still listed. Display only — doesn't change what gets fetched, unlike `skipStaleClasses` |
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
- **REST:** `/api/status` `/api/due-soon` `/api/ahead` `/api/overdue`
  `/api/assignments` `/api/announcements` `/api/removed` `/api/classes`.
- **Push:** `/api/stream` — Server-Sent Events, not WebSocket, since the
  API is one-directional/read-only. Sends `event: update\ndata: <json>\n\n`
  immediately on connect (every REST handle's output bundled into one
  object, keyed by name with `/api/` stripped), then again only when a
  collection pass actually changes something — detected by watching
  `last-collection.json`/`messages.json` and comparing snapshots with
  `status.collectedAt`/`minutesAgo` zeroed out specifically, since those
  drift on their own every single collection pass even when nothing real
  changed.
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
| `10-canvas.js` | Canvas through its official REST API; courses are discovered, not hardcoded |
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
