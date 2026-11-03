# LM Studio

A free app for downloading and running AI models on your own computer, with a local server that ClassDash talks to.

## Before you start

- LM Studio, from [lmstudio.ai](https://lmstudio.ai).
- A model downloaded in LM Studio, and its local server started.
- A computer powerful enough for that model: see [What "a powerful computer" means](../ai.md#what-a-powerful-computer-means).

## Setting it up

1. Install LM Studio, download a model and start its local server.
2. Settings → **AI** → **LM Studio**: ClassDash finds it by itself. Older versions use port 1234 and newer ones (and LM Studio Bionic) use 1235, so it looks on both. Its **Test** button checks that ClassDash can reach it and get an answer.

## Options

- **Address**: only when LM Studio runs on another computer at home. Only an address on this computer or your home network is accepted.
- **Model** and **Thinking** are picked in the picker. Speech and embedding models are left out of the list.

## What it can do

- Read announcements for homework, and answer in the AI pane and the Grades center.
- Look up your assignments, instructions, announcements and PDFs by itself while answering.
- See images, with models that can: LM Studio says which ones do, and the picker shows it.
- Thinking off or on, for models that think (like Nemotron).

## Privacy

Everything stays on your computer: nothing ClassDash asks it goes anywhere else.

## Known limitations

- Small models sometimes stop short or look up the wrong thing; a bigger model does better.
- How fast it answers depends on your computer.
- A model you deleted shows as not found until you pick another.

## Troubleshooting

- **Not running:** open LM Studio and start its local server.

## Turning it off

Pick another AI in the picker (under the question box in the AI pane or the Grades center, and **Read by** under **Announcements**). ClassDash never runs it on its own.

## Details

| | |
|---|---|
| **Introduced** | v2.5.0 |
| **Runs** | On your computer, or another computer at home |
| **Platforms** | Mac and Windows |
| **Cost** | Free, but needs a powerful computer (see [What "a powerful computer" means](../ai.md#what-a-powerful-computer-means)) |
| **Sees images** | With models that can |
| **Thinking** | Off or on, for models that think |
| **Looks things up** | Yes |
| **Age rule** | None |
| **Code owners** | [@vemboy200](https://github.com/vemboy200) |
