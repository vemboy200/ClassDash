# Home API

ClassDash runs a small HTTPS server on your own computer, so the data can go somewhere else, like a Home Assistant dashboard or a browser, and so you can hide an assignment or start a check from somewhere other than this window. Settings → Home API shows whether it's running, an **Allow LAN access** switch (see below), an **access key** (masked, with Copy and Roll buttons — Roll generates a brand new one and immediately cuts off the old one, for if a key ever leaks), and a **certificate fingerprint**, the last two both needed to configure whatever's going to read from it.

The server always runs, but **only this computer can reach it** until you turn on **Allow LAN access**. Turn it on for anything on another device, like Home Assistant or a phone. It's still encrypted and needs the access key, but a laptop goes to school and public Wi-Fi too, so only turn it on if you trust the networks it joins. If you had the Home API on and on the network before v3, LAN access is already on.

Most of it is read-only — the same data this window shows, grades included: each class in `/api/classes` carries the grade it goes by, so Home Assistant can show and graph it, and `/api/grades` has every place's. A few handles change something instead: hiding or un-hiding an assignment, marking one not urgent and back, changing a display setting, starting a check (a quick one or a full one), or stopping one that's running. Every one of those needs `POST` instead of a plain request, and does exactly what the matching button on this page does — nothing a client with the access key couldn't already do by hand from here. The full list of handles, and what to send each one, is in [CONTRIBUTING.md](../CONTRIBUTING.md#home-api--technical-detail).

With **Allow LAN access** on, ClassDash also announces itself on your home network (mDNS, the same thing printers and AirPlay speakers use), as "ClassDash on" your computer's name. Home Assistant can find it that way without you typing an address, and follow it when your computer's address changes. You still check the fingerprint and paste the access key yourself. The announcement holds the port and the certificate fingerprint, never the access key. It reaches Home Assistant when Home Assistant is on the same network (Home Assistant OS, or Docker with host networking); otherwise, type the address as before. A VPN on the computer running ClassDash, like Cloudflare WARP, can keep the announcement from reaching the network while it's on.

## ClassDash in a browser

The Home API also serves the ClassDash page itself, so you can open it in a browser instead of the app: on the same computer at `https://127.0.0.1:8734`, or from another device on your network at `https://` your computer's address `:8734` with **Allow LAN access** on. The first time, the browser warns that the certificate isn't trusted, because it's ClassDash's own (check that the fingerprint matches the one in Settings → Home API). Then paste the access key once, and the browser remembers it. Rolling the key signs every browser out.

Almost everything works the same as in the app. What needs the app itself stays there: the workspace, picking files (like a calendar PDF), signing in to a service's browser window, and turning LAN access on or off.

There's a Home Assistant integration that reads it: [ha-classdash](https://github.com/vemboy200/ha-classdash).
