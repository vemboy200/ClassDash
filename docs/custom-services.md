# Custom services

ClassDash can read a school service it doesn't know about, through a **custom service**: a small folder of code you add to your ClassDash project yourself, the way Home Assistant has custom integrations. It shows up in Settings → **Services** with a card and a status dot like the built-in ones, and what it reads is on the dashboard next to everything else.

> [!WARNING]
> A custom service is code that runs on your computer with the same access as ClassDash: your settings, your sign-ins and your files. Only add one you wrote yourself or trust completely.

## Adding one

1. Open your ClassDash project folder (the one with `settings.json` in it).
2. Make a folder called `custom_services`, and in it a folder for the service. The folder's name is the service's **domain**: lowercase letters, digits and `_` only, like `homework_club`.
3. Put the service's `manifest.json` and `index.js` in that folder (below).
4. Run a check. The service has a card in Settings → Services from the next time the page is drawn.

To turn a custom service off, remove its folder. It can't have the same domain as a built-in service (`classroom`, `canvas`, `edpuzzle`, `q`, `calendar`): a custom service adds a service, it doesn't replace one.

## manifest.json

The same fields as a built-in service's, which are the **Details** table on its page (see [Services](services.md#what-the-details-on-each-page-mean)), plus a `version` of its own:

```json
{
  "domain": "homework_club",
  "name": "Homework Club",
  "version": "1.0.0",
  "categories": ["assignments"],
  "introduced": "3.0.0",
  "communication_class": "cloud_polling",
  "browser_class": "none",
  "codeowners": [],
  "documentation": "https://example.com/homework-club-for-classdash"
}
```

- `name` can also be translated: `{ "en": "Homework Club", "ru": "Кружок" }`.
- `introduced` is the ClassDash version you wrote it for.
- `browser_class`: `none` if it doesn't need ClassDash's browser, `background` if it reads pages in it (no window), `visible` if it needs a window (then it's only read in a full check, like Edpuzzle), `optional` if it decides each time (its `browserNeeded()` says).
- `documentation`: when it's an `https://` address, the service's page in Settings links to it.
- `"runs": "background"` reads it in a process of its own after each check instead of during it, for something slow.

A manifest with a mistake in it is skipped, with the reason in ClassDash's log (`runs.log` in the project folder on a Mac). Nothing else is affected.

## index.js

The only file ClassDash calls. It exports a `read` function, and optionally `enabled`, `browserNeeded` and `addresses`. Each one gets a `bridge` object:

- `bridge.settings`: ClassDash's settings.
- `bridge.openPage()`: in `read`, a new tab of ClassDash's signed-in browser (a [Playwright page](https://playwright.dev/docs/api/class-page)), for a service whose browser class isn't `none`. Close it when you're done.
- `bridge.log(text)`: a line in ClassDash's log.

```js
module.exports = {
  // Optional: false turns it off (default: on).
  enabled: bridge => true,

  // Optional: where it is, so a check with no internet can say so.
  addresses: bridge => ['https://example.com/'],

  // What it found. Throwing an error marks it as failed.
  read: async bridge => {
    const response = await fetch('https://example.com/my-assignments.json');
    if (!response.ok) throw new Error(`the site answered ${response.status}`);
    const list = await response.json();
    return {
      items: list.map(a => ({
        id: String(a.id),
        title: a.name,
        type: 'Assignment',
        class: a.subject,
        due_iso: a.dueDate,
        link: a.url,
      })),
    };
  },
};
```

Each item:

| Field | |
|---|---|
| `title` | required; an item without one is left out |
| `id` | its id in that service; ClassDash puts the domain in front (`homework_club-17`) so it can't collide with anything else |
| `type` | `Assignment`, or `Material` for something to read with no due date |
| `class` | the class it's for; the service's name if left out |
| `due_iso` | when it's due, as an ISO date (`2026-11-20T23:59:00Z`), or `null` |
| `link` | where to open it |
| `description` | the teacher's instructions, for the Instructions drop-down and the AI |

`read` can also return `status: { detail: 'Read 12 assignments' }`, shown next to its dot. For now ClassDash uses the items from a custom service: announcements, grades and calendar events from one aren't shown yet.

## When it fails

- `read` throws, or takes longer than 2 minutes: its dot in Settings and the status cloud goes red with the reason, and its items from the last check stay on the dashboard. The rest of the check isn't affected.
- `index.js` itself fails to load: the service is skipped, with the reason in the log.
