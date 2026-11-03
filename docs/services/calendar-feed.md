# Calendar feed

ClassDash can read your school's calendar from a calendar feed: the link your school gives for adding its calendar to a phone or Google Calendar. Its days off, minimum days and events then show in the calendar on the dashboard, and work with no due date counts as due the next school day.

## Before you start

The feed's link, starting with `https://` or `webcal://`. Schools usually show it next to their calendar as "Subscribe", "Add to calendar" or "ICS".

## Setting it up

1. Settings → **Calendar** (or Settings → **Services** → **+ Add service** → **Calendar feed (ICS)**, which opens the same place).
2. Paste the link and click **Save link**.
3. Under **What the feed's events mean**, pick what each kind of event means: **No school**, **Minimum day**, **Event**, or **Hide**. ClassDash guesses from each event's name first ("Winter break" is No school, "Early release" a Minimum day) and keeps what you pick.

Once there's a feed, it gets a card in Settings → Services too, which opens Settings → Calendar.

## Options

- **What the feed's events mean**: one choice for each kind of event in the feed.
- **Read again**: reads the feed now instead of waiting for the next day.

## What it reads

The feed's events, from a year back to two years ahead. Your school's calendar PDF and the days you changed by hand work alongside it; see [Calendar and schedule](../calendar.md).

## How often it checks

Once a day, or now with **Read again**.

## How it's read

ClassDash downloads the feed and reads it. A calendar feed (ICS) is a standard format made for other apps to read, so this is the official way.

## Troubleshooting

- **"Couldn't read it":** check that the link is the feed itself (it starts with `https://` or `webcal://` and downloads a calendar file), not the page that shows the calendar.

## Turning it off

Clear the link in Settings → Calendar and click **Save link**. ClassDash forgets the feed, and its card leaves Settings → Services.

## Code

For contributors; how ClassDash works inside is in [CONTRIBUTING.md](../../CONTRIBUTING.md).

- [`34-calendar-ics.js`](../../src/34-calendar-ics.js) downloads and reads the feed, with no dependency: ICS is plain text.
- [`33-school-calendar.js`](../../src/33-school-calendar.js) keeps the events, guesses what each kind of event means, and keeps the meanings the person picks.

## Details

| | |
|---|---|
| **Categories** | Calendar |
| **Introduced** | v2.3.0 |
| **Communication class** | [Cloud Polling](../services.md#communication-classes) |
| **Code owners** | [@vemboy200](https://github.com/vemboy200) |
| **Browser class** | [No browser](../services.md#browser-classes) |
