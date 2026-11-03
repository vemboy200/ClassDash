# OpenAI API

OpenAI's API, with your own key. You pay OpenAI for what you use.

## Before you start

- An API key from [platform.openai.com](https://platform.openai.com), with billing set up.
- Being 13 or older; under 18, with a parent's or guardian's permission (OpenAI's rule).

## Setting it up

1. Make a key at [platform.openai.com](https://platform.openai.com).
2. Settings → **AI** → **OpenAI API**: paste the key, read its notes and tick its box. Its **Test** button checks that ClassDash can reach it and get an answer.

## Options

- **API key**: shown masked. Treat it like a password: it's kept in ClassDash's settings on your computer, never logged, and scrubbed out of any error OpenAI sends back.
- **Model**: with none picked, it uses OpenAI's newest fast, cheap model (GPT Luna or mini), so a new one is used without updating ClassDash.
- **Thinking**: low, medium or high, in the picker, for the models that reason (medium unless you pick another).

## What it can do

- Read announcements for homework, and answer in the AI pane and the Grades center.
- Look up your assignments, instructions, announcements and PDFs by itself while answering.
- See images.

## Privacy

OpenAI gets a copy of what ClassDash sends it: announcement text, class names (and teacher names where they're part of one), and whatever it looks up for an answer. It's handled under OpenAI's privacy policy, not ClassDash's.

## Known limitations

- Each question costs a little, paid to OpenAI.

## Troubleshooting

- **The Test fails:** check the key, and that billing is set up on your OpenAI account.

## Turning it off

Pick another AI in the picker, or untick its box in Settings → **AI**: a cloud AI is never used without it. Clearing the key works too.

## Details

| | |
|---|---|
| **Introduced** | v2.5.0 |
| **Runs** | In the cloud (OpenAI) |
| **Platforms** | Mac and Windows |
| **Cost** | Paid per use, with your own API key |
| **Sees images** | Yes |
| **Thinking** | Low, medium or high, for models that reason |
| **Looks things up** | Yes |
| **Age rule** | 13+, under 18 with a parent's or guardian's permission |
| **Code owners** | None yet |
