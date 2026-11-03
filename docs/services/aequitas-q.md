# Aequitas Q

ClassDash reads your grades from Aequitas Q (StudentConnection), your school's grade system, so the Grades list shows the grades your school really keeps. Q has no API for students, so ClassDash signs in to its student portal in an invisible browser, reads your grades and signs out again.

## Before you start

- The *whole* address of your Q login page, including everything after the school's name, like `https://q.yourschool.org/Production/StudentPortal`. Just `q.yourschool.org` isn't enough, and it's different for every district.
- Your Q username and password.

## Setting it up

1. Settings → **Services** → **+ Add service** → **Aequitas Q**.
2. Paste the whole login address, then your username and password.

## Options

On its page in Settings → Services: the login address, your username and your password.

- **On a Mac** the password is kept in your Keychain, never in ClassDash's settings.
- **On Windows** it's in a file of its own that only your user account can read.

## What it reads

- **Your grade in each class.** Where a class has grades from more than one service, Q's wins, since that's where your school keeps them (see [Grades](../grades.md)).
- **Assignments**, with their scores.
- **Progress reports**: for classes with one (the printer button beside the grade on Q's site), ClassDash reads that PDF at each Q check. That gives every assignment of the term instead of Q's last two weeks, with each one's category, teacher comments and dropped work.
- **Category weights**: Q never shows how much each category counts, so the Grades center has a **Category weights** box for each Q class. Type them in from the syllabus and ClassDash works out your grade from them, and tells you whether that lands exactly on Q's grade (if it does, they're the teacher's weights). You can also paste the syllabus into the Grades center's AI chat: it fills in the categories you haven't given a weight yet, using only numbers from what you pasted, and never changes one you've already entered.

## How often it checks

At most once an hour. Q signs you out after a while, so ClassDash signs in fresh each time and signs out again.

## How it's read

ClassDash signs in to your school's Q StudentConnection portal in a headless browser, reads your classes' grades and assignments, and signs out. That isn't an official way: Q has no API for students. It gets your real grades, from where your school keeps them.

## Known limitations

- It reads Q's pages, so it can break when Q changes them.
- Every district has its own address.

## Troubleshooting

- **Q turned the password down:** ClassDash stops trying until you change it, so the account doesn't get locked. Fix the password on its page in Settings → Services.
- **Q asks for a new password** (an expired one): ClassDash signs out, stops the same way, and shows you what Q said with an **Open Q** button. Set the new password on Q's site in your browser (ClassDash never changes it for you), then save it on Q's page in Settings → Services, and ClassDash checks again right away.
- **Q was slow** ("timed out while signing in"): ClassDash already waits longer and tries once more. If it keeps happening, Q itself is slow; the next check tries again.

## Turning it off

**Turn off** on its page in Settings → Services. ClassDash stops signing in to Q and keeps what you typed, in case you turn it back on.

## Code

For contributors; how ClassDash works inside is in [CONTRIBUTING.md](../../CONTRIBUTING.md).

- [`40-grades.js`](../../src/40-grades.js) signs in to the Q portal in a headless browser of its own, with an empty profile, never the shared one, reads the grades and signs out. No API: Q has none for students.
- [`42-progress-report.js`](../../src/42-progress-report.js) reads the progress-report PDF behind the printer button: every assignment of the term, each one's category, and the grading scale. Category weights aren't in it; they come from the person ([`41-grades-center.js`](../../src/41-grades-center.js)).

## Details

| | |
|---|---|
| **Categories** | Grades, Progress reports |
| **Introduced** | v2.5.0 |
| **Communication class** | [Cloud Polling](../services.md#communication-classes) |
| **Code owners** | [@vemboy200](https://github.com/vemboy200) |
| **Browser class** | [Background browser](../services.md#browser-classes) |
