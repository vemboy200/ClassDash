# Google Classroom

ClassDash reads Google Classroom the way you see it: it opens each class's pages in a browser signed in to your school Google account. Classroom has no API for students, so this is the one way that works whatever your school has locked down.

## Before you start

- A school Google account that has your classes in Classroom.
- A browser for ClassDash. The first-run setup offers to install its own copy of Brave, or you can use Chrome (see [Getting started](../getting-started.md)).

## Setting it up

1. Settings → **Services** → **+ Add service** → **Google Classroom** (it's on by default).
2. Fill in your **School email**.
3. Sign in: **Settings → Services → Setup → Sign In…** opens a real browser window, and you sign in by hand, the same as on any site. That sign-in is saved and lasts for weeks.

## Options

On its page in Settings → Services:

- **School email**: used in assignment links, so they open under your school account. Without it, Google opens a class under your personal account and says "Class not found".
- **Google account number**: if the browser has more than one Google account signed in, which one to use. Usually 0.

Which classes get read is in Settings → **Classes**.

## What it reads

- **Assignments and materials** from each class's Classwork list, with their due dates and whether you've turned them in.
- **Instructions**: read by opening each assignment in place, kept between checks, and read again every couple of days in case the teacher changed them. A class's first check reads a dozen at a time, so a long Classwork list fills in over a few checks. They show under each card's **Instructions** drop-down (see [Using the dashboard](../dashboard.md#assignments)).
- **Announcements**, with their attachments: photos, files, forms and links. Photos are saved for each class's newest announcements (10 by default; Settings → Display → **Photos on announcements**).
- **Grades**: once an hour per class, ClassDash reads that class's "View your work" page and adds up the points you've been graded on. A class with nothing graded yet isn't listed. See [Grades](../grades.md).

## How often it checks

Every 10 minutes, in the background, plus every Fresh check. Grades are read at most once an hour per class.

## How it's read

ClassDash reads the Classroom pages in a browser signed in to your school Google account. That isn't an official way: Classroom has no API for students.

- It works whatever your school has locked down, with nothing for your school to approve.
- It sees exactly what you see, including what you've turned in.

## Known limitations

- It reads the page, so it can break when Google changes Classroom's pages.
- It's slower than an API, since it opens every class page.
- The sign-in lasts weeks, then you sign in again.

## Troubleshooting

- **Signed out:** on a Mac, ClassDash tells you with a notification. Sign in again with **Settings → Services → Setup → Sign In…**.
- **Links say "Class not found":** fill in your **School email**, and check the **Google account number** if the browser has more than one Google account.
- **The status cloud shows Classroom failed:** click the cloud at the bottom of the sidebar to see what went wrong.

## Turning it off

**Turn off** on its page in Settings → Services. ClassDash stops reading Classroom and keeps what you typed, in case you turn it back on.

## Code

For contributors; how ClassDash works inside is in [CONTRIBUTING.md](../../CONTRIBUTING.md).

- [`05-playwright-draft.js`](../../src/05-playwright-draft.js) reads each class's to-do list (`/w/<id>/t/all`) off the rendered page, plus announcements and, by opening each assignment in place, its instructions. No API at all: Classroom doesn't offer one to students, so this is the one source that can break when Google changes the page.
- [`44-classroom-grades.js`](../../src/44-classroom-grades.js) reads each class's "View your work" page for grades, matched by the page's structure, not by Google's generated class names.
- [`39-announcement-photos.js`](../../src/39-announcement-photos.js) saves announcement photos.
- **Materials** (`type: 'Material'`) come off the same stream as assignments, in the same shared item shape.

## Details

| | |
|---|---|
| **Categories** | Assignments, Instructions, Announcements, Grades |
| **Introduced** | v1.0.0 |
| **Communication class** | [Cloud Polling](../services.md#communication-classes) |
| **Code owners** | [@vemboy200](https://github.com/vemboy200) |
| **Browser class** | [Background browser](../services.md#browser-classes) |
