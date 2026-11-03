# Ollama

A free app that runs AI models on your own computer. ClassDash talks to it on this computer, or on another computer at home.

## Before you start

- Ollama, from [ollama.com](https://ollama.com).
- A model, downloaded with Ollama (for example `ollama pull llama3.2`).
- A computer powerful enough for that model: see [What "a powerful computer" means](../ai.md#what-a-powerful-computer-means).

## Setting it up

1. Install Ollama and download a model.
2. Settings → **AI** → **Ollama**: ClassDash finds it by itself on this computer. Its **Test** button checks that ClassDash can reach it and get an answer.

## Options

- **Address**: only when Ollama runs on another computer at home. Only an address on this computer or your home network is accepted, so "local" stays true.
- **Model** and **Thinking** are picked in the picker.

## What it can do

- Read announcements for homework, and answer in the AI pane and the Grades center.
- Look up your assignments, instructions, announcements and PDFs by itself while answering.
- See images, with models that can: Ollama says which ones do, and the picker shows it.
- Thinking off or on.

## Privacy

Everything stays on your computer: nothing ClassDash asks it goes anywhere else.

## Known limitations

- Small models sometimes stop short or look up the wrong thing; a bigger model does better.
- How fast it answers depends on your computer.

## Troubleshooting

- **Not running:** open Ollama.
- **No models:** download one with `ollama pull`.

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
| **Thinking** | Off or on |
| **Looks things up** | Yes |
| **Age rule** | None |
| **Code owners** | None yet |
