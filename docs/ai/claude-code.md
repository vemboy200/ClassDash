# Claude through Claude Code

Uses your own Claude plan through Anthropic's Claude Code: the `claude` command, which you sign in to yourself. ClassDash never sees your login.

## Before you start

- Claude Code installed, and signed in once with `claude auth login` in a terminal.
- Claude Pro ($20 a month) or Max: Claude's free plan doesn't include Claude Code.
- Being 18 or older. Anthropic's own Claude apps are 18+, and apps that let under-18s use Claude need safeguards ClassDash doesn't have, so this one is for people like college students.

## Setting it up

1. Install Claude Code and run `claude auth login`.
2. Settings → **AI** → **Claude (through Claude Code)**: read its notes, including the gray area below, and tick its box. Its **Test** button checks that ClassDash can reach it and get an answer.

## Options

- **Model**: left empty, it's Haiku, which uses the least of your plan.
- **Thinking**: low, medium or high, medium unless you pick another, in the picker.

## What it can do

- Read announcements for homework, and answer in the AI pane and the Grades center.
- Look up your assignments, instructions, announcements and PDFs by itself while answering.
- See images.

ClassDash runs it in an empty folder, with none of your own Claude Code tools, settings, MCP servers or saved sessions.

## Privacy

Anthropic gets a copy of what ClassDash sends it: announcement text, class names (and teacher names where they're part of one), and whatever it looks up for an answer. It's handled under Anthropic's privacy policy, not ClassDash's.

Anthropic can also train its models on your Claude Code sessions. To turn that off, on claude.ai go to Settings → Privacy and turn off "Help improve Claude". Settings → AI links to it.

## Known limitations

- **A gray area.** Anthropic's docs say apps other than its own may not offer Claude plan logins or plan rate limits without its approval. ClassDash never signs in or sees your login (it runs your own Claude Code), but what it asks still uses your plan and its rate limits, through Claude Code. That's why it's gray rather than clearly against the rules, and why you tick a box saying you know first. The [Anthropic API](anthropic-api.md) with a key is the sure way.
- It uses your plan's limits, shared with your own Claude use.

## Troubleshooting

- **"Installed but not signed in":** run `claude auth login` in a terminal.

## Turning it off

Pick another AI in the picker, or untick its box in Settings → **AI**: a cloud AI is never used without it.

## Details

| | |
|---|---|
| **Introduced** | v2.6.0 |
| **Runs** | In the cloud (Anthropic) |
| **Platforms** | Mac and Windows |
| **Cost** | Your Claude plan: Pro ($20 a month) or Max |
| **Sees images** | Yes |
| **Thinking** | Low, medium or high |
| **Looks things up** | Yes |
| **Age rule** | 18+ |
| **Code owners** | None yet |
