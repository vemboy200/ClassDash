# Anthropic API

Anthropic's API, with your own key. You pay Anthropic for what you use.

## Before you start

- An API key from the [Claude Console](https://console.anthropic.com), with billing set up.
- Being 18 or older. Anthropic's own Claude apps are 18+, and apps that let under-18s use Claude need safeguards ClassDash doesn't have, so this one is for people like college students.

## Setting it up

1. Make a key at the [Claude Console](https://console.anthropic.com).
2. Settings → **AI** → **Anthropic API (Claude)**: paste the key, read its notes and tick its box. Its **Test** button checks that ClassDash can reach it and get an answer.

## Options

- **API key**: shown masked. Treat it like a password: it's kept in ClassDash's settings on your computer, never logged, and scrubbed out of any error Anthropic sends back.
- **Model**: with none picked, it uses Anthropic's newest fast, cheap model (Claude Haiku), so a new one is used without updating ClassDash.
- **Thinking**: low, medium or high, in the picker, for the newer models that take it (medium unless you pick another).

## What it can do

- Read announcements for homework, and answer in the AI pane and the Grades center.
- Look up your assignments, instructions, announcements and PDFs by itself while answering.
- See images.

## Privacy

Anthropic gets a copy of what ClassDash sends it: announcement text, class names (and teacher names where they're part of one), and whatever it looks up for an answer. It's handled under Anthropic's privacy policy, not ClassDash's.

## Known limitations

- Each question costs a little, paid to Anthropic.

## Troubleshooting

- **The Test fails:** check the key, and that billing is set up on your Anthropic account.

## Turning it off

Pick another AI in the picker, or untick its box in Settings → **AI**: a cloud AI is never used without it. Clearing the key works too.

## Details

| | |
|---|---|
| **Introduced** | v2.5.0 |
| **Runs** | In the cloud (Anthropic) |
| **Platforms** | Mac and Windows |
| **Cost** | Paid per use, with your own API key |
| **Sees images** | Yes |
| **Thinking** | Low, medium or high, for newer models |
| **Looks things up** | Yes |
| **Age rule** | 18+ |
| **Code owners** | None yet |
