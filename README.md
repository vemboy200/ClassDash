# SHREK School Software

**S**exy **H**elpful **R**adiant **E**xcellent **K**issable.

One page with everything due, collected automatically from Google Classroom,
Canvas and Edpuzzle. Runs on a schedule, costs nothing to run, and stays quiet
unless something actually changed.

Written by Claude under the supervision of someone who knows nothing about
coding, for his own homework, then cleaned up enough to share.

> **No warranty.** This is a personal project shared as-is. It may break,
> miss an assignment, or stop working when one of the sites changes something.
> Do not rely on it as your only way of tracking deadlines.

---

## The problem

Four different sites, each with its own idea of what "your assignments" means.
Classroom shows a *"nothing due in the next 7 days"* widget while a summer
assignment quietly sits 14 days out. Canvas hides unpublished courses. Edpuzzle
has its own list. Checking all four every day is a chore, and the day you skip
it is the day something was due.

## What it does

A plain Node script opens a real browser, reads your own assignment lists,
compares them with last time, and writes a single HTML page. If nothing is new,
it says nothing at all.

- **No AI at runtime.** It is an ordinary program. No tokens, no API keys,
  no cost per run.
- **Runs itself.** `launchd` on macOS, every 10 minutes during the school day.
- **Speaks up only when it matters** — a new assignment, a new teacher post,
  or a twice-daily reminder of what is still burning.
- **Native notification** that opens a native window, not a browser tab.
- **Read-only.** It never submits, answers, or changes anything.

## What it is not

- **Not an answer machine.** It can fetch a transcript of an Edpuzzle video so
  you can read what was said — English is not the author's first language and
  accents are a tax unrelated to the material. It will not pull the embedded
  questions or their answers, and that boundary is deliberate.

  Transcripts are built and tested end to end (7 minutes of speech recognised
  in 13 seconds, locally, no network), but **not wired into the collector yet** —
  there has not been a single Edpuzzle assignment to try them on. The summary
  page has an empty section waiting for them.
- **Not a scraper of other people's data.** Every request goes through your own
  logged-in browser session and returns exactly what your own account can
  already see.
- **Not portable yet.** It was built against one school's setup. Canvas and
  Edpuzzle talk to documented-enough APIs; Google Classroom has no student API,
  so that part reads the rendered page and will break when Google changes it.

---

## Requirements

- macOS (notifications, the summary window and the scheduler are macOS-specific)
- Node.js 18+
- A real Chromium-based browser: if you already have Google Chrome installed,
  nothing else is needed — it's used automatically, with its own isolated
  profile folder that never touches your everyday Chrome profile. If you
  don't have Chrome, `npm run setup-browser` installs a dedicated, isolated
  copy of Brave instead.
- Optional, for video transcripts: `ffmpeg`, `whisper-cpp`, and a Whisper model

## Setup

```bash
npm install
npm run setup-browser
cp settings.example.json settings.json    # then edit it
```

`setup-browser` first checks whether Google Chrome is already installed — if
so, it prints a note and does nothing else, since Chrome already works
safely (see below). Only if Chrome is missing does it download a copy of
Brave (open source, Chromium-based) into `.browser/` inside this project —
not a system install, not your everyday browser, nothing outside this
folder.

Why any of this is needed at all: Google's login flow blocks plain automated
Chromium as "not secure," so a real, recognized browser has to be launched
instead of Playwright's bundled one. That's normally safe, because
`--user-data-dir` (an isolated profile folder inside this project) keeps the
automated session completely separate from whatever profile you actually use
day-to-day — real Chrome and Brave both respect that flag correctly. It
*isn't* safe with every Chromium-based browser, though: one fork (Arc) turned
out to ignore its assigned profile folder entirely and write into the real
one instead, and the account-isolation flags Playwright launches with
corrupted that profile's saved logins and extensions on the next normal
launch. That's the specific failure this whole setup avoids — by using only
Chrome or a dedicated Brave copy, never a browser confirmed to ignore its
profile folder.

Filenames and code comments were originally Russian, and have since been
translated to English so contributors who don't read Russian can follow the
code. The bilingual interface on the summary page itself (`ru`/`en`) is
unrelated to that and still works exactly the same — only the *source code*
changed language, not the app's own UI.

Settings live in `settings.json`:

| key | meaning |
|---|---|
| `email` | your school email — goes into assignment links as `?authuser=` |
| `canvas` | your school's Canvas address; leave empty to skip Canvas |
| `language` | `ru` or `en` |
| `summaryHours` | hours for the full daily reminder, e.g. `[8, 18]` |
| `exclusions` | class names to skip |
| `account` | Google multi-login index inside the browser profile; usually `0` |
| `apiPort` | port for the home API, default `8734` |
| `classTimeoutMs` | how long to wait for a class page, ms |
| `emptyTimeoutMs` | shorter wait for classes that never had assignments, ms |
| `passLimitMs` | a pass longer than this is treated as hung and killed, ms |
| `browserPath` | advanced override for which browser binary to automate; leave empty (see `setup-browser` above) |

Settings can also be edited from the summary page itself — the gear button next
to the reload arrow — or from the command line:

```bash
npm run config                                    # show current settings
node 19-settings.js --set language en             # change one
```

Sign in once — a real browser window opens and you log in by hand:

```bash
npm run login
```

Cookies land in `./browser-profile` and last for weeks. When Google eventually
signs you out, the script says so with a notification instead of silently
showing yesterday's data.

Then run it:

```bash
npm start
```

Build the summary window app:

```bash
npm run build
```

> **Note.** The macOS notifier app is not in this repository — its source stays
> on the author's machine. Without it you get everything except desktop alerts
> and the buttons on the summary page (`mute`, `hide`, `settings`, long-press
> reload). The collector, the page, the transcripts and the home API all work.
> On Linux or Windows the same is true: the collector and the page are plain
> Node, the notifier and the window are macOS-only.

To run on a schedule, point `launchd` (macOS) or `cron` (Linux) at
`npm start` in this folder. There is no `.plist` in the repo — it contains
absolute paths, so write your own.

## Home API

A small read-only HTTP server, in case you want the data somewhere else —
a phone, a second machine, a home dashboard:

```bash
npm run api                    # localhost only
node 17-api.js --network       # visible to your home network
```

Endpoints: `/api/status` `/api/due-soon` `/api/ahead` `/api/overdue`
`/api/assignments` `/api/announcements` `/api/removed` `/api/classes`

**Localhost is the default on purpose.** `--network` exposes your assignments and
your teachers' posts to anything on the network, with no password.

---

## How it is put together

| file | what it does |
|---|---|
| `05-playwright-draft.js` | the collector: reads sources, diffs against memory, notifies |
| `08-page.js` | builds `summary.html` — plain code, no model involved |
| `10-canvas.js` | Canvas through its API; courses are discovered, not hardcoded |
| `11-edpuzzle.js` | Edpuzzle through its API; needs a visible window |
| `12-feed.js` | teacher announcements from the Classroom stream |
| `13-transcripts.js` | video → audio (ffmpeg) → text (Whisper), all local — **not wired in yet** |
| `14-transcript-page.js` | renders one transcript as its own page — **not wired in yet** |
| `16-summary.swift` | the summary window — a real app, not a browser tab |
| `17-api.js` | the home API |
| `18-language.js` | Russian and English wording |
| `19-settings.js` | settings: read, write, validate |
| `20-browser.js` | downloads and installs the project's own isolated Brave |
| `build.sh` | builds both apps and bakes in the project path |

The code comments are fairly heavy. Those comments are not decoration: nearly
every one of them records a failure that already happened and explains why
the obvious approach does not work. (A handful of filenames the app hands off
to its separate, not-in-this-repo macOS notifier app — `Напоминалка.app` and
a few `.txt` files it reads and writes — are kept in their original Russian
on purpose, since renaming them would silently break that other app until
its own source is updated to match.)

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

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).

    School Digest — collects school assignments into one page
    Copyright (C) 2026 Artem

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

In plain terms: use it, change it, share it. If you distribute a modified
version, that version has to stay open too.

