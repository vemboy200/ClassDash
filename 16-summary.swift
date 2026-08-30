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
import UserNotifications

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

// ── Notifications ──
//
// This used to be a SEPARATE app's job (SHREK Notifier.app, briefly,
// and Напоминалка.app before that), launched fresh every time something
// needed to appear. Now it's this app, one of two ways depending on
// whether this app is already running -- see notify() in
// 05-playwright-draft.js for why there have to be two:
//
//   - NOT running: launched fresh as `ClassDash --notify`
//     (see the bottom of this file), which sets .accessory and calls
//     runNotifyMode() below before any window gets created.
//   - ALREADY running (the window is open): reached via a
//     napominalka://notify open, the same Apple-Event path everything
//     else in the browser-tab fallback uses -- see handleGetURL. macOS
//     does NOT deliver a fresh set of command-line arguments to an
//     already-running single-instance app (confirmed directly: `open -a
//     ... --args --notify` against an already-running instance did
//     nothing at all, silently -- the file was never even read), so
//     --notify alone would make every notification fail exactly when
//     the summary window is left open, which is common. An Apple Event
//     reaches the existing process instead of trying to start a new one.
//
// Both paths call the same postPendingNotification() below -- reads
// уведомление.txt (three lines: title/subtitle/message), posts it, and
// deletes the file right after, same contract as always. Only what
// happens once it's done differs: --notify mode exits the process;
// already-running mode just lets the app carry on exactly as it was.
func postPendingNotification(onDone: @escaping () -> Void) {
    let notifyPath = projectDir + "/уведомление.txt"
    let content = (try? String(contentsOfFile: notifyPath, encoding: .utf8)) ?? ""
    // Deleted right away, same as before -- see the comment on
    // NOTIFY_FILE in 05-playwright-draft.js: leaving it around risks
    // the same text getting shown twice.
    try? FileManager.default.removeItem(atPath: notifyPath)

    guard !content.isEmpty else {
        // Nothing waiting to be shown -- not an error, the collector
        // calls this speculatively and there's often nothing to say.
        onDone()
        return
    }
    let lines = content.components(separatedBy: "\n")
    let title = lines[0]
    let subtitle = lines.count > 1 ? lines[1] : ""
    let body = lines.count > 2 ? lines[2] : ""

    let center = UNUserNotificationCenter.current()

    func post() {
        let notification = UNMutableNotificationContent()
        notification.title = title
        if !subtitle.isEmpty { notification.subtitle = subtitle }
        notification.body = body
        notification.sound = .default
        let request = UNNotificationRequest(identifier: UUID().uuidString,
                                             content: notification, trigger: nil)
        center.add(request) { _ in onDone() }
    }

    // ASKS FOR PERMISSION THE FIRST TIME, RATHER THAN ASSUMING IT AND
    // POSTING INTO THE VOID.
    //
    // `display notification` (the old AppleScript path) never checked
    // at all -- it silently defaulted to "off" the moment the app got
    // renamed, with no indication anything had failed. requestAuthorization
    // is the correct call to make here regardless, but confirmed live:
    // it did NOT surface a visible system prompt in testing -- the
    // first real notification here still needed a manual "Allow
    // notifications" toggle in System Settings -> Notifications, same
    // as before. Whatever the reason (a background-launched, windowless
    // process may not be a context macOS shows that prompt in), that's
    // the honest state of this today: still a manual first grant, not a
    // solved problem, just no longer routed through an app whose PATH
    // silently swallowed the request that got this far in the first
    // place.
    center.getNotificationSettings { settings in
        switch settings.authorizationStatus {
        case .authorized, .provisional:
            post()
        case .notDetermined:
            center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                if granted { post() } else { onDone() }
            }
        default:
            // Denied, or some other non-postable state -- nothing to
            // show, and not this process's job to explain why; System
            // Settings already does that if the user goes looking.
            onDone()
        }
    }
}

// The --notify entry point: window-less, one-shot, exits itself once
// postPendingNotification's async work actually finishes.
func runNotifyMode() -> Never {
    postPendingNotification { exit(0) }
    // postPendingNotification is entirely asynchronous, and this
    // function has to return Never -- so the run loop keeps this
    // process alive long enough for its completion handler to actually
    // fire and exit() itself. Without this the process would just quit
    // immediately, before a notification was ever scheduled.
    RunLoop.current.run()
    exit(0) // unreachable in practice; satisfies the Never return type
}

class Delegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
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

    // REGISTERED IN willFinishLaunching, NOT didFinishLaunching.
    //
    // A napominalka:// open (someone clicked hide/quiet/save from the
    // page loaded in a plain browser tab, with no window of this app
    // already up) can arrive as part of the SAME launch that's starting
    // right now -- macOS queues the "open URL" Apple Event for delivery
    // once the app is ready. Registering the handler here, before
    // launch actually finishes, is what makes sure it's ready in time
    // to catch that queued event instead of missing it.
    func applicationWillFinishLaunching(_ notification: Notification) {
        NSAppleEventManager.shared().setEventHandler(
            self,
            andSelector: #selector(handleGetURL(_:withReplyEvent:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL))
    }

    // THE REPLACEMENT FOR 07-notifier.applescript'S on open location.
    //
    // Used only when this page is opened as a plain browser tab instead
    // of in this window -- inside the window, dispatchAction() in
    // 08-page.js always prefers the bridge above instead. When it DOES
    // fire, this simply lets the launch become a normal one: the window
    // opens (or comes forward, if it was already open) AND the action
    // runs, via the exact same runAction() the bridge itself uses below.
    //
    // No attempt is made here to suppress the window for this case, on
    // purpose. That would mean answering "is this Apple Event about to
    // arrive as part of the CURRENT launch, or is it something else" —
    // and that's not knowable reliably: this event is delivered
    // asynchronously, on macOS's own schedule, and there is no safe
    // ordering guarantee against applicationDidFinishLaunching already
    // having built the window by the time this runs. Racing against
    // that would trade a working feature for an intermittent one to
    // save a window popping up in what's already an unusual, secondary
    // way to use this page.
    //
    // PARSED FROM THE RAW STRING, NOT A URL(string:). Mirrors
    // 07-notifier.applescript's dispatch() exactly, deliberately: ids
    // arrive percent-encoded and must reach 21-notifier-actions.js
    // exactly as sent, not decoded and re-encoded by a URL parser that
    // was never asked to do that.
    @objc func handleGetURL(_ event: NSAppleEventDescriptor, withReplyEvent: NSAppleEventDescriptor) {
        guard let raw = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue,
              let schemeRange = raw.range(of: "://") else {
            logWindow("handleGetURL: no usable URL in the event")
            return
        }
        let afterScheme = String(raw[schemeRange.upperBound...])
        let parts = afterScheme.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false)
        guard let first = parts.first, !first.isEmpty else {
            logWindow("handleGetURL: could not parse an action from \(raw)")
            return
        }
        let action = String(first)
        let arg = parts.count > 1 ? String(parts[1]) : ""

        // "notify" ISN'T A PAGE ACTION — it's how notify() in
        // 05-playwright-draft.js reaches an ALREADY-RUNNING instance
        // (see the comment on postPendingNotification above for why
        // that needs its own path). Handled directly here rather than
        // through runAction()/21-notifier-actions.js: there's no
        // settings file to touch and nothing node needs to do, only a
        // notification to post from inside this already-running process.
        if action == "notify" {
            logWindow("napominalka://notify (already-running instance)")
            postPendingNotification {}
            return
        }

        logWindow("napominalka:// (browser-tab fallback): \(action) \(arg)")
        runAction(action, arg) { resultJSON in
            logWindow("  fallback dispatch result: \(resultJSON)")
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1150, height: 850),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "ClassDash"
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
        config.userContentController.add(self, name: "classdash")

        web = WKWebView(frame: window.contentView!.bounds, configuration: config)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        web.uiDelegate = self

        // THE PAGE'S OWN ERRORS ARE INVISIBLE IN HERE.
        //
        // In a browser a broken script says so in the console. This
        // window has no console, so a script that dies on line one looks
        // exactly like a script that ran perfectly and had nothing to
        // do — every button simply stops responding, silently. That cost
        // several rounds of fixing things that were never broken.
        //
        // This makes the window inspectable from Safari's Develop menu
        // (Develop -> the machine's name -> ClassDash), which
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
        let script = "window.classdashBridgeResult && window.classdashBridgeResult(\(idLiteral), \(resultJSON));"
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

    // MARK: - JS confirm()

    // A BARE WKWebView DOESN'T IMPLEMENT confirm() AT ALL.
    //
    // alert()/confirm()/prompt() only work in WebKit when something
    // adopts WKUIDelegate and answers these calls itself — otherwise
    // the page's call to confirm() has nothing on the other end, and
    // WebKit just resolves it as "cancelled" without ever showing
    // anything. That's exactly what "hide" on an overdue assignment
    // looked like from outside: the page's own hideOverdueItem() (see
    // 08-page.js) treats a cancelled confirm() as a reason to do
    // nothing at all, so the button appeared to just not work — no
    // error, no dialog, nothing, because nothing had ever asked this
    // window to show one.
    //
    // The completion handler is called asynchronously (a sheet, not
    // NSAlert.runModal()) because this method itself must return before
    // the sheet closes — WebKit is waiting on completionHandler, not on
    // this function returning.
    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "OK")
        let cancel = alert.addButton(withTitle: "Cancel")
        cancel.keyEquivalent = "\u{1b}"

        guard let window = self.window else {
            completionHandler(alert.runModal() == .alertFirstButtonReturn)
            return
        }
        alert.beginSheetModal(for: window) { response in
            completionHandler(response == .alertFirstButtonReturn)
        }
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

// CHECKED BEFORE ANYTHING ELSE ABOUT NORMAL LAUNCH RUNS.
//
// .accessory has to be set before the notify path does anything else:
// it's what keeps this invocation out of the Dock and Cmd-Tab. A normal
// double-click launch never passes --notify, so it always falls through
// to the ordinary .regular / windowed path below, unchanged.
if CommandLine.arguments.contains("--notify") {
    application.setActivationPolicy(.accessory)
    runNotifyMode()
}

let delegate = Delegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
