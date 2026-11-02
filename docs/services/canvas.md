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

## Known limitations

- A token expires (Canvas says the longest is 90 days when you make one); then you make a new one.
- Google sign-in only works for schools whose Canvas opens with "Sign in with Google", and Canvas's sign-in redirects sometimes need a retry.
- Unpublished courses don't show, because Canvas hides them.

## Troubleshooting

- **The status cloud is yellow and says Canvas only got through the backup way:** the token failed and Google sign-in filled in. Make a new token and paste it in.
- **Canvas is skipped:** check that the **Canvas address** is filled in.

## Turning it off

**Turn off** on its page in Settings → Services. ClassDash stops reading Canvas and keeps what you typed, the token included, in case you turn it back on.

## Details

| | |
|---|---|
| **Categories** | Assignments, Instructions, Grades |
| **Introduced** | v1.0.0 |
| **Communication class** | [Cloud Polling](../services.md#communication-classes) |
| **Code owners** | [@vemboy200](https://github.com/vemboy200) |
| **Browser class** | [Optional browser](../services.md#browser-classes) |
