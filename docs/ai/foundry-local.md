# Foundry Local

Microsoft's free local AI, for Windows and for Macs with Apple silicon.

## Before you start

- Foundry Local (`winget install Microsoft.FoundryLocal` on Windows).
- A model, downloaded and loaded with its own commands, for example `foundry model download qwen2.5-1.5b`, then `foundry model load qwen2.5-1.5b`.
- A computer powerful enough for that model: see [What "a powerful computer" means](../ai.md#what-a-powerful-computer-means).

## Setting it up

Settings → **AI** → **Foundry Local**. Its address changes each time it starts, so ClassDash asks it for the address each time, and starts it when it isn't running (it stops itself when idle). Its **Test** button checks that ClassDash can reach it and get an answer.

## What it can do

- Read announcements for homework, and answer in the AI pane and the Grades center.
- Look up your assignments, instructions, announcements and PDFs by itself while answering.

## Privacy

Everything stays on your computer: nothing ClassDash asks it goes anywhere else.

## Known limitations

- **Not tried on a real install yet:** support was built from Microsoft's documentation.
- It can't see images, and has no thinking setting.

## Troubleshooting

- **"Not running, ClassDash starts it":** that's normal, since it stops itself when idle.
- **A model it hasn't loaded:** ClassDash loads it and asks again once.

## Turning it off

Pick another AI in the picker (under the question box in the AI pane or the Grades center, and **Read by** under **Announcements**). ClassDash never runs it on its own.

## Details

| | |
|---|---|
| **Introduced** | v2.6.0 |
| **Runs** | On your computer |
| **Platforms** | Windows, and Macs with Apple silicon |
| **Cost** | Free, but needs a powerful computer (see [What "a powerful computer" means](../ai.md#what-a-powerful-computer-means)) |
| **Sees images** | No |
| **Thinking** | No |
| **Looks things up** | Yes |
| **Age rule** | None |
| **Code owners** | None yet |
