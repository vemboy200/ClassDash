# Canvas

ClassDash reads Canvas through Canvas's official API, in one of two ways: with an access token you make, or through your school Google sign-in in ClassDash's browser.

## Before you start

- Your school's Canvas address, like `https://yourschool.instructure.com`.
- One of these:
  - **An access token** (Canvas → Account → Settings → **New Access Token**). Some schools don't let students make one.
  - **Google sign-in**, if your school's Canvas opens with "Sign in with Google". This uses ClassDash's browser, signed in the same way as for [Google Classroom](google-classroom.md).

## Setting it up

1. Settings → **Services** → **+ Add service** → **Canvas**.
2. Fill in the **Canvas address**.
3. For the API, paste the whole **Canvas access token**: Canvas only shows it once.

**Only use Canvas?** Pick **Only Canvas** and an access token in the first-run setup (or turn off everything but Canvas, and Canvas's Google sign-in), and ClassDash never opens a browser at all.

## Options

On its page in Settings → Services:

- **Canvas address**: needed for either way. Left empty, Canvas is skipped.
- **Canvas — Google sign-in**: reads Canvas through the browser, signed in with your school Google account. With the API on and filled in, this is only the fallback, used when the API can't be read (an expired token, say).
- **Canvas — API (access token)**: reads Canvas with the token, with no browser or sign-in.
- **Canvas access token**: shown masked. Treat it like a password: it acts as you in Canvas. It's kept in `settings.json` on your computer and never logged.

## What it reads

- **Assignments**, with their due dates.
- **Instructions**, with every check, under each card's **Instructions** drop-down.
- **Locked work** (not open yet, or waiting on earlier work in a module) waits under **Ahead** with a note saying when it opens, and never counts as due soon. **Closed** work (its "available until" date passed) shows under Overdue.
- **Grades**: each course's current score and letter grade, plus the teacher's categories (Tests, Homework…) with their weights and ClassDash's own estimate from them. Where a teacher hides the overall percent, the Grades list shows that estimate with a ~. See [Grades](../grades.md).

## How often it checks

Every 10 minutes, plus every Fresh check.

## How it's read

Both ways ask Canvas's official API for the same information, but sign in differently.

- **API (access token)**: asked directly with a token you made, which is the documented way. No browser and no sign-in, whatever your school's login is; fast and exact; and it lets ClassDash run without a browser at all.
- **Google sign-in**: asked from a page in ClassDash's signed-in browser, using your session instead of a token. The API is official, but using a session this way isn't the documented way. Nothing to set up beyond the Canvas address, no token to expire, and it works when your school won't let students make tokens.

## Known limitations

- A token expires (Canvas says the longest is 90 days when you make one); then you make a new one.
- Google sign-in only works for schools whose Canvas opens with "Sign in with Google", and Canvas's sign-in redirects sometimes need a retry.
- Unpublished courses don't show, because Canvas hides them.

## Troubleshooting

- **The status cloud is yellow and says Canvas only got through the backup way:** the token failed and Google sign-in filled in. Make a new token and paste it in.
- **Canvas is skipped:** check that the **Canvas address** is filled in.

## Turning it off

**Turn off** on its page in Settings → Services. ClassDash stops reading Canvas and keeps what you typed, the token included, in case you turn it back on.

## Code

For contributors; how ClassDash works inside is in [CONTRIBUTING.md](../../CONTRIBUTING.md).

[`10-canvas.js`](../../src/10-canvas.js) uses Canvas's own REST API (documented at `canvas.instructure.com/doc/api/`). `readCanvas()` is shared by both ways and only the request differs:

- **Google sign-in**: `askViaPage` calls it from inside the already-open, signed-in browser page, so the request rides its session cookies. Works fine headless. The API is official, but this isn't the documented way to authenticate: no OAuth app registration and no access token.
- **API (access token)**: `askWithToken` sends the same paths from Node with `Authorization: Bearer`, with no browser and no sign-in. The documented way. Tokens expire and some schools don't let students create them, which is why the sign-in way stays as the fallback.
- **Materials** come from Canvas's Pages endpoint (`/api/v1/courses/:id/pages`), in the same shared item shape as Classroom's. Canvas Files aren't collected: every upload, the syllabus PDF included, is too broad and noisy to map onto "new material worth mentioning" the way a Page is.

## Details

| | |
|---|---|
| **Categories** | Assignments, Instructions, Grades |
| **Introduced** | v1.0.0 |
| **Communication class** | [Cloud Polling](../services.md#communication-classes) |
| **Code owners** | [@vemboy200](https://github.com/vemboy200) |
| **Browser class** | [Optional browser](../services.md#browser-classes) |
