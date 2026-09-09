<img width="1920" alt="classdashlogo" src="https://github.com/user-attachments/assets/c8efe024-41ef-43de-9389-30289d888905" />
One page with everything due, collected automatically from Google Classroom,
Canvas and Edpuzzle. Checks itself on a schedule, costs nothing to run, and
stays quiet unless something actually changed.

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
it is the day something was due. ClassDash checks all of them for you and
puts everything on one page.

## What it does

- **No AI at runtime.** Once set up, it's an ordinary program. No tokens,
  no API keys, no cost per run.
- **Runs itself** on a schedule, every 10 minutes during the school day.
- **Speaks up only when it matters** — a new assignment, a new teacher post,
  or a twice-daily reminder of what's still burning.
- **A real desktop notification** that opens a real window, not a browser tab.
- **Read-only.** It never submits, answers, or changes anything on your behalf.

## What it isn't

- **Not an answer machine.** It can fetch a transcript of an Edpuzzle video so
  you can read what was said, but it will not pull the embedded questions or
  their answers — that's a deliberate line, not a missing feature.
- **Not a scraper of other people's data.** Every request goes through your
  own logged-in browser session and returns exactly what your own account
  can already see.
- **Built for one school's setup, not every possible one.** Canvas and
  Edpuzzle are read through real APIs; Google Classroom doesn't offer one to
  students, so that part reads the actual page and can break if Google
  changes it. (Classroom assignments do technically also show up through
  the Google Calendar API — but that requires your school's Google
  Workspace admin to have that API turned on for student accounts, which
  most schools don't. Reading the page directly is the one approach that
  keeps working no matter what a given school has locked down.)

---

## Get it

One thing goes on your computer: the **ClassDash app**. The first time
you open it, it sets up its own **project folder** (does the actual
work — reading your assignments, writing the summary page) for you —
picking a browser, signing you in, all of it — no Terminal required.

### 1. Download and install

Go to the [Releases page](https://github.com/vemboy200/ClassDash/releases)
and grab the build for your platform:

**macOS** — download the `.dmg`, open it, and drag **ClassDash** into
your **Applications** folder, same as installing any other Mac app.

> [!WARNING]
> **macOS builds are not code-signed or notarized by Apple.** Gatekeeper
> will block the app by default and may say it's "damaged" or from an
> "unidentified developer" — that's expected, not a sign anything's
> actually wrong with it, it's just what happens without a paid Apple
> Developer account to sign builds with. To run it anyway: right-click
> (Control-click) the app → **Open** → **Open** again to confirm. If
> that doesn't work, go to **System Settings → Privacy & Security**,
> scroll down, and click **Open Anyway** after your first blocked
> attempt. You only need to do this once; after that it opens normally.

**Windows** — download the `.exe` and run it. It's a real installer
(not one-click) that asks where to install, same as any other Windows
program — defaults to `Program Files`, needs admin rights to install
there.

> [!WARNING]
> **Windows builds aren't code-signed either** (same reason as
> macOS — no paid certificate). SmartScreen will say "Windows protected
> your PC." Click **More info**, then **Run anyway**. Same one-time
> thing as Gatekeeper above, not a sign anything's actually wrong.

**Building either one yourself** is the other option, if you'd rather
not run a downloaded binary or want to modify the code — see
[CONTRIBUTING.md](CONTRIBUTING.md#building-from-source).

**On Linux**, or if you'd simply rather not install an app at all: the
collector, the summary page, and the home API are plain Node and run
fine without either native wrapper — open `summary.html` in any browser
to view it. Be aware this is view-only, though: buttons like "hide" and
saving settings from the page depend on a bridge only the real Mac or
Windows app provides, so without one those clicks won't actually do
anything. Setting up the project folder by hand this way still needs
Terminal — see [Doing it by hand](#doing-it-by-hand) below.

### 2. Launch it — first run sets everything up

Open **ClassDash**. If it doesn't already know about a project folder,
it asks: **set up a new one, or point it at an existing one** — pick the
first option for an actual first run. From there it walks you through
the rest itself:

- creates the project folder wherever you choose
- offers to install **Brave** (recommended — more privacy-focused,
  and this installs a separate, isolated copy just for ClassDash,
  never touching your everyday browser) or lets you use Chrome instead,
  or pick a different browser by hand
- opens Settings so you can fill in your school email and (if your
  school uses it) your Canvas address — everything else has a default
  and can stay as-is
- offers to sign you in — a real browser window opens and you log in
  by hand, the same as logging into any site. That session is saved and
  lasts for weeks; when it eventually expires, ClassDash tells you with
  a notification instead of silently showing stale data (macOS only for
  now — see [Troubleshooting](#troubleshooting))

Skipped a step, or want to redo one later — a different browser,
signing in again? Both are still reachable any time afterward from the
app's own menu (**Choose Browser…**, **Sign In to Google Classroom…**),
not just during that first run.

**On macOS specifically**, two permissions still need granting, both in
**System Settings → Privacy & Security**:

- **App Management / Data Access** — needed to actually read Classroom
  and Canvas. macOS will prompt for this the first time it's needed.
- **Notifications** — go to **System Settings → Notifications →
  ClassDash → Allow Notifications** yourself. macOS does *not* prompt
  for this one on its own; without doing it manually, notifications will
  just silently never arrive.

Windows doesn't have an equivalent permission step — nothing extra to
grant there.

### 3. Keep it running automatically

Right now, ClassDash checks on its own schedule only while it's open.

**On macOS**, the alternative is `launchd` (the built-in scheduler) to
run a check periodically even while the app's closed. There's no
ready-made schedule file in this repo — it needs your own computer's
absolute file paths baked in, so this part's covered in
[CONTRIBUTING.md](CONTRIBUTING.md) rather than here.

**On Windows**, there's no equivalent built yet — leaving the app open
is the only option for now.

Either way, opening the app and clicking the reload button (or holding
it down for a full check) works fine on its own in the meantime.

### Doing it by hand

Prefer Terminal, want to modify the code, or you're on Linux where the
app-based setup above isn't available at all? The manual path still
works exactly like it always has:

**Requirements:** [Node.js](https://nodejs.org) 18 or newer.

```bash
git clone https://github.com/vemboy200/ClassDash.git
cd ClassDash
npm install
npm run setup-browser
cp settings.example.json settings.json    # then edit it
npm run login
```

(No `git`? Download the ZIP from the green "Code" button on
[the GitHub page](https://github.com/vemboy200/ClassDash) instead, unzip
it, and `cd` into that folder.)

`setup-browser` only works on macOS — checks whether Google Chrome is
already installed (if so, nothing else happens, since Chrome already
works safely for this), and only downloads its own isolated copy of
Brave if Chrome's missing. On Windows or Linux, install Chrome yourself
first, or fill in `browserPath` in `settings.json` by hand.

---

## Using it

- **Hide** an overdue assignment once it's handled (already turned in,
  no longer relevant) — the small "hide" link on its card. It can be
  brought back with the button at the bottom of that section.
- **Not urgent** on an assignment with no real due date moves it out of
  "due soon" without hiding it entirely.
- **Reminders** — for the "a teacher said something in class and you
  forgot" problem none of the three platforms can ever solve, since
  nothing was actually assigned through them. Type it into the
  **Reminders** section yourself, with an optional class and due date.
  **Edit** one any time to fix a typo or change the date — the class
  field suggests matching classes as you type, but never applies one on
  its own. Mark one **done** (it clears itself automatically a week
  later — long enough to notice a misclick, short enough not to pile
  up) or **hide** it (stays hidden until you bring it back, no expiry),
  or **delete** it outright, which is the one action here with no undo.
- The **gear icon** opens settings: your email/Canvas address, which
  classes to skip, language, and toggles for most of the behavior
  described above. Changes take effect right after saving — most are
  instant, a couple (like changing which classes get read) trigger a
  quick real check in the background.
- **Refresh** just rereads what's already been collected — no new fetch.
  **Fresh check** actually checks everything again, Edpuzzle included by
  default, which takes about a minute and opens a browser window for
  it. If your teachers already post Edpuzzle assignments through Google
  Classroom too, there's a setting to skip Edpuzzle entirely — a fresh
  check is then faster and never opens that window.
- Three small dots next to the gear icon, one per platform — blue means
  the last check for that platform actually worked, red means it
  failed, gray means it isn't being checked at all (Canvas with no
  address set, Edpuzzle turned off, or no check has run yet). Click
  them for the full breakdown, timestamps and error detail included.
- ClassDash checks for a new release automatically, once a day, and
  shows a dismissable banner if one's out. **Check for Updates…** in
  the menu bar (under **ClassDash** on macOS, right at the top on
  Windows) checks on demand instead of waiting — and if there's
  something newer, offers to download and
  install it right there, no need to go find the `.dmg` yourself.

## Home API

Turning on **Enable home API** in settings starts a small HTTPS server
on your own computer — useful if you want the data somewhere else, like
a Home Assistant dashboard, or want to hide an assignment or trigger a
check from somewhere other than this window. The panel shows an
**Allow LAN access** toggle (on by default — see below), an
**access key** (masked, with Copy and Roll buttons — Roll generates a
brand new one and immediately cuts off the old one, for if a key ever
leaks), and a **certificate fingerprint**, the last two both needed to
configure whatever's going to read from it.

The API itself is off by default — nothing starts until you turn it on.
Once it's on, **LAN access is on by default too**, not localhost-only:
the main reason to enable this at all is usually something like Home
Assistant, running on a different device, and a server that only
answers its own machine can't do that regardless of what address you
point at it. The actual protection is the encryption and the access
key, not which network interface it's listening on — turn off
**Allow LAN access** if you'd rather it only ever answer this same
computer.

Most of it is read-only — the same data this window shows. A few
handles change something instead: hiding or un-hiding an assignment,
marking one not urgent and back, changing a display setting, or
starting a check (a quick one or a full one). Every one of those needs
`POST` instead of a plain request, and does exactly what the matching
button on this page does — nothing a client with the access key
couldn't already do by hand from here. The full list of handles, and
what to send each one, is in
[CONTRIBUTING.md](CONTRIBUTING.md#home-api--technical-detail).

---

## Troubleshooting

**macOS says the app is "damaged" or from an "unidentified developer."**
Expected — see [Download and install](#1-download-and-install) above for
the right-click → Open workaround.

**Windows says "Windows protected your PC."** Also expected, same
underlying reason (no paid signing certificate) — click **More info**
→ **Run anyway**.

**Notifications never show up.** On macOS, this almost always means the
manual System Settings grant hasn't been done — macOS doesn't prompt
for it on its own. **On Windows, this is currently expected, not a
bug to chase**: desktop notifications (new assignments, a "you got
signed out, sign in again" alert) haven't been built for Windows yet —
the app still works and collects normally, there's just nothing that
pops up to tell you about it. Check the page itself, or the little
status dots next to the gear icon, instead.

**A full check or a save is stuck / did nothing (macOS).** The first
one after install may be waiting on the App Management permission
prompt — check System Settings → Privacy & Security.

**On Windows, the home API shows as enabled but doesn't seem to be
running** — most likely after reinstalling the app or letting it
self-update. Toggle **Enable home API** off, Save, back on, Save again
— that forces a fresh restart of the server process. A real fix for
this is planned but not built yet.

**Something in the code itself is misbehaving**, or you want to
understand *why* something works the way it does — that detail lives in
[CONTRIBUTING.md](CONTRIBUTING.md), not here.

---

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).

    ClassDash — collects school assignments into one page
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
