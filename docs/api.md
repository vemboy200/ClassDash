# API

ClassDash runs a small HTTPS server on your own computer, so the data can go somewhere else, like a Home Assistant dashboard or a browser, and so you can hide an assignment or start a check from somewhere other than this window. Settings → API shows whether it's running, an **Allow LAN access** switch (see below), an **access key** (masked, with Copy and Roll buttons — Roll generates a brand new one and immediately cuts off the old one, for if a key ever leaks), and a **certificate fingerprint**, the last two both needed to configure whatever's going to read from it.

The server runs as long as ClassDash does, including with its window closed: ClassDash then stays in the menu bar (Mac) or the tray (Windows), whose icon says whether the server is running. **Quit ClassDash** there stops it. Only **this computer can reach it** until you turn on **Allow LAN access**. Turn it on for anything on another device, like Home Assistant or a phone. It's still encrypted and needs the access key, but a laptop goes to school and public Wi-Fi too, so only turn it on if you trust the networks it joins. If you had the Home API on and on the network before v3, LAN access is already on.

Most of it is read-only — the same data this window shows, grades included: each class in `/api/classes` carries the grade it goes by, so Home Assistant can show and graph it, and `/api/grades` has every place's. A few handles change something instead: hiding or un-hiding an assignment, marking one not urgent and back, changing a display setting, starting a check (a quick one or a full one), or stopping one that's running. Every one of those needs `POST` instead of a plain request, and does exactly what the matching button on this page does — nothing a client with the access key couldn't already do by hand from here. The full list of handles, and what to send each one, is in [CONTRIBUTING.md](../CONTRIBUTING.md#api--technical-detail).

With **Allow LAN access** on, ClassDash also announces itself on your home network (mDNS, the same thing printers and AirPlay speakers use), as "ClassDash on" your computer's name. Home Assistant can find it that way without you typing an address, and follow it when your computer's address changes. You still check the fingerprint and paste the access key yourself. The announcement holds the port and the certificate fingerprint, never the access key. It reaches Home Assistant when Home Assistant is on the same network (Home Assistant OS, or Docker with host networking); otherwise, type the address as before. A VPN on the computer running ClassDash, like Cloudflare WARP, can keep the announcement from reaching the network while it's on.

## ClassDash in a browser

The API also serves the ClassDash page itself, so you can open it in a browser instead of the app: on the same computer at `https://127.0.0.1:8734`, or from another device on your network at `https://` your computer's address `:8734` with **Allow LAN access** on (typing `http://` by mistake sends you to `https://`, and nothing is served over plain http). The first time, the browser warns that the certificate isn't trusted, because it's ClassDash's own (check that the fingerprint matches the one in Settings → API). Then sign in once, and the browser remembers it: either with a **pairing code** (see below), or by pasting the access key. Rolling the access key signs out every browser that used it.

The app's own window shows ClassDash from this same server: it signs itself in with a key of its own (not the access key, and never shown), so rolling the access key signs out browsers and other devices but not the app.

If the page can't reach the server (it stopped, or the connection is weak), a bar across the top says so and it keeps trying; in the app, the server is started again by itself. When the app's window opens and the server isn't answering yet, it shows a loading wheel; if the server still can't be reached after a few seconds, the window shows the last saved copy of the page, with a bar saying so, and switches to the live page as soon as the server is back.

To other devices, the server compresses the page, its files and API answers when the client asks for gzip (browsers do this by themselves), which takes the page from about 1 MB to about 170 KB. A browser's `/api/stream` is compressed too, but a program reading it with an `Authorization` header always gets it plain. Nothing is compressed for clients on the same computer.

Each page has its own address: `/dashboard`, `/workspace`, `/grades`, `/settings`, a section like `/settings/api`, and a service's page like `/settings/services/canvas`.

Other devices also get the page's styling and main script as separate files a browser can keep, named after what's in them. Adding `?whole=1` to the address gets the whole page as one file instead.

The page itself no longer carries your schoolwork: the server sends it without its cards, and it gets them from `/api/dashboard` (`{rev, shell, view}`). A browser asks whether the page has changed before downloading it again, and it usually hasn't. After that, `/api/stream?view=dashboard` sends only what changed, as `dash` events, and only the cards that changed are redrawn, so nothing has to reload after a check. Programs like Home Assistant keep the plain `/api/stream` as it was. The file on disk that the apps fall back on when the server can't be reached still has everything in it.

## Pairing a device

Rather than copying the long access key to every phone and laptop, each device can get a key of its own. In the app, **Settings → API → Pair a Device** shows a short code like `K7M-4QX`. Type it on ClassDash's sign-in page on the other device, and that browser is signed in with its own key. It shows up under **Devices** in Settings → API, named after it ("Safari on iPhone"), with when it was paired and last used.

- A code works **once**, for **10 minutes**, and stops working after 5 wrong tries. By itself it can't read anything; all it can do is become a key.
- **Remove** a device in Settings → API, and it's signed out on its next request, without touching anything else. Signing out on a paired browser removes its key too.
- A paired device **never sees the access key**: it's taken out of the page it gets, so a removed device can't keep access with a copy.
- Rolling the access key doesn't sign paired devices out. The access key itself keeps working as before, so Home Assistant needs no changes.
- Pairing a device and removing one only work in the app on the computer running the server, like LAN access and rolling the key.

A program can pair too: `POST /api/pair` with `{"code": "K7M-4QX", "name": "My script"}`, no key needed, answers `{"key", "id", "name", "fingerprint"}`. Use the key as the bearer token from then on, and check that the fingerprint matches the certificate you were just shown before trusting it.

A wrong code or key from another device counts toward a limit of 10 a minute per address, after which `/login` and `/api/pair` answer 429 with `Retry-After`.

## Sync between two computers

**Settings → Sync** pairs two ClassDash computers. One is the master, which does the checking; the other follows it, keeps its own copy, and still works when it can't reach the master. A computer can follow one master, a master can have several followers, and a follower can't be followed.

To set it up, turn on **Allow LAN access** on the master, make a pairing code in its Settings → Sync, and enter it on the other computer. You're then asked which should be the master. Choosing the computer you typed the code on needs a yes on the other computer (and needs **Allow LAN access** on the first), since it's the other one's data that would be replaced.

- **What's copied:** assignments, announcements and their photos, grades, the calendar and schedule, reminders, what's hidden or muted or linked, and a few shared settings like excluded classes and linked classes.
- **What stays on each computer:** sign-ins, the Q password, API and AI keys, the access key, the language, the port, and anything about its window or browser. The workspace's PDFs and AI chats aren't copied yet.
- **While connected,** what you do on the follower happens on the master: hiding, reminders, shared settings, starting or stopping a check. Automatic checks are the master's job.
- **While cut off,** the follower uses its own copy, and its own automatic checks run if they're turned on. Changes wait and go across on reconnecting, oldest first; the master's data then replaces what's on the follower, so a change to the same thing on both ends up the master's. Importing a calendar PDF has to be done on the master.
- **Your own data isn't lost.** What was on the follower is kept aside when it starts following, and **Stop following** can put it back.
- **Different accounts:** the two compare a fingerprint of the school email and Canvas address (never the address itself). A difference is pointed out when pairing and needs a deliberate choice to continue. Copying stops if the master later changes accounts, and the follower won't check on its own under a different account than the master's. This compares what's set up in Settings, not what's actually signed in.

### Away from home

A follower can keep a second address, such as a [Cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). It tries the home address first, by the last one that worked or by what the network announces with the master's certificate fingerprint, and the second address 300 ms later. While using the second address it keeps looking for home.

The tunnel can run anywhere that can reach the master, like a NAS. Point it at `https://<the master's address>:8734` with `noTLSVerify: true`, since the master's certificate is self-signed; on the home network the follower pins that certificate itself. Traffic through a tunnel is decrypted at Cloudflare, so Cloudflare could read your schoolwork and keys there.

### The routes

All need a key, except that a follower gets its key from `POST /api/pair` by adding `"follower": true`, which also answers the certificate (`cert`), and answers 409 from a computer that follows another.

| Route | What it does |
|---|---|
| `GET /api/sync/hello` | `{name, fingerprint, lastCheck, assignments, announcements, following, account}` |
| `GET /api/sync/manifest` | `{version, files: {name: {hash, size, mtimeMs}}, settings, collectedWith}` |
| `GET /api/sync/file?name=` | One file from the manifest. Anything else is 404. |
| `GET /api/sync/stream` | Server-sent events: `changed` with `{version}`, and a `ping` every 20 seconds |
| `POST /api/sync/propose` | Asks this computer to follow the one asking: `{name, urls, code}` |
| `POST /api/sync/leave` | Removes the caller's own device key |

Almost everything works the same as in the app. What needs the app itself stays there: the workspace, picking files (like a calendar PDF), signing in to a service's browser window, and turning LAN access on or off.

There's a Home Assistant integration that reads it: [ha-classdash](https://github.com/vemboy200/ha-classdash).
