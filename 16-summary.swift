// "Summary" — a real window for the school digest. Not a browser.
//
// ── Why not Chrome ──
//
// The simpler option was tried first: Chrome can open a page in app mode
// (the --app flag) — a window with no tabs and no address bar.
// Didn't work: when Chrome is already running, a second launch doesn't
// create a new browser, it hands the address to the one already open —
// and command-line flags get DROPPED in the process. You end up with an
// ordinary tab.
//
// That is, behavior depends on whether Chrome happens to be open already.
// That's not something to keep in a system: working half the time means
// not working.
//
// Here the window is drawn by the program itself (WKWebView — the same
// engine Safari uses). Chrome isn't needed at all, and there are no tabs
// by definition.
//
// ── Building it ──
//     swiftc -O -o Summary.app/Contents/MacOS/Summary 16-summary.swift
//     codesign --force -s - Summary.app
// Full details — see 02-что-выяснили.md, the section on the standalone window.

import Cocoa
import WebKit

// THE PROJECT PATH ISN'T HARDCODED.
//
// The notifier finds its own folder easily -- it lives right inside it.
// Summary can't do that: its copy lives in /Applications, so Quick
// Actions can list it and a keyboard shortcut can be bound to it.
//
// So the path gets written into Info.plist at build time (see
// `build.sh`), and only read here. The source keeps no trace of anyone's
// home folder or username -- the project can be published as-is.
//
// Three attempts in order, from precise to desperate.
let projectDir: String = {
    // 1. Whatever the build script wrote in.
    if let fromPlist = Bundle.main.object(forInfoDictionaryKey: "ProjectPath") as? String,
       !fromPlist.isEmpty,
       FileManager.default.fileExists(atPath: fromPlist + "/summary.html") {
        return fromPlist
    }

    // 2. Next to the app itself -- in case it wasn't copied to /Applications.
    let nextToApp = Bundle.main.bundleURL.deletingLastPathComponent().path
    if FileManager.default.fileExists(atPath: nextToApp + "/summary.html") {
        return nextToApp
    }

    // 3. Not found. Falls back to "next to the app" -- the window will
    //    show a blank page, and that's more honest than opening someone
    //    else's summary from a guessed path.
    return nextToApp
}()
let pagePath = projectDir + "/summary.html"

/// Records what the window did with a link, next to the notifier's own log.
///
/// THE WINDOW IS AS SILENT AS THE NOTIFIER WAS.
///
/// Launched from the Dock or Finder, this app has nowhere to print: any
/// error it hits goes into a void. The gap that mattered was the
/// handoff itself -- the page asks for a napominalka:// URL, this code
/// passes it to macOS, and whether macOS actually did anything with it
/// was never recorded. When it silently refused, the result was a
/// button that did nothing, with every visible part of the chain
/// looking perfectly healthy.
func logWindow(_ text: String) {
    let line = "\(ISO8601DateFormatter().string(from: Date()))  \(text)\n"
    let path = projectDir + "/window-log.txt"
    guard let data = line.data(using: .utf8) else { return }
    // Appends if it can, creates if it can't, and gives up quietly
    // rather than letting logging be the thing that breaks a click.
    if let handle = FileHandle(forWritingAtPath: path) {
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: data)
    } else {
        try? line.write(toFile: path, atomically: true, encoding: .utf8)
    }
}

class Delegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!

    // WHEN THE LAST napominalka:// HANDOFF HAPPENED.
    //
    // Handing a URL to the system launches the notifier, which means THIS
    // app stops being the active one for a moment. When the notifier
    // finishes (a fraction of a second later) and quits, this app becomes
    // active again — and applicationDidBecomeActive used to reload the
    // page right then, unconditionally.
    //
    // That reload was silently eating every settings save. The page sets
    // "Saved. Checking now…" and starts a 30-second timer to refresh
    // itself once the collection has actually finished — and the reload
    // destroyed both, about a fifth of a second later. What was left was
    // the OLD summary.html (the new collection needs ~17 seconds to
    // produce a new one), with no message and no pending refresh. From
    // the outside that looks exactly like the button doing nothing at
    // all, which is precisely how it was reported, three times.
    //
    // This never showed up when the same clicks were driven
    // programmatically for testing: that path didn't move focus away, so
    // the reload never fired and the save looked fine every time.
    var lastHandoff: Date?

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1150, height: 850),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "SHREK School Software"
        window.center()
        // Remembers the window's size and position between launches.
        window.setFrameAutosaveName("SummaryWindow")

        // THERE'S NO TOOLBAR WITH A BUTTON HERE, AND THAT'S DELIBERATE.
        //
        // The "Refresh" button used to live right here, its own bar at the
        // top of the window. The user asked for it to move onto the page
        // itself and be made small, like in a browser. Better this way:
        // the window doesn't lose 38 points of height, and the button
        // shows up in a browser tab too, if the summary is ever opened
        // the ordinary way.
        //
        // There it's just a regular link-button with location.reload() —
        // the window doesn't need to do anything for that to work.
        web = WKWebView(frame: window.contentView!.bounds)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self

        // THE PAGE'S OWN ERRORS ARE INVISIBLE IN HERE.
        //
        // In a browser a broken script says so in the console. This
        // window has no console, so a script that dies on line one looks
        // exactly like a script that ran perfectly and had nothing to
        // do — every button simply stops responding, silently. That cost
        // several rounds of fixing things that were never broken.
        //
        // This makes the window inspectable from Safari's Develop menu
        // (Develop -> the machine's name -> SHREK School Software), which
        // gives a real console and breakpoints on the actual page as it
        // runs here, rather than a copy of it opened in a browser where
        // the bug doesn't happen.
        if #available(macOS 13.3, *) {
            web.isInspectable = true
        }

        window.contentView!.addSubview(web)

        show()

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func show() {
        let url = URL(fileURLWithPath: pagePath)
        // The second parameter is which folder is allowed to be read.
        // Without it WKWebView won't access the file at all.
        web.loadFileURL(url, allowingReadAccessTo: URL(fileURLWithPath: projectDir))
    }

    // The summary gets rewritten every ten minutes. Coming back to the
    // window, it should show what's fresh, not what it was this morning.
    //
    // UNLESS the window only just lost focus because it handed a
    // napominalka:// URL to the notifier — see lastHandoff. In that case
    // becoming active again isn't "the user came back later", it's the
    // tail end of a button press, and the page is mid-action: it's
    // showing a status message and waiting on its own timer to refresh
    // once the work is actually done. Reloading on top of that throws
    // away both.
    //
    // 45 seconds covers the page's own 30-second refresh timer with
    // margin. After that this goes back to reloading normally: a real
    // "came back to the window an hour later" still gets fresh data.
    func applicationDidBecomeActive(_ notification: Notification) {
        guard web != nil else { return }
        if let handoff = lastHandoff, Date().timeIntervalSince(handoff) < 45 {
            return
        }
        show()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ application: NSApplication) -> Bool {
        return true
    }

    // OUTGOING LINKS ARE HANDED TO THE SYSTEM, NOT OPENED INSIDE.
    //
    // Two reasons. A Classroom assignment needs a school account — the
    // user has one in Chrome, and this window has no sign-in at all.
    // And the "not urgent" and "hide" buttons are napominalka:// links,
    // which the notifier has to catch, not the window.
    func webView(_ web: WKWebView,
                 decidePolicyFor action: WKNavigationAction,
                 decisionHandler decision: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else {
            logWindow("navigation with no URL at all — allowed")
            decision(.allow)
            return
        }
        logWindow("navigation: \(url.scheme ?? "no-scheme") type=\(action.navigationType.rawValue)")
        // napominalka:// is caught BY SCHEME, not by navigation type: a
        // long press on the "reload" button sets the address from the
        // page's own code, and its type isn't "a link was clicked" but
        // "navigated for another reason".
        //
        // The summary itself (file://) loads inside the window,
        // everything else goes out.
        if url.scheme == "napominalka" ||
           (action.navigationType == .linkActivated && !url.isFileURL) {
            // Noted BEFORE opening: the app can lose and regain focus
            // before this line would otherwise finish, and
            // applicationDidBecomeActive reads this to tell "the user
            // came back to the window" apart from "the notifier just
            // handed focus back". Set for outgoing links too — clicking
            // an assignment switches to the browser and back the same
            // way, and a reload there is just as unwanted.
            lastHandoff = Date()
            // THE RETURN VALUE IS THE WHOLE POINT.
            //
            // This used to be discarded. macOS returns false when it
            // won't open the URL -- no handler registered, the handler
            // refused to launch -- and discarding that turned a refusal
            // into a button that did nothing, indistinguishable from a
            // click that never happened.
            let opened = NSWorkspace.shared.open(url)
            logWindow("  handed to macOS: \(url.scheme ?? "?") -> " +
                      (opened ? "accepted" : "REFUSED (no handler, or it would not launch)"))
            decision(.cancel)
            return
        }
        decision(.allow)
    }
}

let application = NSApplication.shared
let delegate = Delegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
