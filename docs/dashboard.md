# Using the dashboard

The main page: everything due, announcements, reminders and the status of each source. Where the assignments come from is in [Sources](sources.md).

## Everyday

- The **sidebar** down the left goes between ClassDash's pages: **Dashboard** (this page), **Workspace** (in the app), the **Grades center** (once there are grades) and **Settings** at the bottom. The page you're on is lit. **☰** beside ClassDash's name folds it down to its icons and back, and it stays that way. In a narrow window it's a bar across the top instead.
- **Refresh** and **Fresh check** are at the bottom of the sidebar, under Settings. **Refresh** rereads what's already been collected. **Fresh check** checks everything again (about a minute, Edpuzzle included, in a browser window). While a check runs, Fresh check turns into a round **Stop** button.
- **Hide** an overdue assignment once it's handled; the button at the bottom of that section brings it back. **Not urgent** moves an assignment with no real due date out of "due soon" without hiding it.
- The **cloud** under Fresh check is how the last check went, for every service at once (services that are off don't count): blue with a ✓ when all of them worked, yellow with a ! when some failed but at least half worked (or none failed but one only got through the backup way; for Canvas, make a new token), red with an ✕ when fewer than half worked, and a plain gray one before anything has been checked. Beside it, it says how many failed. Click it to see each service that's on and has been checked. Under it is when the page was last updated.
- **Settings** in the sidebar opens the settings as a page of their own: a menu, like Home Assistant's, with a row for each part (Services, AI, Classes, Schedule, Calendar, Grades, Checking, Display, Home API, System). A row opens that part, and **←** or Esc goes back to the menu. Leaving Settings (going to any other page in the sidebar) saves; there's no Save or Done button. Most changes show at once; a few (like which classes to read) wait for the next check, and the page says so.
- **Announcements** show their attachments: photos as pictures you can click to see whole, and files, forms and links as chips that open them. Photos are saved during a check for each class's newest announcements, 10 by default: Settings → Display → **Photos on announcements** sets how many, from 0 (off) to 100.

## Keyboard shortcuts

Cmd on a Mac, Ctrl on Windows. They also live in the **View** menu, and each filter shows its own key beside it.

| Keys | Does |
|---|---|
| Cmd/Ctrl + R | Refresh |
| Shift + Cmd/Ctrl + R | Fresh check |
| Cmd/Ctrl + S | Show or hide the status of each source |
| 1 to 9, 0, -, = | Turn the 1st to 12th class in the class filter on or off (the numpad works too, with `-` and `+` as 11 and 12) |
| Shift + those keys | The same, for the 1st to 12th class in the announcements filter |
| A, C, M | Assignment, Completed and Material in the type filter |
| T, W, H, O, N | The due filter: today and tomorrow, this week, this month (H, since M is Material), overdue, no due date |

They don't do anything while you're typing or while Settings is open, and they follow the physical key, so they work on a Russian keyboard layout too.

## Assignments

- **Instructions**: a card with the teacher's instructions has an **Instructions** drop-down under it, so you can read them without opening Canvas or Classroom. Web addresses in them can be clicked. Canvas's come with every check; Classroom's are read by opening each assignment in place in the class's Classwork list, kept between checks, and read again every couple of days in case the teacher changed them. A class's first check after this reads a dozen at a time, so a long Classwork list fills in over a few checks. The AI reads the same instructions.
- **Locked Canvas work** (not open yet, or waiting on earlier work in a module) waits under **Ahead** with a note saying when it opens, and never counts as due soon. **Closed** work (its "available until" date passed) shows under Overdue; hide it, or **delete** it for good.
- **Link assignments** when the same work shows up twice, like an Edpuzzle posted in Classroom too. Hover a card, click **Link**, then **Link here** on the other one: they become one card, done only when every part is. **Unlink** splits them. By default only assignments in the same class can be linked.
- **Reminders** are for what a teacher only said out loud. Add one in the **Reminders** section with an optional class and due date, and **edit**, mark **done** (it clears itself a week later), **hide**, or **delete** it. Pick a class that's in Settings → **Schedule** and the due date fills itself in as 11:59 PM the night before that class next meets (the same rule the AI scan uses); change it or clear it if that's not right.
