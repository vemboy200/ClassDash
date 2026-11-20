# Your data and how ClassDash gets it

ClassDash handles school accounts, grades and class information, so you should know exactly where that goes. The short version: everything stays on your own computer, ClassDash has no server or account of its own, and the developer never sees your data. ClassDash is open source (AGPL-3.0), so anyone can check every claim on this page against the code.

## ClassDash is unofficial

ClassDash isn't made, approved or supported by Google, Instructure (Canvas), Aequitas or Edpuzzle, or by your school. Here's how it reads each one:

- **Canvas** can use its official API with an access token you create yourself in Canvas. It can also read Canvas through your school sign-in, the same way as the services below.
- **Google Classroom, Edpuzzle and Aequitas Q** have no API ClassDash can use, so it reads the same pages you see when you're signed in, in a browser on your computer. It only reads. It never turns in, changes or deletes anything.

What that means for you:

- **It can break.** When a site changes its pages, ClassDash may stop reading it until it's updated. The status on the dashboard tells you when a service couldn't be read, instead of showing old data as new.
- **Your school's rules still apply.** Some schools or districts have rules about automated access to their systems. If you're unsure, ask. ClassDash only reads your own account, on a schedule you control, but it can't decide for you whether that's allowed where you are.

This is the same approach many Home Assistant integrations take for devices without an official API: read what's already yours, and say openly that it's unofficial.

## What's stored, and where

Everything lives in the ClassDash folder you picked on first run, plus the macOS keychain.

| What | Where | Notes |
|---|---|---|
| Your school sign-ins (Google, Edpuzzle, Canvas through your school) | `browser-profile` in the ClassDash folder | A browser profile like any other, holding the sign-in cookies. ClassDash never sees or stores your Google password: you type it into Google's own page. |
| Aequitas Q password | macOS: your login keychain (item "ClassDash Q grades"). Windows: `grades-secret.json`, readable only by your user account | Never written to settings, logs or the page. On a Mac it goes to the keychain through standard input, so it never shows up in a process list. |
| Canvas access token, AI API keys | `settings.json` | Plain text. See "Limits" below. |
| Assignments, announcements, grades, grade history, classes | JSON files in the ClassDash folder | Only what ClassDash read from your accounts. |
| Home API token and certificate | `api-token.txt`, `api-key.pem` | Readable only by your user account. |

## Where ClassDash connects

ClassDash only connects to:

- **Your school services**, the ones you turned on, to read your schoolwork.
- **GitHub**, to check for and download ClassDash updates. This sends no personal data, only a normal request for the latest release.
- **An AI provider, only if you pick one.** See below.
- **Calendar feeds**, only addresses you add yourself.
- **Your own other computers**, only if you pair them. See below.
- **Websites you open yourself** in the workspace's web panes, the same as any browser.

There's no analytics, tracking or crash reporting. Diagnostics forwarding exists for testing, but it's off unless you enter another computer's address yourself, and it only sends to that computer.

## AI

ClassDash has no AI of its own, and nothing AI-related is on until you pick a provider.

- **Local AIs** (LM Studio, Ollama, Foundry Local, Apple Intelligence) run on your own computer. Your class text doesn't leave it.
- **Cloud AIs** (OpenAI, Anthropic, Google, Codex, Claude Code) receive the text you send them, under their own privacy policies. Before one works, ClassDash makes you tick a box that names the provider, its age rule, and that class text goes to it.
- **Grades are a separate choice.** A cloud AI only gets your grades and teacher comments if you also tick that provider in the Grades center. Agreeing for announcements doesn't cover grades.
- **Other AI apps** can only use ClassDash's tools if you turn that on in Settings, with grades as a separate switch again.

More in [Using AI with ClassDash](ai-use.md).

## Other computers and the Home API

- **The Home API** (used by the Home Assistant integration and your other computers) only listens on this computer until you turn on network access. When it's on, every request needs your API token, over HTTPS.
- **Pairing** lets another computer of yours show this one's dashboard and change its shared settings. Your sign-ins, the Canvas token and your Q username and password stay on the computer that does the checking. They're never sent to a paired computer.

## Limits, honestly

- **Anyone who can use your computer account can use your sign-ins.** The browser profile works like your normal browser: whoever can open your files could open your school accounts. Lock your computer.
- **`settings.json` isn't locked down yet.** It holds the Canvas token and any AI API keys in plain text, and other accounts on the same computer can currently read it. On a computer only you use, this matters less.
- **Cloud AIs follow their own rules.** Once you send something to OpenAI, Anthropic or Google, their privacy policy applies, not ClassDash's.

## Removing your data

1. Quit ClassDash.
2. Delete the ClassDash folder you picked on first run. That removes the sign-ins, the downloaded schoolwork and the settings.
3. On a Mac, open Keychain Access and delete "ClassDash Q grades", if you used Aequitas Q.
4. To cut off ClassDash's access completely, also sign out of other sessions in your Google account, and delete the access token in Canvas under Account → Settings, if you made one.
