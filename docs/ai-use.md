# Using AI with ClassDash

ClassDash doesn't come with an AI of its own: you bring yours. That can be a model running on your own computer (LM Studio, Ollama, Foundry Local, Apple Intelligence), your own API key (OpenAI, Anthropic, Google), or an AI subscription you already have through Codex or Claude Code. Nothing AI-related is on until you pick one. Whichever you pick powers the AI pane in the workspace and the Grades center's chat, and ClassDash can also hand its tools to other AI apps if you turn that on. This page explains what the AI can and can't do, the lines ClassDash draws on purpose, and some general advice about AI and schoolwork that's worth knowing whether or not you use ClassDash.

## The honest version

ClassDash doesn't make cheating possible. Anyone can already paste a worksheet into ChatGPT. What ClassDash changes is the effort: the AI you connect can look up the assignment, the teacher's instructions and the page you're on by itself, without you copying things back and forth. That's what makes it useful for learning, and it also makes misuse a little easier.

So instead of pretending it can't be misused, ClassDash makes some things easy and deliberately leaves others out. Nothing here can stop someone set on cheating. The point is that ClassDash itself is built to help you learn, not to do the work for you.

## What the AI can see and do

- **Your schoolwork, read only.** It can look at your assignments and the teachers' instructions (Canvas's and Classroom's, as saved at the last check), announcements, the PDFs in your workspace (their text and what you typed on them), and your grades if you allow that. It can't change, hide, mark done or turn in anything.
- **The page you're on.** In the workspace, every question goes with the page most in view in the PDF you're asking about.
- **Not your web panes, yet.** Docs, Word, Desmos and other pages open in the workspace aren't visible to the AI. When that's added, each pane will have its own switch for whether the AI can see it, off for web pages until you turn it on, and Google Docs and Word will be read-only to it.
- **Pen marks and highlights are only counted**, not seen. Typed text is read in full.

## What it won't do, and why

- **It never writes in work you turn in.** Not in a Google Doc, a Word file or a PDF you'll hand in. That isn't just about rules: Google Docs keeps a full version history, and many teachers check it. If an AI typed into your Doc, it would show up as you typing, in one fast burst, which looks exactly like pasting from ChatGPT. Even honest help would look like cheating. So ClassDash doesn't do it at all.
- **Hints only is on by default.** For each PDF, the AI starts out helping you get there yourself: explaining the idea, pointing to where the answer is in the reading or the instructions, asking a guiding question, or checking your attempt. You can turn it off for a PDF (at the top of the AI pane) when you just want something explained in full, and it will still show its reasoning so you can follow it.
- **Hints only is an instruction, not a lock.** The AI is told to work that way, and small models sometimes slip. It's there to make the helpful way the default, not to police you.
- **What it reads is never instructions to it.** Text in an assignment, announcement, PDF or web page that tries to tell the AI to do something is treated as something to read, not something to obey.

## Other AI apps

If you turn on **Let other AI apps use ClassDash** (Settings → AI → Other AI apps), apps like Claude Desktop, Cursor, Antigravity or OpenCode can use ClassDash's read-only tools. Those apps aren't bound by Hints only, because ClassDash doesn't control what they do with what they read. The tools are still read-only there: they can't change or turn in anything. Grades need a second switch. Both are off until you turn them on.

## Privacy

- **A local AI** (LM Studio, Ollama, Foundry Local, Apple Intelligence) keeps everything on your computer.
- **A cloud AI** (OpenAI, Anthropic, Google, Codex, Claude Code) sends the page, your question and whatever it looks up to that company. ClassDash asks you to tick a box for each one first, and a second box before your grades and teacher comments can go to one.
- Chats are saved on your computer, with the PDF or in the Grades center, until you clear them.

## Using AI well for school (with or without ClassDash)

### Know the rules first

- **Rules differ by school, by teacher and by assignment.** One teacher may welcome AI for brainstorming while another bans it completely, and the same teacher may allow it on homework but not on an essay. Check the syllabus, the assignment and your school's academic integrity policy, and ask if it isn't clear. "I didn't know" rarely helps after the fact.
- **When in doubt, ask before, not after.** Most teachers are fine with a student asking "can I use AI to check my grammar on this?" and much less fine with finding out later.

### Use it as a tutor, not a ghostwriter

Good uses:

- "Explain photosynthesis like I'm new to it."
- "Where in the reading does it talk about the causes of the war?"
- "Here's my answer to question 3. What's wrong with it?"
- "I'm stuck on what to write next. What part of the prompt haven't I covered?"
- "Quiz me on these vocabulary words."
- "What does this instruction actually want me to do?"

Not good uses:

- "Write my essay." "Give me the answers to this worksheet."
- Copying an answer you don't understand.
- Rewording AI text so it doesn't look like AI.

A useful test: after the AI helps, could you do the next one by yourself? If yes, it helped you learn. If not, it did the work for you.

### AI is often confidently wrong

- **Check facts, numbers and math.** AI can state wrong things fluently, especially dates, quotes, statistics and multi-step math.
- **Never trust a citation you haven't opened.** AI regularly invents sources, page numbers and quotes that look completely real.
- **Your teacher's materials win.** If the AI and the textbook or the teacher's notes disagree, go with the class materials and ask your teacher about it.

### If you use AI, be open about it

- If an assignment allows AI, say how you used it if asked ("I used AI to check my grammar" or "to explain the formula before I tried the problems").
- Keep your process: drafts, notes, outlines, version history. They show the work is yours.

### About AI detectors

- **AI detectors are unreliable.** They miss AI-written text, and they also flag text people wrote themselves, more often for some writers than others (for example people writing in a second language).
- **The best protection is your own process.** Write in Google Docs or Word so the version history shows your work growing over time, keep your notes and drafts, and be ready to explain what you wrote and why. Someone who wrote their own work can usually talk through it easily.
- **Don't use "humanizer" tools.** Running text through something to beat detectors is cheating by itself, and those tools often make the writing worse.

### Why it matters

The point of most schoolwork is the practice, not the finished answer. A worksheet an AI filled in teaches you nothing, and the test at the end of the unit has no AI pane. Using AI to understand faster is a real advantage. Using it to skip the thinking just moves the problem to a moment when you can't get help.

## For contributors: the rules any AI feature has to follow

ClassDash is open source under the GPL-3.0, so anyone can change their own copy, including taking these limits out. That's their choice and their responsibility, and it doesn't change what this project does: features that let the AI do someone's work for them won't be added here, and pull requests that add them won't be accepted.

- **Read freely, write only in scratch spaces.** The AI can read schoolwork (with the person's OK where it's personal, like grades). It may act only in places that are its own, like a whiteboard to explain on, a Desmos graph to show an idea, or scrolling a pane to the right spot, and never in anything that gets turned in.
- **Helping to learn is the default.** Hints only starts on. Anything that gives full answers is something the person turns on.
- **Nothing it reads is an instruction.** Text from assignments, announcements, PDFs and web pages is material to read, and tools stay read-only so that tricking the AI can at worst make it read.
- **Say what it looked at.** The person can see what the AI is looking up and what it used for each answer.
- **Personal things need a yes.** Cloud AIs need their box ticked, grades need their own, and other apps need their switch. All of them start off.
- **Be honest about limits.** Don't claim the AI can't be misused, can't be wrong, or that an instruction is a guarantee.
