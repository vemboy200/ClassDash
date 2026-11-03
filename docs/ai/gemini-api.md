# Gemini API

Google's API, with your own key. You pay Google for what you use.

## Before you start

- An API key from [Google AI Studio](https://aistudio.google.com). It works on the free tier, or with billing set up for the paid tier.
- Being 18 or older. Google's Gemini API terms say you must be 18 or older, and it can't be used in apps likely to be used by under-18s, so this one is for people like college students.

## Setting it up

1. Make a key at [Google AI Studio](https://aistudio.google.com).
2. Settings → **AI** → **Google Gemini API**: paste the key, read its notes and tick its box. Its **Test** button checks that ClassDash can reach it and get an answer.

## Options

- **API key**: shown masked. Treat it like a password: it's kept in ClassDash's settings on your computer, never logged, and scrubbed out of any error Google sends back.
- **Model**: with none picked, it uses Google's newest fast, cheap model (Gemini Flash), so a new one is used without updating ClassDash.
- **Thinking**: none: ClassDash doesn't set how hard Gemini thinks.

## What it can do

- Read announcements for homework, and answer in the AI pane and the Grades center.
- Look up your assignments, instructions, announcements and PDFs by itself while answering.
- See images.

## Privacy

Google gets a copy of what ClassDash sends it: announcement text, class names (and teacher names where they're part of one), and whatever it looks up for an answer. It's handled under Google's privacy policy, not ClassDash's.

On Gemini's free tier, Google uses what you send to improve its products, and people may read it. The paid tier doesn't.

## Known limitations

- On the paid tier, each question costs a little, paid to Google. The free tier has limits, and Google trains on what you send.

## Troubleshooting

- **The Test fails:** check the key, and the free tier's limits or your billing.

## Turning it off

Pick another AI in the picker, or untick its box in Settings → **AI**: a cloud AI is never used without it. Clearing the key works too.

## Details

| | |
|---|---|
| **Introduced** | v2.5.0 |
| **Runs** | In the cloud (Google) |
| **Platforms** | Mac and Windows |
| **Cost** | Paid per use, or a free tier that Google trains on |
| **Sees images** | Yes |
| **Thinking** | No |
| **Looks things up** | Yes |
| **Age rule** | 18+ |
| **Code owners** | None yet |
