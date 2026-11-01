# Getting started

One thing goes on your computer: the **ClassDash app**. The first time you open it, it sets up its own **project folder** (does the actual work — reading your assignments, writing the summary page) for you — picking a browser, signing you in, all of it — no Terminal required.

## 1. Download and install

Go to the [Releases page](https://github.com/vemboy200/ClassDash/releases) and grab the build for your platform:

**macOS** — download the `.dmg`, open it, and drag **ClassDash** into your **Applications** folder, same as installing any other Mac app.

> [!WARNING]
> **macOS builds are not code-signed or notarized by Apple.** Gatekeeper will block the app by default and may say it's "damaged" or from an "unidentified developer" — that's expected, not a sign anything's actually wrong with it, it's just what happens without a paid Apple Developer account to sign builds with. To run it anyway: right-click (Control-click) the app → **Open** → **Open** again to confirm. If that doesn't work, go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** after your first blocked attempt. You only need to do this once; after that it opens normally.

**Windows** — download the `.exe` and run it. It's a real installer (not one-click). It asks whether to install **only for you** (the default, no admin rights needed, goes in your own `AppData\Local\Programs`) or **for all users** (goes in `Program Files` and asks for admin rights), then where to install. The last page has a **Delete this installer** checkbox, on by default, that removes the downloaded `.exe` once the installer closes.

> [!WARNING]
> **Windows builds aren't code-signed either** (same reason as macOS — no paid certificate). SmartScreen will say "Windows protected your PC." Click **More info**, then **Run anyway**. Same one-time thing as Gatekeeper above, not a sign anything's actually wrong.

**Building either one yourself** is the other option, if you'd rather not run a downloaded binary or want to modify the code — see [CONTRIBUTING.md](../CONTRIBUTING.md#building-from-source).

**On Linux**, or if you'd simply rather not install an app at all: the collector, the summary page, and the home API are plain Node and run fine without either native wrapper — open `summary.html` in any browser to view it. Be aware this is view-only, though: buttons like "hide" and saving settings from the page depend on a bridge only the real Mac or Windows app provides, so without one those clicks won't actually do anything. Setting up the project folder by hand this way still needs Terminal — see [Doing it by hand](#doing-it-by-hand) below.

## 2. Launch it — first run sets everything up

Open **ClassDash**. If it doesn't already know about a project folder, it asks: **set up a new one, or point it at an existing one** — pick the first option for an actual first run. From there it walks you through the rest itself:

- creates the project folder wherever you choose
- offers to install **Brave** (recommended — more privacy-focused, and this installs a separate, isolated copy just for ClassDash, never touching your everyday browser) or lets you use Chrome instead, or pick a different browser by hand
- opens Settings so you can fill in your school email and (if your school uses it) your Canvas address — everything else has a default and can stay as-is
- offers to sign you in — a real browser window opens and you log in by hand, the same as logging into any site. That session is saved and lasts for weeks; when it eventually expires, ClassDash tells you with a notification instead of silently showing stale data (macOS only for now — see [Troubleshooting](troubleshooting.md))

Skipped a step, or want to redo one later — a different browser, signing in again? Both are still reachable any time afterward in **Settings → Services → Setup** (**Choose Browser…**, **Sign In…**), not just during that first run. **Settings → System → Browser path** lets you pick any browser app directly, with a file picker instead of typing a path.

**On macOS specifically**, two permissions still need granting, both in **System Settings → Privacy & Security**:

- **App Management / Data Access** — needed to actually read Classroom and Canvas. macOS will prompt for this the first time it's needed.
- **Notifications** — go to **System Settings → Notifications → ClassDash → Allow Notifications** yourself. macOS does *not* prompt for this one on its own; without doing it manually, notifications will just silently never arrive.

Windows doesn't have an equivalent permission step — nothing extra to grant there.

## 3. Keep it running automatically

Right now, ClassDash checks on its own schedule only while it's open. To have it open itself after a restart, turn on **Open at login** in Settings → Checking (off unless you turn it on). On Windows it then starts minimized when you sign in; on a Mac it needs macOS 13 or later. Either way, opening the app also starts the home API again if it's switched on, so Home Assistant reconnects without waiting for a check.

**On macOS**, the alternative is `launchd` (the built-in scheduler) to run a check periodically even while the app's closed. There's no ready-made schedule file in this repo — it needs your own computer's absolute file paths baked in, so this part's covered in [CONTRIBUTING.md](../CONTRIBUTING.md) rather than here.

**On Windows**, there's no scheduler for when the app is closed yet: Open at login plus leaving it open is the way for now.

Either way, opening the app and clicking the reload button (or holding it down for a full check) works fine on its own in the meantime.

## Doing it by hand

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


## Staying up to date

ClassDash checks for a new release once a day and shows a banner when there is one; **Check for Updates…** in the menu bar checks now, shows a progress bar while the update downloads, and asks to install it as soon as it's done. Updating also refreshes your project folder's scripts, never your settings or data.

Next: [Using the dashboard](dashboard.md).
