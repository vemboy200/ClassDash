# Sources

Where ClassDash reads your schoolwork from, how to choose, and how each one works.

## Classes and sources

- **Link classes** in Settings → **Classes** when one class shows up on two platforms, like its Classroom class and its Canvas course: name the link, tick its classes, and they show as one class everywhere. A link with one class just renames it. Your Q classes are in the list too, marked Q (see [Grades](grades.md)), and classes the page hides aren't. If a teacher renames a Classroom class, ClassDash follows it, so it doesn't turn into a second class.
- **Choosing your sources**: Settings → Account has a box for each thing ClassDash can read.
  - **Google Classroom** and **Edpuzzle** need a browser.
  - **Canvas — Google sign-in** reads Canvas through that browser, for schools whose Canvas opens with "Sign in with Google". Nothing extra to set up.
  - **Canvas — API** reads Canvas with an access token (Canvas → Account → Settings → **New Access Token**), with no browser or sign-in. Treat the token like a password; it expires, and then you make a new one. With both Canvas ways on, Google sign-in is the fallback for when the token fails.
- **Only use Canvas?** Pick **Only Canvas** and an access token in the first-run setup (or untick everything but Canvas — API), and ClassDash never opens a browser at all.

## How the sources compare

Canvas appears twice because the two ways ask Canvas for the same information but sign in differently.

| Source | Method | Official? | Pros | Cons |
|---|---|---|---|---|
| Google Classroom | Reads the Classroom pages in a browser signed in to your school Google account | No — Classroom has no API for students | Works whatever your school has locked down; sees exactly what you see, including what's turned in; nothing for your school to approve | Can break when Google changes the page; needs a browser and a sign-in (the session lasts weeks, then you sign in again); slower than an API because it reads every class page |
| Canvas — Google sign-in | Canvas's API, asked from a page in that same signed-in browser, using your session | The API is official; using your session instead of a token isn't the documented way | Nothing to set up beyond the Canvas address; no token to expire; works when your school won't let students make tokens | Needs a browser and a school Google account; only for schools whose Canvas opens with "Sign in with Google"; Canvas's sign-in redirects sometimes need a retry |
| Canvas — API (access token) | Canvas's API, asked directly with a token you create | Yes — the documented way | No browser and no sign-in, whatever your school's login is; fast and exact; lets ClassDash run without a browser at all | The token expires (Canvas says the longest is 90 days when you make one), then you make a new one; some schools don't let students create tokens; a token is like a password and is kept in `settings.json` on your computer |
| Aequitas Q (grades) | Signs in to your school's Q StudentConnection portal in an invisible browser, reads your classes' grades and assignments, and signs out | No — Q has no API for students | Your real grades, from where your school keeps them; also reads Q's progress-report PDFs for every assignment of the term | Needs your Q password (kept in the Mac Keychain, or a file only you can read on Windows); every district has its own address; at most once an hour, and it stops trying after a wrong password so the account doesn't get locked; can break when Q changes its pages |
| Edpuzzle | Edpuzzle's own site endpoints, asked from a real browser window | No — undocumented, found by watching the site's own traffic | The only way ClassDash has to see Edpuzzle | Refuses invisible browsers, so it needs a real window and only runs on full checks (twice a day, or Fresh check), not every 10 minutes; can break without notice |

## Why it reads pages instead of an API

Canvas has an official API, but Google Classroom doesn't offer one to students, so that part reads the actual page and can break if Google changes it, Edpuzzle only has internal endpoints that aren't documented, and Aequitas Q has no API for students either, so grades are read from its student portal the way you'd see them. (Classroom assignments do technically also show up through the Google Calendar API — but that requires your school's Google Workspace admin to have that API turned on for student accounts, which most schools don't. Reading the page directly is the one approach that keeps working no matter what a given school has locked down.)

Every request goes through your own logged-in browser session (or, for Canvas, your own access token) and returns exactly what your own account can already see.
