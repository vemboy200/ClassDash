# AI

ClassDash doesn't come with an AI of its own: you bring yours, and nothing AI-related is on until you set one up. What the AI can and can't do, the lines ClassDash draws on purpose, and general advice about AI and schoolwork are in [Using AI with ClassDash](ai-use.md).

## Setting up an AI

Settings → **AI** lists every AI ClassDash can use, each with its state beside its name (ready, how many models it has, or what it still needs: not running, not signed in, a key, its box ticked). Open one to set it up: its notes, its age rule and box for a cloud one, its key or address, and **Test**. **Which one should I pick?** at the top of that section explains the choices, the age rules, and why there's no Google plan option.

- **On your own computer** (recommended): Apple Intelligence, Ollama, LM Studio, or Microsoft's Foundry Local, which also runs on Windows. Your class text never leaves your computer. ClassDash finds them by itself; give Ollama or LM Studio an address only when it's on another computer at home. Foundry Local's address changes each time it starts, so ClassDash asks it for the address each time and starts it when it isn't running; download and load a model with its own `foundry model` commands first. Foundry Local support was built from Microsoft's documentation and hasn't been tried on a real install yet.
- **In the cloud**: ChatGPT through Codex, Claude through Claude Code, and the OpenAI, Anthropic and Gemini APIs. These send that text to a company, and each has an age rule you confirm first.
  - ChatGPT through Codex works on ChatGPT's free plan too, with tighter limits; Claude through Claude Code needs at least Claude Pro ($20 a month).
  - Both companies can train on what you send through them unless you turn it off, and Settings → AI links to the switch: ChatGPT's "Improve the model for everyone" (Settings → Data controls, which covers Codex too) and Claude's "Help improve Claude" (Settings → Privacy).
  - Claude through Claude Code is a gray area: Anthropic's docs say other apps may not offer Claude plan logins or rate limits without its approval. ClassDash never signs in or sees your login, it runs the Claude Code you signed in yourself, but what it asks still uses your plan and its rate limits indirectly, through Claude Code. That's why it's a gray area rather than clearly against the rules, so you tick a box saying you know that first, and the Anthropic API with a key is the sure way.

## Picking the AI and model

Which AI is used is picked where it's used, with the same picker: the button under the question box in the workspace's AI pane and the Grades center (one pick for both chats), and **Read by** under **Announcements** in Settings → AI.

- The picker lists every AI down the side, greying out the ones that aren't ready yet with the reason, and the chosen one's models beside them. Search them, or type a model name the list doesn't have.
- With no model picked, the OpenAI, Anthropic and Gemini APIs use the newest of their fast, cheap models (GPT Luna or mini, Claude Haiku, Gemini Flash), so a new one is used without updating ClassDash.
- **Thinking**, under the models, sets how hard the model thinks where it can be told: low, medium or high for Codex, Claude Code and the APIs' models that take it (medium unless you pick another), off or on for Ollama and for LM Studio models like Nemotron.
- Small local models sometimes stop short or pick the wrong thing to look up; a bigger model does better.

## Announcements

The announcement AI finds homework your teachers post as announcements instead of assignments. It's Off until you pick one under **Announcements** → **Read by**.

- After each check, new announcements are read, and the homework in them is added to your **Reminders** with its due date, marked "from an announcement" with a link to the post. When the announcement gives no date, it's due at 11:59 PM the night before that class next meets, if the class is in Settings → **Schedule**.
- Work that's already an assignment or a reminder in that class is skipped: a similar title by plain logic, and the same work worded differently by asking the AI about each pair. Announcements from before you turned AI on are left alone.
- If your teachers also post the day's classwork and you only want homework, turn on **Skip classwork**: the AI is then told to leave out work that's done in class.
- To read one now, hover it and press **AI scan**. Once an announcement has been read, a fold-out under it shows what the AI found, why anything was left out, what it answered, and its thinking if the model sends any (most local models only think when asked, which takes much longer).

## The chats

- The workspace's **AI pane** answers about the PDF you're working on, your schoolwork in general, and web pages you let it see: see [Workspace](workspace.md#the-ai-pane).
- The **Grades center** has a chat about your grades: see [Grades](grades.md).

## Other AI apps

ClassDash can also hand its tools to AI apps you use yourself, like Antigravity, OpenCode, Claude Desktop or Cursor, through MCP (the standard way those apps take in tools). The AI in that app can then look at your assignments, the teachers' instructions, announcements and the text of PDFs in your workspace, and your grades if you allow that too. It can only read: nothing gets changed, hidden or turned in. Web pages in your workspace are never shared this way. It's off until you turn on **Let other AI apps use ClassDash** in Settings → AI → **Other AI apps**, because ClassDash can't see which AI that app sends your schoolwork to. That section also has the config to paste into the app, with a Copy button. Turning it off works right away, even in an app that's already running.
