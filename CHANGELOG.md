# Changelog

What's changed in each version of ClassDash. **Unreleased** is what's built and on `main` but not in a release yet: it becomes the next version's release notes. Earlier versions are on the [Releases page](https://github.com/vemboy200/ClassDash/releases).

## Unreleased

- **The sidebar shows how many clients are connected**: other computers following this one, pages open in a browser, and programs like Home Assistant. Hover for the breakdown. It doesn't count the app's own window, and it's hidden when there are none.
- **Sync between two of your computers** (Settings → Sync). Pair them with a code and choose which is the master. It does the checking, and the other copies everything it finds within a moment, keeps its own copy for when they can't reach each other, and shows how it's connected in the sidebar. What you do on the follower (hiding, reminders, starting a check) happens on the master; while cut off it happens locally and goes across on reconnecting. Each computer keeps its own sign-ins and keys, its data is set aside rather than deleted, and it can use a second address for away from home, such as a Cloudflare tunnel. Each computer announces its role on the network, so the list of nearby computers shows which are masters and which can't be followed. The workspace's PDFs aren't synced yet.
- **Wrong sign-ins from other devices are limited** to 10 a minute per address, so a server reachable from the internet can't have a waiting pairing code used up by strangers.
- **Pages reached through a tunnel on the same computer** now get the same compressed, cacheable files as other devices.
- **The sidebar's Quick check and status text are crisp in light mode.** They had a button's shadow falling directly on the words, which made them look doubled.
- **New assignments and changes appear without the page reloading**, in the app and in a browser: the page gets its cards from the server as data, and after that only what changed. What you have open or half typed stays as it is, and a check uses far less data on a phone or another device: a changed assignment is a couple of KB, not the whole page. On a slow connection, the shape of the cards shows until they arrive.
- **Each page has its own address in a browser**, like Home Assistant: `/dashboard`, `/grades`, `/settings/api` and so on. You can bookmark one, Back and Forward work, a reload stays on the page you're on, and signing in takes you to the page you asked for.
- **ClassDash loads faster on other devices after the first time**: its styling and code are now files a browser can keep, so reloading the page only fetches what changed.
- **ClassDash uses much less data on other devices**, such as a phone or another computer on your network: the server now compresses what it sends them, so the page goes from about 1 MB to about 170 KB. The app and browsers on the same computer aren't affected.
- **Opening ClassDash during a check can't load a broken page anymore.** A check rewrites the page after every class, and a browser or the app loading it at that moment could get only part of it, with things like the checkboxes drawn wrong until a reload.
- **The "Still reading" banner is gone.** The progress bar already shows how a check is going, and the banner could get stuck at the top of the page after stopping a check.
- **Cmd/Ctrl + R reloads the page in a browser**, as it does on any other site, instead of starting a Quick check. In the app it's still Quick check, and Shift + Cmd/Ctrl + R is still Full check.
- **Cancelling a pairing code works every time.** The box could come back saying the code had run out. If the page reloads while a code is waiting, Settings → API now says so and lets you cancel it.
- **ClassDash in a browser.** The API now serves the ClassDash page too, so you can open it in a browser on the same computer or another device on your network: paste the access key once and the browser remembers it. Its buttons work the same as in the app, apart from the few things that need the app itself: those are greyed out with a note, like **Allow LAN access** and rolling the key, which only the app on the server's computer can change. See [API](docs/api.md#classdash-in-a-browser).
- **Odd, even and flipped days from the school calendar.** Each PDF legend mark and each kind of calendar feed event now has a second choice beside what kind of day it is: which day of your class schedule it is (**Odd**, **Even**, **A**, **B** or **Flipped**), so one event can be both, like "Even Day. Also MINIMUM Day". Both are guessed from the name. An even day on an odd date (or the other way round) counts as a flipped day in your class schedule, heads-up the evening before included, without typing it into Settings → Schedule.
- **Grade charts show the exact grade as you hover**, anywhere along the line and right away: the grade in effect at that point, with its dot lit. It used to need the pointer exactly on a dot and a moment's wait.
- **Quick check and Full check.** The old Refresh button only reloaded the page, which the live updates made pointless; it's now **Quick check** (Classroom and Canvas, a few seconds, no window), and Fresh check is now **Full check** (everything, Edpuzzle included, in a browser window). Quick check shows the loading wheel while a check runs. With Edpuzzle off, Full check is hidden, since it would be the same as a quick one. The menu bar and tray have both, and Cmd/Ctrl+R is now Quick check.
- **Automatic checks don't pop up a window while you're using the computer**: they're quick checks while the screen is on, and full checks (with Edpuzzle's browser window) only while it's off. Settings → Checking says which is which.
- **Update checks explain GitHub's hourly limit** instead of showing GitHub's own "check out the documentation" message: GitHub allows 60 checks an hour per network, shared by everyone on it (public Wi-Fi, Home Assistant, other devices), so ClassDash now says when it's safe to check again. Windows also asks GitHub whether anything changed since its last check, which doesn't count against the limit.
- **Web panes in the workspace on Windows**: Google Docs, Slides, Desmos and other sites from your bookmarks open in the workspace there too, with their own sign-in, back, forward and reload, downloads to your Downloads folder, and the AI's Text and Image access, the same as on the Mac.
- **Pair a device with a short code.** Settings → API → **Pair a Device** shows a code like `K7M-4QX`: type it on ClassDash's sign-in page on a phone or another computer, and it signs in with a key of its own, instead of copying the long access key over. Each paired device is listed in Settings → API with when it was last used, and can be removed on its own without signing out anything else. A code works once, for 10 minutes. A paired device never sees the access key, and the access key keeps working for Home Assistant. See [API](docs/api.md#pairing-a-device).
- **Stopping a check on Windows** now closes the check's browser too, and the page goes straight back to idle instead of showing the check as running (with Stop greyed out) for another 30 seconds. On every system, the page now hears that a check was stopped right away.
- **Typing `http://` instead of `https://` works**: the browser is sent to the https address instead of showing a connection error.
- **The API always runs now, for this computer only**, and Settings → API has one switch, **Allow LAN access**, off by default, for reaching it from other devices like Home Assistant. If you had the Home API on and on the network, LAN access is already on, so Home Assistant keeps working.
- **ClassDash stays in the menu bar (Mac) or the tray (Windows)** when you close its window, so its automatic checks, Home Assistant and a browser keep working. Its icon says whether the server is running, whether LAN access is on and when the last check was, with **Open ClassDash**, **Quick Check**, **Full Check**, **Restart Server** and **Quit ClassDash**. Quitting stops everything, the server included. On the Mac, the Dock icon goes away while the window is closed.
- **Copy Access Key** in the menu bar and the tray, for signing in to ClassDash in a browser without opening Settings.
- **Signing in to ClassDash in a browser** has its own page in ClassDash's style, and **Settings → Sign out** (only in a browser) signs that browser out again.
- **The app's window now shows ClassDash from its own server**, the same page a browser gets, signed in with a key of its own that's never shown (so rolling the access key signs out browsers and other devices, not the app). It trusts only ClassDash's own certificate, and if the server isn't answering yet it shows the page from disk as before.
- **ClassDash says when it can't reach its server**: a bar across the top ("Can't reach ClassDash — reconnecting…", with a pixel loading wheel in the theme blue, based on Canvas's spinner) until it's back. The app's window shows the wheel and "Connecting to ClassDash…" while it reaches the server, and if it can't, shows the last saved copy of the page with a bar saying so until the server is back, and in the app the server is started again by itself. An action that takes a moment to answer shows a thin bar sweeping across the top, and the window shows a loading bar while the page loads.
- **The Home API is now just the API**, in Settings and the docs ([API](docs/api.md)), since it's what a browser and other apps use too, not only Home Assistant.

## v2.8.0 (2026-11-03)

### ClassDash now looks like Home Assistant

- **A sidebar**, like Home Assistant's: **Dashboard**, **Workspace**, **Grades center** and **Settings**, with the page you're on lit. Workspace, the Grades center and Settings now open as pages of their own instead of panels over the dashboard, and Settings saves when you go to another page. **Refresh**, **Fresh check**, the status dots (now one cloud for every service: ✓ all worked, ! some failed, ✕ fewer than half worked, with how many failed beside it) and when the page was updated moved to the bottom of the sidebar, ClassDash's name to its top (the list of platforms under it is gone), and **☰** folds it down to its icons (remembered). In a narrow window the sidebar is a bar across the top.
- **Settings is a menu**, like Home Assistant's: a row for each part with what's in it, each opening as its own page with a **←** back (Esc works too). Account is now **Services**, Advanced is **System**, and **Language** moved to Display. There's no **Done** button anymore: going to another page in the sidebar saves, as before.
- **Icons in the Settings menu**, pixel art like the rest: a cloud for Services, Clawd (Claude's mascot) for AI, a classroom for Classes, a clock for Schedule, a calendar for Calendar, the A+ for Grades, a magnifying glass for Checking, a monitor for Display, a computer on a network for the Home API and the gear for System.
- **Settings → Services**, like Home Assistant's integrations: a card for each service that's on (Google Classroom, Canvas, Edpuzzle, Aequitas Q, and the calendar feed), with how its last check went and badges for how ClassDash reaches it and whether that takes a browser. Each opens a page of its own with its settings and **Turn off**, and **+ Add service** turns one on. Aequitas Q's sign-in moved there from Settings → Grades.
- **An editable dashboard**, like Home Assistant's: **Edit** in the bottom right corner, then **Hide** on a card hides it (the filters, Reminders, Grades, Calendar, Announcements and Edpuzzle transcripts) greyed out in place while you're editing, and **Show** brings it back. **Done** finishes, and the dashboard stays the way you left it.
- **New arrows** in the workspace: the buttons that move a pane (← → ↑ ↓) use the same pixel arrow as Settings' back button.

### Docs

- **A docs page for each service**, like Home Assistant's integration pages: [Services](docs/services.md) lists them, and Google Classroom, Canvas, Edpuzzle, Aequitas Q and the calendar feed each have their own page with what it reads, how it's read, setting it up, its options, how often it checks, known limitations, troubleshooting and turning it off, ending with a Details table (categories, the version it came in, its communication class, code owners and its browser class). The Sources page is now Services, and its comparison table moved onto each service's page. A **Not supported yet** list names services anyone could add.
- **A docs page for each AI** too: [AI](docs/ai.md) lists them with where each one runs and what it costs (a local AI is free but needs a powerful computer, and the page says what that means), and each AI's page covers setting it up, what it can do, privacy, known limitations and troubleshooting, ending with a Details table. A **Not supported yet** list names AIs anyone could add, starting with OpenRouter and OpenCode.

### Also

- **Claude's Ultra plan** is named in Settings → AI's note for Claude through Claude Code, beside Pro and Max (Ultra replaced Max 20x), and its age note now gives the right reason: your own Claude account's terms are 18+ (the rule about safeguards for apps that under-18s use is the API's).
- **ClassDash is now under the AGPL-3.0** (the GNU Affero General Public License) instead of the GPL-3.0. For using ClassDash nothing changes. The difference is for anyone who changes ClassDash and runs it as a service other people use over the internet: they have to share their code too, so no one can sell a closed-source copy that handles students' school logins however it wants. Versions up to v2.7.0 stay under the GPL-3.0.

## v2.7.0 (2026-11-01)

### ClassDash is now "the all-in-one app for school"

- **A new README**, short, with what's in the box and links, and the details moved into [`docs/`](docs/): getting started, the dashboard, sources, calendar, grades, the workspace, AI, the Home API and troubleshooting.
- **[Using AI with ClassDash](docs/ai-use.md)**, a guide to what the AI will and won't do, the lines ClassDash draws on purpose, and advice about AI and schoolwork in general.

### Workspace

- **A workspace for schoolwork.** The **Workspace** button (⌘O / Ctrl+O) opens a panel for writing on PDFs: a pen, a highlighter, typed text and an eraser, undo and redo, zoom, and **Export PDF** with your writing on it, ready to hand in. ClassDash keeps its own copy of each PDF, and what you write saves itself as you go.
- **Panes, up to five**, side by side or one above another: **PDF**, **AI** and **Web**. Split a pane right or down, drag the lines between them, and move a pane with the arrows in its top bar. In a narrow window they become tabs.
- **Web pages in the workspace** (Mac app): Google Docs, Slides and Sheets, Word, PowerPoint and Excel on the web, and Desmos, from bookmarks you can add to. There's no address bar on purpose: it's not a second browser. Their sign-in is the workspace's own, and they close when the workspace does, so nothing keeps running in the background.

### AI

- **An AI pane in the workspace.** Ask about the PDF you're on: it sees the page you're looking at and what you typed on it, and looks up the rest of your schoolwork by itself (assignments and their instructions, announcements, your other PDFs, and your grades when allowed), showing what it looked at under each answer. With no PDF open, it answers about your schoolwork in general. **Hints only** is on by default: it helps you get there yourself instead of giving answers. A short warning about what the AI is for comes first, once.
- **The AI can see a web page only if you let it**: each web page has an **AI** button, **Off** (the default), **Text** (its words; for a Google Doc, Sheet or Slides, the document's own text) or **Image** (also a picture of what's showing, like a Desmos graph, for an AI that can see images; greyed out otherwise). The page only goes to the AI when your question needs it, and nothing about it is kept.
- **A model picker in the chats**, under the question box of the AI pane and the Grades center: every AI you've set up, its models (search them, or type a name), the ones not ready yet greyed out with the reason, and **Thinking**: how hard the model thinks (medium unless you pick another; off or on for Ollama and some LM Studio models).
- **Settings → AI is now a setup list**: each AI with its state beside its name and its own setup and **Test**. The announcement scan's AI is picked under **Announcements → Read by**, with the same picker.
- **Newest models by default.** With no model picked, the OpenAI, Anthropic and Gemini APIs use their newest fast, cheap model (GPT Luna or mini, Claude Haiku, Gemini Flash).
- **LM Studio's model list leaves out speech and embedding models**, and says which models can think and which can see images. A model you deleted shows as not found instead of disappearing.
- **Other AI apps can use ClassDash** (Antigravity, OpenCode, Claude Desktop, Cursor and others with MCP), read-only, off until you turn it on in Settings → AI → **Other AI apps**, with grades behind a second switch.
- **Codex and Claude Code** show which plan they need and link to the switch that stops the company training on what you send.

### Assignments

- **Instructions under each card.** A card with the teacher's instructions has an **Instructions** drop-down, from Canvas and now from Google Classroom too, which ClassDash reads by opening each assignment in place and keeps between checks.

### Fixed

- **Two heads-ups for one day:** a flipped day that's also a repeat of the day before now gets one heads-up saying both, instead of two banners.
- **Q timing out while signing in** ("page.waitForSelector: Timeout 30000ms exceeded"): ClassDash now waits longer for a slow Q, tries once more, and says in plain words that Q was slow.
- **Some answers never reached the page**, like the Grades center AI's, when the action behind them loaded the collector along the way (since v2.5.0).
