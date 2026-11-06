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

Other devices also get the page's styling and main script as separate files a browser can keep, named after what's in them. Adding `?whole=1` to the address gets the whole page as one file instead.

## Pairing a device

Rather than copying the long access key to every phone and laptop, each device can get a key of its own. In the app, **Settings → API → Pair a Device** shows a short code like `K7M-4QX`. Type it on ClassDash's sign-in page on the other device, and that browser is signed in with its own key. It shows up under **Devices** in Settings → API, named after it ("Safari on iPhone"), with when it was paired and last used.

- A code works **once**, for **10 minutes**, and stops working after 5 wrong tries. By itself it can't read anything; all it can do is become a key.
- **Remove** a device in Settings → API, and it's signed out on its next request, without touching anything else. Signing out on a paired browser removes its key too.
- A paired device **never sees the access key**: it's taken out of the page it gets, so a removed device can't keep access with a copy.
- Rolling the access key doesn't sign paired devices out. The access key itself keeps working as before, so Home Assistant needs no changes.
- Pairing a device and removing one only work in the app on the computer running the server, like LAN access and rolling the key.

A program can pair too: `POST /api/pair` with `{"code": "K7M-4QX", "name": "My script"}`, no key needed, answers `{"key", "id", "name", "fingerprint"}`. Use the key as the bearer token from then on, and check that the fingerprint matches the certificate you were just shown before trusting it.

Almost everything works the same as in the app. What needs the app itself stays there: the workspace, picking files (like a calendar PDF), signing in to a service's browser window, and turning LAN access on or off.

There's a Home Assistant integration that reads it: [ha-classdash](https://github.com/vemboy200/ha-classdash).
