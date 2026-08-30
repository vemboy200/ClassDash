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

class Delegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var web: WKWebView!

    // WHEN THE LAST OUTGOING LINK WAS HANDED TO macOS.
    //
    // Handing a URL to NSWorkspace launches whatever app owns it, which
    // means THIS app stops being the active one for a moment; when the
    // other app quits or the user comes back, this one becomes active
    // again — and applicationDidBecomeActive used to reload the page
    // right then, unconditionally.
    //
    // That used to eat every settings save: the page would set "Saved.
    // Checking now…" and start a 30-second timer to refresh itself once
    // the collection finished, and the reload destroyed both a fraction
    // of a second later, before the collection was anywhere near done.
    // Save, hide, and check no longer go through NSWorkspace at all —
    // they go straight through the bridge below, which never moves focus
    // away, so that race can't happen for them anymore.
    //
    // What's left needing this guard is only genuine outgoing links —
    // "open in Classroom", and the napominalka:// fallback used when this
    // page is opened as a plain browser tab instead of in this window.
    // Those really do send focus elsewhere, so the guard stays.
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
        // THE BRIDGE, REPLACING THE napominalka:// CHAIN FOR THIS WINDOW.
        //
        // The old path for every button on the page was: page sets
        // location.href to a napominalka:// URL -> macOS Launch Services
        // finds the app that registered that scheme -> a SEPARATE
        // AppleScript app launches -> it runs `do shell script` -> which
        // finally runs node. Four handoffs to write one settings file,
        // and the second-to-last one (`do shell script`'s own stripped
        // PATH not containing Homebrew's node) silently broke every
        // single button in this app for an entire evening, because
        // nothing along that chain had any way to report a failure back.
        //
        // A WKScriptMessageHandler lets the page hand an action straight
        // to THIS process instead — one hop, no separate app, no Launch
        // Services round trip, and this process controls its own PATH
        // directly rather than inheriting whatever launched it. See
        // userContentController(_:didReceive:) below for the receiving
        // end, and 08-page.js's dispatchAction() for the sending end.
        //
        // Must be registered on the configuration BEFORE the WKWebView is
        // created — adding it afterward doesn't work.
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "shrek")

        web = WKWebView(frame: window.contentView!.bounds, configuration: config)
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

    // MARK: - Bridge

    // RECEIVES ONE ACTION FROM THE PAGE, RUNS IT, AND ANSWERS BACK.
    //
    // The message body is {id, action, arg} — see dispatchAction() in
    // 08-page.js. `id` only ever means something to the page itself (it's
    // how the page matches this reply back to the JS callback that asked
    // for it); this process just carries it there and back unread.
    func userContentController(_ userContentController: WKUserContentController,
                                didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let requestId = body["id"] as? String,
              let action = body["action"] as? String else {
            logWindow("bridge: message with an unexpected shape, ignored")
            return
        }
        let arg = (body["arg"] as? String) ?? ""
        logWindow("bridge: \(action) \(arg)")

        runAction(action, arg) { [weak self] resultJSON in
            self?.deliver(requestId: requestId, resultJSON: resultJSON)
        }
    }

    // Runs 21-notifier-actions.js exactly the way the AppleScript
    // notifier always has — same script, same arguments — the only
    // difference is WHO is running it and WHAT environment it gets.
    private func runAction(_ action: String, _ arg: String,
                            completion: @escaping (String) -> Void) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", projectDir + "/21-notifier-actions.js", action, arg]

        // THE SAME FIX AS THE APPLESCRIPT ONE, DONE THE WAY THIS PROCESS
        // ACTUALLY SUPPORTS.
        //
        // A launched-by-Finder/Dock app gets a minimal PATH too — the
        // AppleScript notifier's whole bug, rediscovered here would be
        // just as invisible. The difference is this process sets its
        // OWN child's environment directly; there's no separate app in
        // between to inherit a stripped one from.
        var env = ProcessInfo.processInfo.environment
        let existingPath = env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + existingPath
        process.environment = env

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        process.terminationHandler = { proc in
            // Runs on an arbitrary queue, not necessarily main — reading
            // the pipes here is fine (no UI touched yet), but deliver()
            // hops back to main before it touches the web view.
            let outData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
            let errData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
            let out = String(data: outData, encoding: .utf8) ?? ""
            let err = String(data: errData, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

            // 21-notifier-actions.js's contract: one JSON object as the
            // LAST line of stdout, always, success or failure — see its
            // own CLI entry point for why. Anything else (empty stdout,
            // a nonzero exit) is a failure this process didn't cause and
            // can't parse its way around, so it's reported as one
            // instead of guessed at.
            let lastLine = out.split(separator: "\n", omittingEmptySubsequences: true)
                .last.map(String.init)

            if proc.terminationStatus == 0, let line = lastLine, !line.isEmpty {
                completion(line)
            } else {
                let why = err.isEmpty
                    ? "node exited with status \(proc.terminationStatus) and no output"
                    : err
                logWindow("  bridge action '\(action)' FAILED: \(why)")
                completion(Delegate.failureJSON(why))
            }
        }

        do {
            try process.run()
        } catch {
            let why = "could not launch node: \(error.localizedDescription)"
            logWindow("  bridge action '\(action)' FAILED: \(why)")
            completion(Delegate.failureJSON(why))
        }
    }

    // Hands the result back to the exact page that asked for it, as a
    // real JS object — not a string the page has to parse itself.
    private func deliver(requestId: String, resultJSON: String) {
        let idLiteral = Delegate.jsStringLiteral(requestId)
        let script = "window.shrekBridgeResult && window.shrekBridgeResult(\(idLiteral), \(resultJSON));"
        DispatchQueue.main.async {
            self.web.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    private static func failureJSON(_ why: String) -> String {
        let obj: [String: Any] = ["ok": false, "why": why]
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let text = String(data: data, encoding: .utf8) else {
            return "{\"ok\":false}"
        }
        return text
    }

    // Turns a plain Swift string into a safe JS string literal. Only
    // ever used for the request id, which the page generated itself
    // (see 08-page.js) as a simple token like "r7" — escaped properly
    // anyway rather than assumed safe.
    private static func jsStringLiteral(_ s: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [s]),
              let text = String(data: data, encoding: .utf8) else {
            return "\"\""
        }
        return String(text.dropFirst().dropLast())
    }

    // OUTGOING LINKS ARE HANDED TO THE SYSTEM, NOT OPENED INSIDE.
    //
    // A Classroom assignment needs a school account — the user has one
    // in Chrome, and this window has no sign-in at all — so those always
    // need to leave. napominalka:// links are different: the page's own
    // dispatchAction() now prefers the bridge above and shouldn't be
    // producing these anymore for save/hide/quiet/check. This branch
    // stays as a fallback for the one case it wasn't written for — a
    // cached older page, or the bridge failing to register for some
    // reason — so a napominalka:// URL still does something instead of
    // just failing differently.
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
