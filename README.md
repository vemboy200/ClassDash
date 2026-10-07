<img width="1920" alt="classdashlogo" src="https://github.com/user-attachments/assets/c8efe024-41ef-43de-9389-30289d888905" />
One page with everything due, collected automatically from Google Classroom, Canvas and Edpuzzle. Checks itself on a schedule, costs nothing to run, and stays quiet unless something actually changed.

Written by Claude under the supervision of someone who knows nothing about coding, for his own homework, then cleaned up enough to share.

> **No warranty.** This is a personal project shared as-is. It may break, miss an assignment, or stop working when one of the sites changes something. Do not rely on it as your only way of tracking deadlines.

---

## The problem

Four different sites, each with its own idea of what "your assignments" means. Classroom shows a *"nothing due in the next 7 days"* widget while a summer assignment quietly sits 14 days out. Canvas hides unpublished courses. Edpuzzle has its own list. Checking all four every day is a chore, and the day you skip it is the day something was due. ClassDash checks all of them for you and puts everything on one page.

## What it does

- **No AI unless you want it.** Collecting your assignments is an ordinary program: no tokens, no API keys, no cost per run. AI is an optional extra, off until you pick one in Settings → AI, and it can run entirely on your own computer.
- **Runs itself** on a schedule, every 10 minutes during the school day.
- **Speaks up only when it matters** — a new assignment, a new teacher post, or a twice-daily reminder of what's still burning.
- **A real desktop notification** that opens a real window, not a browser tab.
- **Read-only.** It never submits, answers, or changes anything on your behalf.

## What it isn't

- **Not an answer machine.** It can fetch a transcript of an Edpuzzle video so you can read what was said, but it will not pull the embedded questions or their answers — that's a deliberate line, not a missing feature.
- **Not a scraper of other people's data.** Every request goes through your own logged-in browser session (or, for Canvas, your own access token) and returns exactly what your own account can already see.
- **Built for one school's setup, not every possible one.** Canvas has an official API, but Google Classroom doesn't offer one to students, so that part reads the actual page and can break if Google changes it, and Edpuzzle only has internal endpoints that aren't documented. (Classroom assignments do technically also show up through the Google Calendar API — but that requires your school's Google Workspace admin to have that API turned on for student accounts, which most schools don't. Reading the page directly is the one approach that keeps working no matter what a given school has locked down.)

---

## Get it

One thing goes on your computer: the **ClassDash app**. The first time you open it, it sets up its own **project folder** (does the actual work — reading your assignments, writing the summary page) for you — picking a browser, signing you in, all of it — no Terminal required.

### 1. Download and install

Go to the [Releases page](https://github.com/vemboy200/ClassDash/releases) and grab the build for your platform:

**macOS** — download the `.dmg`, open it, and drag **ClassDash** into your **Applications** folder, same as installing any other Mac app.

> [!WARNING]
> **macOS builds are not code-signed or notarized by Apple.** Gatekeeper will block the app by default and may say it's "damaged" or from an "unidentified developer" — that's expected, not a sign anything's actually wrong with it, it's just what happens without a paid Apple Developer account to sign builds with. To run it anyway: right-click (Control-click) the app → **Open** → **Open** again to confirm. If that doesn't work, go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** after your first blocked attempt. You only need to do this once; after that it opens normally.

**Windows** — download the `.exe` and run it. It's a real installer (not one-click) that asks where to install, same as any other Windows program — defaults to `Program Files`, needs admin rights to install there.

> [!WARNING]
> **Windows builds aren't code-signed either** (same reason as macOS — no paid certificate). SmartScreen will say "Windows protected your PC." Click **More info**, then **Run anyway**. Same one-time thing as Gatekeeper above, not a sign anything's actually wrong.

**Building either one yourself** is the other option, if you'd rather not run a downloaded binary or want to modify the code — see [CONTRIBUTING.md](CONTRIBUTING.md#building-from-source).

**On Linux**, or if you'd simply rather not install an app at all: the collector, the summary page, and the home API are plain Node and run fine without either native wrapper — open `summary.html` in any browser to view it. Be aware this is view-only, though: buttons like "hide" and saving settings from the page depend on a bridge only the real Mac or Windows app provides, so without one those clicks won't actually do anything. Setting up the project folder by hand this way still needs Terminal — see [Doing it by hand](#doing-it-by-hand) below.

### 2. Launch it — first run sets everything up

Open **ClassDash**. If it doesn't already know about a project folder, it asks: **set up a new one, or point it at an existing one** — pick the first option for an actual first run. From there it walks you through the rest itself:

- creates the project folder wherever you choose
- offers to install **Brave** (recommended — more privacy-focused, and this installs a separate, isolated copy just for ClassDash, never touching your everyday browser) or lets you use Chrome instead, or pick a different browser by hand
- opens Settings so you can fill in your school email and (if your school uses it) your Canvas address — everything else has a default and can stay as-is
- offers to sign you in — a real browser window opens and you log in by hand, the same as logging into any site. That session is saved and lasts for weeks; when it eventually expires, ClassDash tells you with a notification instead of silently showing stale data (macOS only for now — see [Troubleshooting](#troubleshooting))

Skipped a step, or want to redo one later — a different browser, signing in again? Both are still reachable any time afterward in **Settings → Account → Setup** (**Choose Browser…**, **Sign In…**), not just during that first run. **Settings → Advanced → Browser path** lets you pick any browser app directly, with a file picker instead of typing a path.

**On macOS specifically**, two permissions still need granting, both in **System Settings → Privacy & Security**:

- **App Management / Data Access** — needed to actually read Classroom and Canvas. macOS will prompt for this the first time it's needed.
- **Notifications** — go to **System Settings → Notifications → ClassDash → Allow Notifications** yourself. macOS does *not* prompt for this one on its own; without doing it manually, notifications will just silently never arrive.

Windows doesn't have an equivalent permission step — nothing extra to grant there.

### 3. Keep it running automatically

Right now, ClassDash checks on its own schedule only while it's open. To have it open itself after a restart, turn on **Open at login** in Settings → Checking (off unless you turn it on). On Windows it then starts minimized when you sign in; on a Mac it needs macOS 13 or later. Either way, opening the app also starts the home API again if it's switched on, so Home Assistant reconnects without waiting for a check.

**On macOS**, the alternative is `launchd` (the built-in scheduler) to run a check periodically even while the app's closed. There's no ready-made schedule file in this repo — it needs your own computer's absolute file paths baked in, so this part's covered in [CONTRIBUTING.md](CONTRIBUTING.md) rather than here.

**On Windows**, there's no scheduler for when the app is closed yet: Open at login plus leaving it open is the way for now.

Either way, opening the app and clicking the reload button (or holding it down for a full check) works fine on its own in the meantime.

### Doing it by hand

Prefer Terminal, want to modify the code, or you're on Linux where the app-based setup above isn't available at all? The manual path still works exactly like it always has:

**Requirements:** [Node.js](https://nodejs.org) 18 or newer.

```bash
git clone https://github.com/vemboy200/ClassDash.git
cd ClassDash
npm install
npm run setup-browser
cp settings.example.json settings.json    # then edit it
npm run login
```

(No `git`? Download the ZIP from the green "Code" button on [the GitHub page](https://github.com/vemboy200/ClassDash) instead, unzip it, and `cd` into that folder.)

`setup-browser` only works on macOS — checks whether Google Chrome is already installed (if so, nothing else happens, since Chrome already works safely for this), and only downloads its own isolated copy of Brave if Chrome's missing. On Windows or Linux, install Chrome yourself first, or fill in `browserPath` in `settings.json` by hand.

---

## Using it

### Everyday

- **Refresh** rereads what's already been collected. **Fresh check** checks everything again (about a minute, Edpuzzle included, in a browser window). While a check runs, Fresh check turns into a round **Stop** button.
- **Hide** an overdue assignment once it's handled; the button at the bottom of that section brings it back. **Not urgent** moves an assignment with no real due date out of "due soon" without hiding it.
- The **three dots** next to the gear are one per platform: blue worked, yellow worked the backup way (for Canvas, make a new token), red failed, gray isn't being checked. Click them for the details.
- The **gear** opens settings. Closing it saves. Most changes show at once; a few (like which classes to read) wait for the next check, and the page says so.
- **Announcements** show their attachments: photos as pictures you can click to see whole, and files, forms and links as chips that open them. Photos are saved during a check for each class's newest 10 announcements, and deleted once they're older than that.

### Keyboard shortcuts

Cmd on a Mac, Ctrl on Windows. They also live in the **View** menu, and each filter shows its own key beside it.

| Keys | Does |
|---|---|
| Cmd/Ctrl + R | Refresh |
| Shift + Cmd/Ctrl + R | Fresh check |
| Cmd/Ctrl + S | Show or hide the status of each source |
| 1 to 9, 0, -, = | Turn the 1st to 12th class in the class filter on or off (the numpad works too, with `-` and `+` as 11 and 12) |
| Shift + those keys | The same, for the 1st to 12th class in the announcements filter |
| A, C, M | Assignment, Completed and Material in the type filter |
| T, W, H, O, N | The due filter: today and tomorrow, this week, this month (H, since M is Material), overdue, no due date |

They don't do anything while you're typing or while Settings is open, and they follow the physical key, so they work on a Russian keyboard layout too.

### Assignments

- **Locked Canvas work** (not open yet, or waiting on earlier work in a module) waits under **Ahead** with a note saying when it opens, and never counts as due soon. **Closed** work (its "available until" date passed) shows under Overdue; hide it, or **delete** it for good.
- **Link assignments** when the same work shows up twice, like an Edpuzzle posted in Classroom too. Hover a card, click **Link**, then **Link here** on the other one: they become one card, done only when every part is. **Unlink** splits them. By default only assignments in the same class can be linked.
- **Reminders** are for what a teacher only said out loud. Add one in the **Reminders** section with an optional class and due date, and **edit**, mark **done** (it clears itself a week later), **hide**, or **delete** it.

### Classes and sources

- **Link classes** in Settings → **Classes** when one class shows up on two platforms, like its Classroom class and its Canvas course: name the link, tick its classes, and they show as one class everywhere. A link with one class just renames it.
- **Choosing your sources**: Settings → Account has a box for each thing ClassDash can read.
  - **Google Classroom** and **Edpuzzle** need a browser.
  - **Canvas — Google sign-in** reads Canvas through that browser, for schools whose Canvas opens with "Sign in with Google". Nothing extra to set up.
  - **Canvas — API** reads Canvas with an access token (Canvas → Account → Settings → **New Access Token**), with no browser or sign-in. Treat the token like a password; it expires, and then you make a new one. With both Canvas ways on, Google sign-in is the fallback for when the token fails.
- **Only use Canvas?** Pick **Only Canvas** and an access token in the first-run setup (or untick everything but Canvas — API), and ClassDash never opens a browser at all.

### How the sources compare

Canvas appears twice because the two ways ask Canvas for the same information but sign in differently.

| Source | Method | Official? | Pros | Cons |
|---|---|---|---|---|
| Google Classroom | Reads the Classroom pages in a browser signed in to your school Google account | No — Classroom has no API for students | Works whatever your school has locked down; sees exactly what you see, including what's turned in; nothing for your school to approve | Can break when Google changes the page; needs a browser and a sign-in (the session lasts weeks, then you sign in again); slower than an API because it reads every class page |
| Canvas — Google sign-in | Canvas's API, asked from a page in that same signed-in browser, using your session | The API is official; using your session instead of a token isn't the documented way | Nothing to set up beyond the Canvas address; no token to expire; works when your school won't let students make tokens | Needs a browser and a school Google account; only for schools whose Canvas opens with "Sign in with Google"; Canvas's sign-in redirects sometimes need a retry |
| Canvas — API (access token) | Canvas's API, asked directly with a token you create | Yes — the documented way | No browser and no sign-in, whatever your school's login is; fast and exact; lets ClassDash run without a browser at all | The token expires (Canvas says the longest is 90 days when you make one), then you make a new one; some schools don't let students create tokens; a token is like a password and is kept in `settings.json` on your computer |
| Edpuzzle | Edpuzzle's own site endpoints, asked from a real browser window | No — undocumented, found by watching the site's own traffic | The only way ClassDash has to see Edpuzzle | Refuses invisible browsers, so it needs a real window and only runs on full checks (twice a day, or Fresh check), not every 10 minutes; can break without notice |

### Calendar and schedule

- **School calendar**: Settings → **Calendar** → **Read PDF…** reads your school's calendar PDF (a grid per month with marked days) and lets you say what each mark means. You can also paste a **calendar feed** link (ICS or webcal) and pick what each kind of event means. The month shows at the top of the right-hand column; click a day to change it. Work with no due date then counts as due the next school day, not tomorrow. Scanned PDFs can't be read.
- **Class schedule**: Settings → **Schedule** takes the same classes every day, A/B days or odd/even days, and your classes with their periods. The page shows today's and the next school day's classes, each day's A/B (or O/E), and "class tomorrow" on cards. Add **flipped days** when the school announces one. You get a heads-up the day before a flipped day, and with odd/even before a school day that repeats the last one (the 31st then the 1st): a banner, plus a notification on a Mac.

### AI

Off unless you pick one in Settings → **AI**. It finds homework your teachers post as announcements instead of assignments: after each check, new announcements are read, and the homework in them is added to your **Reminders** with its due date, marked "from an announcement" with a link to the post. When the announcement gives no date, it's due at 11:59 PM the night before that class next meets, if the class is in Settings → **Schedule**. Work that's already an assignment or a reminder in that class is skipped: a similar title by plain logic, and the same work worded differently by asking the AI about each pair. Announcements from before you turned AI on are left alone; tick any of them under **Announcements** in Settings → AI and press **Scan selected** to read them now. Pick one on your own computer if you can (Apple Intelligence, Ollama or LM Studio), so your class text never leaves it; ClassDash finds them and fills them in. The cloud ones (ChatGPT through Codex, and the OpenAI, Anthropic and Gemini APIs) send that text to a company, and each has an age rule you confirm first. **Which one should I pick?** in that section explains the choices, the age rules, and why there's no Claude or Google plan option.

### Staying up to date

ClassDash checks for a new release once a day and shows a banner when there is one; **Check for Updates…** in the menu bar checks now and installs it for you. Updating also refreshes your project folder's scripts, never your settings or data.

## Home API

Turning on **Enable home API** in settings starts a small HTTPS server on your own computer — useful if you want the data somewhere else, like a Home Assistant dashboard, or want to hide an assignment or trigger a check from somewhere other than this window. The panel shows an **Allow LAN access** toggle (on by default — see below), an **access key** (masked, with Copy and Roll buttons — Roll generates a brand new one and immediately cuts off the old one, for if a key ever leaks), and a **certificate fingerprint**, the last two both needed to configure whatever's going to read from it.

The API itself is off by default — nothing starts until you turn it on. Once it's on, **LAN access is on by default too**, not localhost-only: the main reason to enable this at all is usually something like Home Assistant, running on a different device, and a server that only answers its own machine can't do that regardless of what address you point at it. The actual protection is the encryption and the access key, not which network interface it's listening on — turn off **Allow LAN access** if you'd rather it only ever answer this same computer.

Most of it is read-only — the same data this window shows. A few handles change something instead: hiding or un-hiding an assignment, marking one not urgent and back, changing a display setting, starting a check (a quick one or a full one), or stopping one that's running. Every one of those needs `POST` instead of a plain request, and does exactly what the matching button on this page does — nothing a client with the access key couldn't already do by hand from here. The full list of handles, and what to send each one, is in [CONTRIBUTING.md](CONTRIBUTING.md#home-api--technical-detail).

With **Allow LAN access** on, ClassDash also announces itself on your home network (mDNS, the same thing printers and AirPlay speakers use), as "ClassDash on" your computer's name. Home Assistant can find it that way without you typing an address, and follow it when your computer's address changes. You still check the fingerprint and paste the access key yourself. The announcement holds the port and the certificate fingerprint, never the access key. It reaches Home Assistant when Home Assistant is on the same network (Home Assistant OS, or Docker with host networking); otherwise, type the address as before. A VPN on the computer running ClassDash, like Cloudflare WARP, can keep the announcement from reaching the network while it's on.

---

## Troubleshooting

**macOS says the app is "damaged" or from an "unidentified developer."** Expected — see [Download and install](#1-download-and-install) above for the right-click → Open workaround.

**Windows says "Windows protected your PC."** Also expected, same underlying reason (no paid signing certificate) — click **More info** → **Run anyway**.

**Notifications never show up.** On macOS, this almost always means the manual System Settings grant hasn't been done — macOS doesn't prompt for it on its own. **On Windows, this is currently expected, not a bug to chase**: desktop notifications (new assignments, a "you got signed out, sign in again" alert) haven't been built for Windows yet — the app still works and collects normally, there's just nothing that pops up to tell you about it. Check the page itself, or the little status dots next to the gear icon, instead.

**A full check or a save is stuck / did nothing (macOS).** The first one after install may be waiting on the App Management permission prompt — check System Settings → Privacy & Security.

**On Windows, the home API shows as enabled but doesn't seem to be running** — most likely after reinstalling the app or letting it self-update. Reopening ClassDash starts it again. If it still isn't running, toggle **Enable home API** off, Save, back on, Save again — that forces a fresh restart of the server process.

**Something in the code itself is misbehaving**, or you want to understand *why* something works the way it does — that detail lives in [CONTRIBUTING.md](CONTRIBUTING.md), not here.

---

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).

    ClassDash — collects school assignments into one page Copyright (C) 2026 Artem

    This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

    This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for more details.

In plain terms: use it, change it, share it. If you distribute a modified version, that version has to stay open too.
