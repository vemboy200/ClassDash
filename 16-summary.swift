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

class Delegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!

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
    func applicationDidBecomeActive(_ notification: Notification) {
        if web != nil { show() }
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
            decision(.allow)
            return
        }
        // napominalka:// is caught BY SCHEME, not by navigation type: a
        // long press on the "reload" button sets the address from the
        // page's own code, and its type isn't "a link was clicked" but
        // "navigated for another reason".
        //
        // The summary itself (file://) loads inside the window,
        // everything else goes out.
        if url.scheme == "napominalka" ||
           (action.navigationType == .linkActivated && !url.isFileURL) {
            NSWorkspace.shared.open(url)
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
