# Services

Where ClassDash reads your schoolwork from. Like Home Assistant's integrations, each service has a card in Settings → **Services** and a page of its own here.

- [Google Classroom](services/google-classroom.md): assignments, instructions, announcements and grades
- [Canvas](services/canvas.md): assignments, instructions and grades
- [Edpuzzle](services/edpuzzle.md): assignments
- [Aequitas Q](services/aequitas-q.md): grades
- [Calendar feed](services/calendar-feed.md): your school's calendar

How each one is read, and what that's good and bad at, is on its page.

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

## Why it reads pages instead of an API

Where a service has an official API that students can use, like Canvas, ClassDash uses it. Many school services don't offer one to students, so ClassDash reads their pages the way you'd see them, in a browser signed in as you. That keeps working whatever a school has locked down, but it can break when the service changes its pages, which is why those services' pages say so under Known limitations. (Classroom assignments do technically also show up through the Google Calendar API, but only if your school's Google Workspace admin turned that API on for students, which most schools don't.)

Every request goes through your own signed-in browser session (or your own access token) and sees exactly what your own account can already see.
