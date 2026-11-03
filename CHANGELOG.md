# Changelog

What's changed in each version of ClassDash. **Unreleased** is what's built and on `main` but not in a release yet: it becomes the next version's release notes. Earlier versions are on the [Releases page](https://github.com/vemboy200/ClassDash/releases).

## Unreleased

- **ClassDash in a browser.** The Home API now serves the ClassDash page too, so you can open it in a browser on the same computer or another device on your network: paste the access key once and the browser remembers it. Its buttons work the same as in the app, apart from the few things that need the app itself. See [Home API](docs/home-api.md#classdash-in-a-browser).
- **The Home API always runs now, for this computer only**, and Settings → Home API has one switch, **Allow LAN access**, off by default, for reaching it from other devices like Home Assistant. If you had the Home API on and on the network, LAN access is already on, so Home Assistant keeps working.

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
