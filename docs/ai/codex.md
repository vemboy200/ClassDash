# ChatGPT through Codex

Uses your own ChatGPT plan through OpenAI's Codex: the `codex` command, which you sign in to yourself. ClassDash never sees your login.

## Before you start

- Codex installed, and signed in once with `codex login` in a terminal.
- A ChatGPT plan. The free plan works too, with tighter limits.
- Being 13 or older; under 18, with a parent's or guardian's permission (OpenAI's rule).

## Setting it up

1. Install Codex and run `codex login`.
2. Settings → **AI** → **ChatGPT (through Codex)**: read its notes and tick its box. Its **Test** button checks that ClassDash can reach it and get an answer.

## Options

- **Model** and **Thinking** (low, medium or high; medium unless you pick another) are picked in the picker.

## What it can do

- Read announcements for homework, and answer in the AI pane and the Grades center.
- Look up your assignments, instructions, announcements and PDFs by itself while answering.
- See images.

ClassDash runs it in a read-only sandbox in an empty folder, so it can't touch your files.

## Privacy

OpenAI gets a copy of what ClassDash sends it: announcement text, class names (and teacher names where they're part of one), and whatever it looks up for an answer. It's handled under OpenAI's privacy policy, not ClassDash's.

OpenAI can also train its models on what goes through Codex. To turn that off, in ChatGPT go to Settings → Data controls and turn off "Improve the model for everyone": it covers Codex too. Settings → AI links to it.

## Known limitations

- It uses your plan's limits, shared with your own ChatGPT use.

## Troubleshooting

- **"Installed but not signed in":** run `codex login` in a terminal.

## Turning it off

Pick another AI in the picker, or untick its box in Settings → **AI**: a cloud AI is never used without it.

## Details

| | |
|---|---|
| **Introduced** | v2.5.0 |
| **Runs** | In the cloud (OpenAI) |
| **Platforms** | Mac and Windows |
| **Cost** | Your ChatGPT plan; the free one works, with tighter limits |
| **Sees images** | Yes |
| **Thinking** | Low, medium or high |
| **Looks things up** | Yes |
| **Age rule** | 13+, under 18 with a parent's or guardian's permission |
| **Code owners** | None yet |
