# Workspace

The **Workspace** button at the top of the page (or **Open Workspace** in the menu bar, ⌘O / Ctrl+O) opens a panel over the page for working on schoolwork: PDFs to write on, web pages like Google Docs and Desmos, and the AI, side by side. **Close** or Esc goes back, and it opens again the way you left it.

## Panes

The workspace is made of panes, up to five, side by side or one above another: **PDF**, **AI** and **Web**. It starts as a PDF with the AI beside it.

- The ◫ and ⊟ buttons at the top of a pane split it to the right or down, × closes it, and the button with the pane's name changes what it shows.
- The lines between panes drag to make them bigger or smaller.
- A pane's top bar has arrows (← → ↑ ↓) for the ways there's another pane to go: one trades the pane's place with the pane next to it that way.
- Two PDFs can sit side by side, or a Doc next to Desmos with the AI beside them.
- In a narrow window the panes become tabs at the top.

## Writing on PDFs

**Open a PDF…** adds one; ClassDash keeps its own copy, so the file you picked is never changed.

- Write on it with the **Pen**, the **Highlighter** or **Text** (click where the text goes; Esc or clicking away finishes it, and clicking a text with the Text tool edits it), and take things away with the **Eraser**. Each has a few colors and three sizes.
- Undo and redo are ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Y), the keys P, H, T and E pick a tool, and zoom is ⌘+ / ⌘−, ⌘0 to fit the width, or a pinch on a trackpad.
- A PDF opens at its actual size (100%), smaller only if the window is too narrow for that. A pen or a mouse writes; a finger on a touchscreen scrolls.
- What you write saves itself as you go (and once more when you close the panel or quit), and the PDF is still there with it under **All files** the next time.
- **Export PDF** saves a copy of the PDF with your writing on it, ready to hand in: the original pages stay sharp and their text stays selectable.

For now PDFs are added by hand; opening an assignment's attachment straight from the page comes next.

## Web pages

A **Web** pane shows a site from your bookmarks (Mac app only for now): Google Docs, Slides and Sheets, Word, PowerPoint and Excel on the web, and Desmos to start.

- It isn't a whole second browser, so there's no address bar: ☆ **Bookmarks** shows them again, **Bookmark this page** keeps the one you're on, **New bookmark** adds a site by its address, and × on a bookmark removes it. Back, forward and reload work as usual.
- You sign in to each site once, and that sign-in is the workspace's own: apart from Safari, and apart from the browser ClassDash checks your classes with.
- Downloads go to your Downloads folder.
- Closing the workspace closes its pages so nothing keeps running in the background; they open again on the same page next time.
- The **AI** button in a web page's bar says what the AI may see of it (see below).

## The AI pane

The first time, the **AI** pane shows a short warning about what the AI is for and what it won't do, with a link to [Using AI with ClassDash](ai-use.md); **I understand** puts it away for good.

- **With a PDF open**, it asks about the PDF pane you last clicked. It sees the page you're looking at and what you typed on it, and it can look up the rest of your schoolwork by itself: your assignments and their instructions, announcements, your other PDFs, and your grades (with a local AI, or a cloud one ticked in the Grades center's box). Each PDF keeps its own chat until **Clear**.
- **With no PDF open**, it answers about your schoolwork in general (what's due, what the instructions say, what was posted) in a chat of its own.
- **Web pages** are off to it unless you say otherwise, with the **AI** button in each web page's bar:
  - **Off** (the default): the AI can't see the page.
  - **Text**: the AI can read the page's words; for a Google Doc, Sheet or Slides, the document's own text. Works with every AI.
  - **Image**: also a picture of what's showing in the pane, like a Desmos graph. Only for an AI that can see images (LM Studio and Ollama say which of their models can, and cloud ones all can); greyed out otherwise.

  The page only goes to the AI when it decides your question needs it, and it says so under the answer; nothing about the page is kept after. While a web page is the pane in front, a note in the AI pane says whether the AI can see it.
- It shows what it's looking at while it works, and what it looked at under each answer.
- **Hints only** is on by default for each chat: the AI helps you get there yourself (explains the idea, points to where the answer is, asks a guiding question, checks your attempt) instead of giving answers. Turn it off where you just want explanations.
- It can only read: it can't change, hide or turn in anything, and it never types into a page.
- The button under the question box picks the AI, the model and how hard it thinks, for this chat and the Grades center's (see [AI](ai.md#picking-the-ai-and-model)).
- A local AI keeps all of this on your computer; a cloud one gets the page and whatever it looks up, after you've ticked its box in Settings → AI. Apple Intelligence only sees the page, since it can't look things up.
