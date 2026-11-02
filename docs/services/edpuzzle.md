# Edpuzzle

ClassDash reads your Edpuzzle assignments through Edpuzzle's own site, from a real browser window. Edpuzzle has no public API, and it refuses invisible browsers, so this one opens a window you can see.

## Before you start

- Your Edpuzzle account, signed in in ClassDash's browser: **Settings → Services → Setup → Sign In…** opens an Edpuzzle tab of its own. Edpuzzle keeps its own sign-in, so signing in to your school Google account doesn't sign you in to Edpuzzle, even if you use Edpuzzle's "Log in with Google" button there.

## Setting it up

Settings → **Services** → **+ Add service** → **Edpuzzle** (it's on by default). There's nothing to fill in.

## Options

None. If your teachers already post every Edpuzzle assignment in Google Classroom too, you can turn Edpuzzle off: Classroom already shows them, and no browser window has to open.

## What it reads

**Edpuzzle assignments**, with their due dates. When the same Edpuzzle shows up in Classroom too, you can **Link** the two cards into one (see [Using the dashboard](../dashboard.md#assignments)).

## How often it checks

Only on full checks, since each one opens a browser window: twice a day (at 8 AM and 6 PM by default), and whenever you click **Fresh check**. The regular every-10-minutes check skips it.

## Known limitations

- A browser window opens during a full check.
- It uses endpoints Edpuzzle doesn't document, found by watching the site's own traffic, so it can break without notice.
- No video transcripts yet. The dashboard's **Edpuzzle transcripts** card is a placeholder for them. ClassDash will never pull the embedded questions or their answers, on purpose: that's a deliberate line, not a missing feature.

## Troubleshooting

- **Edpuzzle didn't update:** it's only read on full checks. Click **Fresh check** at the bottom of the sidebar.
- **The status cloud shows Edpuzzle failed:** click the cloud to see what went wrong. If you were signed out, sign in again with **Settings → Services → Setup → Sign In…**, in its Edpuzzle tab.

## Turning it off

**Turn off** on its page in Settings → Services. That stops it on every check, Fresh check included, so a full check never needs a browser window.

## Details

| | |
|---|---|
| **Categories** | Assignments |
| **Introduced** | v1.0.0 |
| **Communication class** | [Cloud Polling](../services.md#communication-classes) |
| **Code owners** | None yet |
| **Browser class** | [Visible browser](../services.md#browser-classes) |
