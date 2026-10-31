<img width="1920" alt="classdashlogo" src="https://github.com/user-attachments/assets/c8efe024-41ef-43de-9389-30289d888905" />

**The all-in-one app for school.**

Every class, every assignment, every grade, in one app. It's kinda like [Bun](https://bun.sh), but for students instead of JS devs. ClassDash checks Google Classroom, Canvas, Edpuzzle and your school's grade system (Aequitas Q) for you and puts it all on one page, then adds the tools around it: reminders, a calendar and class schedule, a workspace for PDFs and web pages, and an AI study helper you bring yourself. It works with the platforms your school already uses, with nothing for your school to set up or approve.

Written by Claude under the supervision of someone who knows nothing about coding, for his own homework, then cleaned up enough to share.

> **No warranty.** This is a personal project shared as-is. It may break, miss an assignment, or stop working when one of the sites changes something. Do not rely on it as your only way of tracking deadlines.

---

## Why

Four different sites, each with its own idea of what "your assignments" means. Classroom shows a *"nothing due in the next 7 days"* widget while a summer assignment quietly sits 14 days out. Canvas hides unpublished courses. Edpuzzle has its own list. Checking all four every day is a chore, and the day you skip it is the day something was due. Then your actual grades live somewhere else again, in the school's grade system, your worksheets are PDFs in a downloads folder, and the AI you ask for help knows none of it. ClassDash brings all of that into one app.

## What's in the box

| | |
|---|---|
| **Dashboard** | Everything due from Classroom, Canvas and Edpuzzle on one page, checked by itself every 10 minutes during the school day. The teacher's instructions under each assignment, announcements with their attachments, and reminders for what was only said out loud. A notification only when something changes. [Using the dashboard](docs/dashboard.md) · [Sources](docs/sources.md) |
| **Grades** | Your grade in each class from Aequitas Q, Canvas and Classroom, its history, alerts when it changes, and a Grades center with every assignment's score and an estimate from the category weights. [Grades](docs/grades.md) |
| **Calendar and schedule** | Your school's calendar (from its PDF or a calendar feed), your class schedule with A/B or odd/even days and flipped days, and "class tomorrow" on the work that's due. [Calendar and schedule](docs/calendar.md) |
| **Workspace** | Write on worksheets and export them ready to hand in, with Google Docs, Desmos or another PDF beside them, up to five panes. [Workspace](docs/workspace.md) |
| **AI helper** | Bring your own: a model on your computer or one you already pay for. It knows your assignments, instructions and PDFs, helps you get there yourself (Hints only) instead of doing the work, and finds homework hidden in announcements. Off until you set one up. [AI](docs/ai.md) · [Using AI with ClassDash](docs/ai-use.md) |
| **Home API** | Your schoolwork on a Home Assistant dashboard, or anything else on your home network. [Home API](docs/home-api.md) |

## How it works

- **Free to run.** Collecting your assignments is an ordinary program: no tokens, no API keys, no cost per run. AI is an optional extra and can run entirely on your own computer.
- **Your account, your computer.** Every request goes through your own logged-in browser session (or, for Canvas, your own access token) and sees exactly what your account can already see. Everything ClassDash keeps stays on your computer.
- **Read-only.** It never submits, answers, or changes anything on your behalf, and the AI can't either.
- **Not an answer machine.** It can fetch a transcript of an Edpuzzle video so you can read what was said, but it will not pull the embedded questions or their answers, and the AI is built to help you learn, not to do the work for you. That's a deliberate line, not a missing feature.

## Get it

Download the latest build from the [Releases page](https://github.com/vemboy200/ClassDash/releases): the `.dmg` for macOS, the `.exe` for Windows. Open it, and the first run walks you through the rest: a browser, your school email, signing in.

The builds aren't code-signed (that needs a paid certificate), so macOS and Windows warn you the first time: on a Mac, right-click the app → **Open**; on Windows, **More info** → **Run anyway**. [Getting started](docs/getting-started.md) has every step, the macOS permissions, keeping it running, and setting it up by hand on Linux.

## Docs

- [Getting started](docs/getting-started.md): installing, the first run, keeping it running, updates
- [Using the dashboard](docs/dashboard.md): the page, keyboard shortcuts, assignments, reminders
- [Sources](docs/sources.md): Classroom, Canvas, Edpuzzle and Q, and how each one is read
- [Calendar and schedule](docs/calendar.md)
- [Grades](docs/grades.md)
- [Workspace](docs/workspace.md): PDFs, web pages and the AI pane
- [AI](docs/ai.md): setting one up, picking a model, announcements, other AI apps
- [Using AI with ClassDash](docs/ai-use.md): what the AI will and won't do, and advice about AI and school
- [Home API](docs/home-api.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Changelog](CHANGELOG.md): what's new, including what's built but not released yet
- [CONTRIBUTING.md](CONTRIBUTING.md): how it works inside, building from source

---

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).

    ClassDash — the all-in-one app for school Copyright (C) 2026 Artem

    This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

    This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for more details.

In plain terms: use it, change it, share it. If you distribute a modified version, that version has to stay open too.
