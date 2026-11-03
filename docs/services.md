# Services

Where ClassDash reads your schoolwork from. Like Home Assistant's integrations, each service has a card in Settings → **Services** and a page of its own here.

| Service | What it reads | Browser class |
|---|---|---|
| [Google Classroom](services/google-classroom.md) | Assignments, instructions, announcements, grades | Background browser |
| [Canvas](services/canvas.md) | Assignments, instructions, grades and their categories | Optional browser |
| [Edpuzzle](services/edpuzzle.md) | Edpuzzle assignments | Visible browser |
| [Aequitas Q](services/aequitas-q.md) | Your grades, from your school's grade system | Background browser |
| [Calendar feed](services/calendar-feed.md) | Your school's calendar, from an ICS or webcal link | No browser |

## What the details on each page mean

Each service's page ends with a **Details** table, like a Home Assistant integration's:

- **Categories**: what ClassDash reads from it: Assignments, Instructions, Announcements, Grades, Progress reports or Calendar.
- **Introduced**: the ClassDash version it first came in.
- **Communication class**: how ClassDash talks to it (see below).
- **Code owners**: who looks after that service's code, on GitHub. Questions and bug reports about a service go to them. A service with none has no one assigned yet.
- **Browser class**: whether it needs ClassDash's browser (see below).

### Communication classes

Home Assistant calls these IoT classes. ClassDash isn't talking to devices, so here they're communication classes:

- **Cloud Polling**: the service is on the internet, and ClassDash asks it for what's new on a schedule. Every service is this one for now.
- **Cloud Push**: the service is on the internet and tells ClassDash itself when something changes, so there's nothing to wait for. None yet.
- **Cloud Mixed**: some of it comes by push and the rest by polling. None yet.

There are no local classes: every school service is on the internet, not on your own network.

### Browser classes

Some services can only be read through ClassDash's own browser, signed in as you. These match the browser badges on the cards in Settings → **Services**:

- **Background browser**: a *headless* browser: it runs in the background with no window, so nothing shows on screen.
- **Visible browser**: a *headed* browser, with a window you can see, because the service refuses headless ones. It only opens during full checks, and while it's open, the background-browser services that share it (Google Classroom, and Canvas's Google sign-in) are read in that same window.
- **Optional browser**: it depends on how you set it up. Canvas needs one for Google sign-in, but not with an access token.
- **No browser**: read directly, over the internet, with no browser at all.

## Adding and turning off services

- Settings → **Services** has a card for each service that's on: its name, how its last check went, and badges. The cloud with ↑ means ClassDash asks it on a schedule (polling). The browser badge says what it takes: a hidden browser in the background, a browser with a face for a visible browser window (Edpuzzle), or a browser with a ? when it depends on how it's set up (Canvas).
- Click a card for that service's settings. **+ Add service** turns one on, and **Turn off** on a service's page turns it off again. Turning one off keeps what you typed for it, in case you turn it back on.
- **Only use Canvas?** Pick **Only Canvas** and an access token in the first-run setup (or turn off everything but Canvas, and Canvas's Google sign-in), and ClassDash never opens a browser at all.

## Classes from more than one service

**Link classes** in Settings → **Classes** when one class shows up on two services, like its Classroom class and its Canvas course: name the link, tick its classes, and they show as one class everywhere. A link with one class just renames it. Your Q classes are in the list too, marked Q (see [Grades](grades.md)), and classes the page hides aren't. If a teacher renames a Classroom class, ClassDash follows it, so it doesn't turn into a second class.

## Not supported yet

Services that would fit ClassDash but aren't built yet, in case anyone wants to pick one up (see [CONTRIBUTING.md](../CONTRIBUTING.md)). Adding one needs someone with an account on it to test against, since ClassDash only reads what your own account can see. Whoever builds one becomes its code owner.

What's known about reading each one is a starting point, not checked against the real thing:

- **Assignments**
  - **Schoology**, **Blackboard** and **Moodle**: each has an official API, but whether a student can use it depends on the school (an access key, an app the school registers, or web services the school turns on). Reading the pages in the browser, the way Classroom is read, is the fallback.
  - **Microsoft Teams for Education**: assignments are in Microsoft Graph, which usually needs the school's admin to approve the app.
- **Grades**
  - **PowerSchool**, **Infinite Campus**, **Aeries** and **Skyward**: student portals with no API for students, like Aequitas Q, so they'd be read from the portal the same way. Each district has its own address.
- **Email**
  - **Gmail**: Google restricts apps that read Gmail, and school admins often block them. A narrow "emails from teachers" version, read through the signed-in browser, is the part worth trying.
- **Practice sites**
  - **Khan Academy**, **IXL** and **Quizlet**: assignments teachers give there. None has an API for students, so they'd be read from their pages.

## How the services compare

Canvas appears twice because the two ways ask Canvas for the same information but sign in differently.

| Service | Method | Official? | Pros | Cons |
|---|---|---|---|---|
| Google Classroom | Reads the Classroom pages in a browser signed in to your school Google account | No — Classroom has no API for students | Works whatever your school has locked down; sees exactly what you see, including what's turned in; nothing for your school to approve | Can break when Google changes the page; needs a browser and a sign-in (the session lasts weeks, then you sign in again); slower than an API because it reads every class page |
| Canvas — Google sign-in | Canvas's API, asked from a page in that same signed-in browser, using your session | The API is official; using your session instead of a token isn't the documented way | Nothing to set up beyond the Canvas address; no token to expire; works when your school won't let students make tokens | Needs a browser and a school Google account; only for schools whose Canvas opens with "Sign in with Google"; Canvas's sign-in redirects sometimes need a retry |
| Canvas — API (access token) | Canvas's API, asked directly with a token you create | Yes — the documented way | No browser and no sign-in, whatever your school's login is; fast and exact; lets ClassDash run without a browser at all | The token expires (Canvas says the longest is 90 days when you make one), then you make a new one; some schools don't let students create tokens; a token is like a password and is kept in `settings.json` on your computer |
| Aequitas Q (grades) | Signs in to your school's Q StudentConnection portal in an invisible browser, reads your classes' grades and assignments, and signs out | No — Q has no API for students | Your real grades, from where your school keeps them; also reads Q's progress-report PDFs for every assignment of the term | Needs your Q password (kept in the Mac Keychain, or a file only you can read on Windows); every district has its own address; at most once an hour, and it stops trying after a wrong password so the account doesn't get locked; can break when Q changes its pages |
| Edpuzzle | Edpuzzle's own site endpoints, asked from a real browser window | No — undocumented, found by watching the site's own traffic | The only way ClassDash has to see Edpuzzle | Refuses invisible browsers, so it needs a real window and only runs on full checks (twice a day, or Fresh check), not every 10 minutes; can break without notice |

## Why it reads pages instead of an API

Canvas has an official API, but Google Classroom doesn't offer one to students, so that part reads the actual page and can break if Google changes it, Edpuzzle only has internal endpoints that aren't documented, and Aequitas Q has no API for students either, so grades are read from its student portal the way you'd see them. (Classroom assignments do technically also show up through the Google Calendar API — but that requires your school's Google Workspace admin to have that API turned on for student accounts, which most schools don't. Reading the page directly is the one approach that keeps working no matter what a given school has locked down.)

Every request goes through your own logged-in browser session (or, for Canvas, your own access token) and returns exactly what your own account can already see.
