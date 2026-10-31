# Troubleshooting

**macOS says the app is "damaged" or from an "unidentified developer."** Expected — see [Download and install](getting-started.md#1-download-and-install) above for the right-click → Open workaround.

**Windows says "Windows protected your PC."** Also expected, same underlying reason (no paid signing certificate) — click **More info** → **Run anyway**.

**Notifications never show up.** On macOS, this almost always means the manual System Settings grant hasn't been done — macOS doesn't prompt for it on its own. **On Windows, this is currently expected, not a bug to chase**: desktop notifications (new assignments, a "you got signed out, sign in again" alert) haven't been built for Windows yet — the app still works and collects normally, there's just nothing that pops up to tell you about it. Check the page itself, or the little status dots next to the gear icon, instead.

**A full check or a save is stuck / did nothing (macOS).** The first one after install may be waiting on the App Management permission prompt — check System Settings → Privacy & Security.

**On Windows, the home API shows as enabled but doesn't seem to be running** — most likely after reinstalling the app or letting it self-update. Reopening ClassDash starts it again. If it still isn't running, toggle **Enable home API** off, Save, back on, Save again — that forces a fresh restart of the server process.

**A school sign-in doesn't work in a workspace web pane.** A known limitation for now: some school sign-ins (SSO), especially link hubs that open each app signed in, don't finish in a web pane. Use your usual browser for those sites.

**Something in the code itself is misbehaving**, or you want to understand *why* something works the way it does — that detail lives in [CONTRIBUTING.md](../CONTRIBUTING.md), not here.
