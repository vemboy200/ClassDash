# AI

ClassDash doesn't come with an AI of its own: you bring yours, and nothing AI-related is on until you set one up. What the AI can and can't do, the lines ClassDash draws on purpose, and general advice about AI and schoolwork are in [Using AI with ClassDash](ai-use.md).

## Setting up an AI

Settings → **AI** lists every AI ClassDash can use, each with its state beside its name (ready, how many models it has, or what it still needs: not running, not signed in, a key, its box ticked). Open one to set it up: its notes, its age rule and box for a cloud one, its key or address, and **Test**. **Which one should I pick?** at the top of that section explains the choices, the age rules, and why there's no Google plan option.

Each AI has a page of its own, like the [services](services.md):

| AI | Runs | Cost |
|---|---|---|
| [Apple Intelligence](ai/apple-intelligence.md) | On your Mac | Free, built into macOS |
| [Ollama](ai/ollama.md) | On your computer | Free, but needs a powerful computer |
| [LM Studio](ai/lm-studio.md) | On your computer | Free, but needs a powerful computer |
| [Foundry Local](ai/foundry-local.md) | On your computer | Free, but needs a powerful computer |
| [ChatGPT through Codex](ai/codex.md) | In the cloud | Your ChatGPT plan, free one included |
| [Claude through Claude Code](ai/claude-code.md) | In the cloud | Your Claude plan: Pro ($20 a month), Max or Ultra |
| [OpenAI API](ai/openai-api.md) | In the cloud | Paid per use |
| [Anthropic API](ai/anthropic-api.md) | In the cloud | Paid per use |
| [Gemini API](ai/gemini-api.md) | In the cloud | Paid per use, or a free tier Google trains on |

- **On your own computer** (recommended): your class text never leaves your computer. ClassDash finds them by itself.
- **In the cloud**: these send that text to a company, and each has an age rule you confirm first.

### What "a powerful computer" means

A local AI is free to use, but your computer does all the work, so how well it goes depends on the computer. As a rough guide:

- **Memory matters most.** A small model (1 to 4 billion parameters, like Llama 3.2 3B) gets by with 8 GB. A mid-size one (7 to 8 billion) wants 16 GB. Bigger ones want 32 GB or more, or a graphics card with plenty of its own memory.
- **Macs with Apple silicon** do well for their size, since the graphics share the computer's memory. So do PCs with a recent graphics card.
- **On a weak laptop** it still works, but an answer can take minutes, and the computer is slow and warm while it thinks.
- **Smaller models make more mistakes**: they sometimes stop short or look up the wrong thing. A bigger model does better, if the computer can run it.

Apple Intelligence is the exception: the model is built into macOS and made for the Macs that can run it.

### What the details on each page mean

Each AI's page ends with a **Details** table:

- **Introduced**: the ClassDash version it first came in.
- **Runs**: on your computer, or in the cloud.
- **Platforms**: where ClassDash can use it.
- **Cost**: what it takes to use. For a local AI, that's a powerful enough computer.
- **Sees images**: whether it can see a picture of a web page in the workspace (the **Image** setting).
- **Thinking**: whether you can set how hard it thinks in the picker.
- **Looks things up**: whether it can look up your assignments, instructions, announcements and PDFs by itself while answering.
- **Age rule**: the company's own age rule, for a cloud AI.
- **Code owners**: who looks after that AI's code, on GitHub. An AI with none has no one assigned yet.

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

## Not supported yet

AIs that would fit ClassDash but aren't built yet, in case anyone wants to pick one up (see [CONTRIBUTING.md](../CONTRIBUTING.md)). Whoever builds one becomes its code owner.

- **OpenRouter**: one key for models from many companies, with an OpenAI-style API, so it would work much like the [OpenAI API](ai/openai-api.md). Each model's own company and its age rule would still apply.
- **OpenCode**: an open-source coding agent like Codex and Claude Code. It can already use ClassDash's tools (see [Other AI apps](#other-ai-apps)); as an AI in ClassDash, it would work the way [ChatGPT through Codex](ai/codex.md) does, with ClassDash running your own `opencode` command.
