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
import IOKit.ps

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
// FOUR ATTEMPTS NOW, NOT THREE -- A RELEASE BUILD BREAKS THE FIRST TWO.
//
// A build done locally (`npm run build`) bakes in the machine's own real
// path, and that's still the fast path for anyone building from source.
// But a build done on a GitHub Actions runner (see
// .github/workflows/release.yml) bakes in THAT runner's throwaway path --
// meaningless on the machine that eventually downloads it -- and "next to
// the app" only helps if the app was never moved into /Applications,
// which is exactly where every downloader is expected to put it. Neither
// passive check can work for that case; there's nothing on disk yet that
// says where the project actually lives. So a fourth source, a path
// chosen once and remembered, closes the gap -- see
// promptForProjectFolder() below, and applicationDidFinishLaunching's own
// call to it, for where that actually gets asked.
let projectPathDefaultsKey = "ProjectFolderPath"

func resolveProjectDir() -> (path: String, valid: Bool) {
    // 1. Whatever the build script wrote in.
    if let fromPlist = Bundle.main.object(forInfoDictionaryKey: "ProjectPath") as? String,
       !fromPlist.isEmpty,
       FileManager.default.fileExists(atPath: fromPlist + "/summary.html") {
        return (fromPlist, true)
    }

    // 2. Next to the app itself -- in case it wasn't copied to /Applications.
    let nextToApp = Bundle.main.bundleURL.deletingLastPathComponent().path
    if FileManager.default.fileExists(atPath: nextToApp + "/summary.html") {
        return (nextToApp, true)
    }

    // 3. Chosen once, in a previous launch, via promptForProjectFolder().
    if let saved = UserDefaults.standard.string(forKey: projectPathDefaultsKey),
       FileManager.default.fileExists(atPath: saved + "/summary.html") {
        return (saved, true)
    }

    // 4. Not found by any of the above. Falls back to "next to the app" --
    //    the window will show a blank page unless applicationDidFinishLaunching's
    //    prompt fixes that first, and a blank page is more honest than
    //    opening someone else's summary from a guessed path.
    return (nextToApp, false)
}

var (projectDir, hasValidProjectDir) = resolveProjectDir()
var pagePath: String { projectDir + "/summary.html" }

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

// Asked for ONLY when resolveProjectDir() found nothing on its own --
// see that function's own comment for the release-build case this
// exists to cover. NEVER called from runNotifyMode(): a background
// notification attempt that can't find its data should just quietly do
// nothing, the same as it already does when уведомление.txt itself is
// missing, not surface a dialog nobody asked for in that moment.
//
// Declines gracefully: if the person cancels, or picks a folder that
// doesn't actually have summary.html in it, this returns nil and the
// caller proceeds exactly as it always did without one -- a blank
// window, not a forced retry loop. It'll ask again next launch.
func promptForProjectFolder() -> String? {
    let panel = NSOpenPanel()
    panel.title = "Locate the ClassDash project folder"
    panel.message = "Choose the folder that has summary.html in it -- " +
        "the one \"npm install\" and \"npm start\" were run inside."
    panel.prompt = "Choose"
    panel.canChooseFiles = false
    panel.canChooseDirectories = true
    panel.allowsMultipleSelection = false
    panel.directoryURL = FileManager.default.homeDirectoryForCurrentUser

    guard panel.runModal() == .OK, let chosen = panel.url?.path else { return nil }

    guard FileManager.default.fileExists(atPath: chosen + "/summary.html") else {
        let alert = NSAlert()
        alert.messageText = "That doesn't look like the right folder"
        alert.informativeText = "No summary.html in there. Run \"npm start\" " +
            "at least once in the actual project folder, then try again."
        alert.runModal()
        return nil
    }

    UserDefaults.standard.set(chosen, forKey: projectPathDefaultsKey)
    return chosen
}

// THE ALTERNATIVE TO promptForProjectFolder() ABOVE: creates a new
// project folder instead of locating an existing one, so a first-time
// setup never needs git or npm run by hand.
//
// Copies the pristine template build.sh bundles into
// Contents/Resources/ProjectTemplate (see its own comment there — no git
// history, no generated data, node_modules included) into wherever the
// user picks, then runs one collection-less --redraw pass so there's a
// real summary.html to load before anything's actually been collected.
// Verified this works against a fully empty project before writing this.
// Everything AFTER the folder is created (browser setup, settings,
// login) happens later, in continueNewProjectSetupIfNeeded() below —
// this function's only job is getting a loadable project folder to
// exist at all.
func setUpNewProject() -> String? {
    let panel = NSOpenPanel()
    panel.title = "Set Up a New ClassDash Project"
    panel.message = "Choose where to create your ClassDash project folder — pick an " +
        "empty folder, or use \"New Folder\" to make one."
    panel.prompt = "Choose"
    panel.canChooseFiles = false
    panel.canChooseDirectories = true
    panel.canCreateDirectories = true
    panel.allowsMultipleSelection = false
    panel.directoryURL = FileManager.default.homeDirectoryForCurrentUser

    guard panel.runModal() == .OK, let chosen = panel.url?.path else { return nil }

    // Only a build.sh-built app has this — a plain `swiftc` compile of
    // just this one file (e.g. for quick local testing) never bundles
    // Contents/Resources at all. Failing here with a clear message is
    // better than copying nothing and leaving a broken half-empty folder.
    guard let resourcePath = Bundle.main.resourcePath else { return nil }
    let templateDir = resourcePath + "/ProjectTemplate"
    guard FileManager.default.fileExists(atPath: templateDir) else {
        let alert = NSAlert()
        alert.messageText = "Can't set up a new project from this copy"
        alert.informativeText = "This build doesn't have the project template bundled in " +
            "it. Use \"I Already Have a Project Folder\" instead, or build ClassDash with " +
            "build.sh, which bundles one."
        alert.alertStyle = .warning
        alert.runModal()
        return nil
    }

    do {
        for item in try FileManager.default.contentsOfDirectory(atPath: templateDir) {
            let dst = chosen + "/" + item
            if FileManager.default.fileExists(atPath: dst) {
                try FileManager.default.removeItem(atPath: dst)
            }
            try FileManager.default.copyItem(atPath: templateDir + "/" + item, toPath: dst)
        }
        try FileManager.default.copyItem(atPath: chosen + "/settings.example.json",
                                          toPath: chosen + "/settings.json")

        // settings.example.json's own canvas field is a fake-but-valid-
        // looking URL ("https://your-school.instructure.com"), not an
        // empty string — and 05-playwright-draft.js's CANVAS_ENABLED
        // check treats ANY non-empty value as "yes, read this", not just
        // a real one. Left as-is, a fresh setup would try to actually
        // read that fake domain and fail, instead of correctly starting
        // in the already-supported "Canvas off" state (an empty string)
        // until the user provides a real one or leaves it blank on
        // purpose — not everyone's school even uses Canvas.
        let settingsPath = chosen + "/settings.json"
        if let data = FileManager.default.contents(atPath: settingsPath),
           var obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            obj["canvas"] = ""
            if let out = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted]) {
                try? out.write(to: URL(fileURLWithPath: settingsPath))
            }
        }
    } catch {
        let alert = NSAlert()
        alert.messageText = "Couldn't set up the project folder"
        alert.informativeText = error.localizedDescription
        alert.alertStyle = .warning
        alert.runModal()
        return nil
    }

    runNodeScriptSync("05-playwright-draft.js", args: ["--redraw"], in: chosen)

    UserDefaults.standard.set(chosen, forKey: projectPathDefaultsKey)
    return chosen
}

// Runs a node script from the given project folder, blocking until it
// exits — for one-shot setup steps (the --redraw pass above, installing
// Brave below) where the next step genuinely can't start until this one
// has actually finished. Same PATH fix runAction() (in Delegate, below)
// already needs: a Dock/Finder-launched app inherits a minimal PATH that
// doesn't include Homebrew's node.
func runNodeScriptSync(_ script: String, args: [String], in dir: String) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["node", dir + "/" + script] + args
    var env = ProcessInfo.processInfo.environment
    let existingPath = env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + existingPath
    process.environment = env
    try? process.run()
    process.waitUntilExit()
}

// Same, but genuinely fire-and-forget — for --login below, which needs
// to keep running (and its real, visible browser window needs to keep
// existing) for as long as the user takes to actually log in, completely
// independent of anything else happening in this app. Same "started, not
// finished" contract fullCheck() in 21-notifier-actions.js already uses
// for a real collection pass.
//
// UNLIKE fullCheck()'s own fire-and-forget, this reports back whether it
// crashed almost immediately — found the hard way testing this wizard: a
// machine with neither Brave nor a real Chrome install makes login()'s
// own chromium.launchPersistentContext() throw right away, and with no
// feedback at all that silently looked exactly like nothing had
// happened. checkAfter gives it a few seconds (a real login run keeps
// the process alive far longer than that, waiting on the browser window
// closing) before checking process.isRunning — long enough to catch a
// launch failure, short enough not to meaningfully delay the normal case.
func runNodeScriptDetached(_ script: String, args: [String], in dir: String,
                            checkAfter: TimeInterval = 3, completion: @escaping (_ crashed: Bool) -> Void) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["node", dir + "/" + script] + args
    var env = ProcessInfo.processInfo.environment
    let existingPath = env["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + existingPath
    process.environment = env

    // NOT process.isRunning, checked after the fact — found live testing
    // this: a genuinely still-running login() (independently confirmed
    // via `ps` — a real Brave window was open and working) got reported
    // as crashed anyway. isRunning reads unreliably unless something
    // actually registers to observe the real exit first; a
    // terminationHandler does that, so this tracks the exit directly
    // instead of trusting a poll. Both sides touch hasExited only on the
    // main queue — terminationHandler itself runs on an arbitrary one.
    var hasExited = false
    process.terminationHandler = { _ in
        DispatchQueue.main.async { hasExited = true }
    }

    do {
        try process.run()
    } catch {
        DispatchQueue.main.async { completion(true) }
        return
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + checkAfter) {
        completion(hasExited)
    }
}

class Delegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var web: WKWebView!

    // Set true only by setUpNewProject() succeeding — gates
    // continueNewProjectSetupIfNeeded() so an existing-folder launch
    // (the ordinary case, every time after the very first) never sees
    // the browser/settings/login prompts meant for a brand new setup.
    var isNewProjectSetup = false

    // Whether the DISPLAY is currently asleep — not whether the whole
    // Mac is. Full system sleep freezes this process entirely,
    // including any timer; nothing here could run during it anyway, so
    // there's nothing useful to track. Display-asleep is the state that
    // actually matters: screen off, nobody at the machine, system still
    // fully running. See setupAutoFreshCheck() below.
    var isDisplayAsleep = false
    var autoFreshCheckTimer: Timer?
    var updateCheckTimer: Timer?
    var installPromptTimer: Timer?
    // Which ready version this launch has already asked about and been
    // told "Later" for — without this, the 60-second poll would show
    // the same NSAlert again every minute for as long as it stays
    // undismissed. Session-only, deliberately not written to disk: a
    // fresh launch means asking again, same as any other updater.
    var declinedInstallVersion: String?

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
        // See resolveProjectDir()'s own comment: this is the case a
        // release build downloaded from GitHub and dropped in
        // /Applications, like any normal Mac app, hits on its very
        // first launch. Asked here, not any earlier -- NSOpenPanel
        // needs a running app with a real activation policy behind it,
        // which doesn't exist yet at the top of this file where
        // resolveProjectDir() itself runs.
        if !hasValidProjectDir {
            let welcome = NSAlert()
            welcome.messageText = "Welcome to ClassDash"
            welcome.informativeText = "ClassDash needs a project folder to work from — the " +
                "folder that does the actual collecting and stores your data. If you don't " +
                "have one yet, ClassDash can set one up for you, no Terminal needed."
            welcome.addButton(withTitle: "Set Up New Project")
            welcome.addButton(withTitle: "I Already Have a Project Folder")

            if welcome.runModal() == .alertFirstButtonReturn {
                if let chosen = setUpNewProject() {
                    projectDir = chosen
                    hasValidProjectDir = true
                    isNewProjectSetup = true
                }
            } else if let chosen = promptForProjectFolder() {
                projectDir = chosen
                hasValidProjectDir = true
            }
        }

        buildMainMenu()

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1400, height: 850),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        // NSWindow defaults to isReleasedWhenClosed = true — AppKit frees
        // the window itself the moment it's closed, fighting the strong
        // reference held in `window` above and leaving it dangling. That
        // was invisible as long as closing the window quit the app
        // outright, but now that the last window closing doesn't quit
        // (see applicationShouldTerminateAfterLastWindowClosed below),
        // clicking the Dock icon to bring it back reused that dangling
        // pointer in applicationShouldHandleReopen and crashed with
        // EXC_BAD_ACCESS — confirmed from the actual crash report.
        window.isReleasedWhenClosed = false
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

        setupAutoFreshCheck()
        setupUpdateCheck()
        continueNewProjectSetupIfNeeded()
    }

    // MARK: - Menu bar

    // THE ACTUAL APPLICATION MENU BAR — THE BOLD APP-NAME MENU AT THE
    // TOP LEFT, NOT THE STATUS ITEM ON THE RIGHT BELOW.
    //
    // This app never had one at all: no NSMenu was ever assigned to
    // NSApp.mainMenu, since nothing here was ever built from a NIB/
    // storyboard, which is what normally wires this up for free. The
    // status item added alongside this is a genuinely separate thing —
    // a small icon for background access — and doesn't substitute for
    // the standard menu every real Mac app has (About/Hide/Quit under
    // its own name, Edit, Window). Built by hand here since there's no
    // NIB to hold it.
    func buildMainMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About ClassDash",
                         action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        // Standard placement — right under About, in every app that has
        // one (Sparkle-based or not). No key equivalent: nothing else in
        // this app claims one, and it isn't a frequent-enough action to
        // deserve a shortcut.
        let updateItem = appMenu.addItem(withTitle: "Check for Updates…",
                                          action: #selector(checkForUpdatesManually), keyEquivalent: "")
        updateItem.target = self
        appMenu.addItem(NSMenuItem.separator())
        // Cmd-, — the standard shortcut every app with a settings/
        // preferences item binds, expected to work without having to be
        // discovered from the menu first.
        let settingsItem = appMenu.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        settingsItem.target = self
        // Both reachable any time, not just during the one-time new-
        // project wizard — added after testing that wizard live turned
        // up a real gap: skipping (or wanting to redo) either one left
        // no way back in short of deleting the project folder and
        // starting over. Same underlying functions the wizard itself
        // calls (presentBrowserSetup()/attemptLogin() below), just
        // reachable from here too.
        let browserItem = appMenu.addItem(withTitle: "Choose Browser…", action: #selector(chooseBrowserFromMenu), keyEquivalent: "")
        browserItem.target = self
        let signInItem = appMenu.addItem(withTitle: "Sign In to Google Classroom…", action: #selector(signInFromMenu), keyEquivalent: "")
        signInItem.target = self
        appMenu.addItem(NSMenuItem.separator())
        let servicesItem = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
        let servicesMenu = NSMenu()
        NSApp.servicesMenu = servicesMenu
        servicesItem.submenu = servicesMenu
        appMenu.addItem(servicesItem)
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Hide ClassDash", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "Hide Others",
                                          action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit ClassDash", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        // Not for documents — there aren't any — just so Cmd-C/Cmd-V/
        // Cmd-A actually work in the settings panel's text fields.
        // WKWebView answers these selectors itself; a menu item pointing
        // at the standard cut:/copy:/paste:/selectAll: is what makes the
        // shortcut route there at all, regardless of what ends up
        // handling it in the responder chain.
        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        // macOS fills in the actual open-window list here on its own,
        // once a Window menu exists and is registered below — nothing
        // here has to maintain that list by hand.
        let windowMenuItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(NSMenuItem.separator())
        windowMenu.addItem(withTitle: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        windowMenuItem.submenu = windowMenu
        mainMenu.addItem(windowMenuItem)
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = mainMenu
    }

    // Cmd-, opening settings is a macOS-wide convention (every app with
    // a Preferences item binds it), so it needs to work here even
    // though settings live inside the page itself, not a native window —
    // this just calls the exact same toggleSettingsPanel() the gear icon
    // already calls, from the native side instead of a click.
    @objc func openSettings() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        web.evaluateJavaScript("toggleSettingsPanel()", completionHandler: nil)
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

    // FALSE, NOT TRUE — paired with applicationShouldHandleReopen right
    // below, not with the status item that briefly existed and was
    // removed again. This used to be true (closing the window quit the
    // whole app), which is fine on its own, but doesn't match how any
    // other normal Mac app behaves: closing every window on Safari or
    // Mail doesn't quit them either. "Quit ClassDash" in the app menu,
    // or Cmd-Q, is the actual way to exit — this delegate method only
    // governs what happens when the LAST WINDOW closes on its own, not
    // an explicit quit.
    func applicationShouldTerminateAfterLastWindowClosed(_ application: NSApplication) -> Bool {
        return false
    }

    // THE OTHER HALF OF THAT — WITHOUT THIS, A CLOSED WINDOW STAYS
    // CLOSED FOREVER.
    //
    // The standard convention every properly-behaved Mac app follows:
    // click its Dock icon with no windows open, a window comes back.
    // Skipping this would leave the app running but genuinely
    // unreachable once its one window is closed — worse than the
    // original "closing quits" behavior, not better.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            window.makeKeyAndOrderFront(nil)
        }
        NSApp.activate(ignoringOtherApps: true)
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

    // MARK: - Automatic fresh checks

    // NOTHING SCHEDULES A CHECK ON ITS OWN UNLESS SOMETHING TELLS IT TO.
    //
    // Fresh check (the "check" action above, same as this window's own
    // button) opens a visible Edpuzzle browser window and takes about a
    // minute — fine to trigger by hand, but running it on a timer
    // without regard for whether anyone's actually sitting at the
    // machine would mean it popping up mid-workflow. This is why there
    // are two separate intervals in settings instead of one:
    // freshCheckAwakeMinutes (display on, someone might be using this
    // Mac right now) and freshCheckAsleepMinutes (display off, nobody's
    // there to be interrupted — free to run more often). Either can be
    // 0 to disable auto-fresh-checking in that state entirely.
    //
    // "Asleep" here means the DISPLAY, not the whole system. Full
    // system sleep freezes this entire process, this timer included —
    // there'd be nothing left running to notice or act on that state.
    // Display sleep is the one a desktop Mac (no lid to close, often
    // never fully sleeping at all) can actually sit in for hours while
    // genuinely idle, which is exactly the case this exists for.
    func setupAutoFreshCheck() {
        let center = NSWorkspace.shared.notificationCenter
        center.addObserver(self, selector: #selector(displayDidSleep),
                            name: NSWorkspace.screensDidSleepNotification, object: nil)
        center.addObserver(self, selector: #selector(displayDidWake),
                            name: NSWorkspace.screensDidWakeNotification, object: nil)

        // A single repeating timer that just checks "is it time yet?"
        // once a minute, rather than one whose own interval gets torn
        // down and rebuilt every time the display sleeps/wakes or a
        // setting changes. Settings and sleep state are both read fresh
        // on every tick, so neither can go stale. It also means system
        // sleep — which pauses this timer along with everything else —
        // doesn't need special handling: the next tick after waking
        // just sees a bigger elapsed-time number and reacts normally.
        autoFreshCheckTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            self?.maybeRunAutoFreshCheck()
        }
    }

    @objc private func displayDidSleep() { isDisplayAsleep = true }
    @objc private func displayDidWake() { isDisplayAsleep = false }

    private func maybeRunAutoFreshCheck() {
        let (awakeMinutes, asleepMinutes, onlyWhenCharging) = readFreshCheckSettings()
        let intervalMinutes = isDisplayAsleep ? asleepMinutes : awakeMinutes
        guard intervalMinutes > 0 else { return } // 0 — disabled for this state

        // Checked AFTER the interval, not instead of it: a Mac that's
        // unplugged right now with the toggle on just skips this run
        // entirely and tries again next tick — the interval itself
        // still governs cadence once it IS plugged back in, rather
        // than this becoming its own separate schedule.
        if onlyWhenCharging && !isOnACPower() {
            logWindow("auto fresh check: skipped — on battery and freshCheckOnlyWhenCharging is on")
            return
        }

        // last-collection.json's own mtime — the exact same signal
        // /api/status calls collectedAt/minutesAgo. Using it instead of
        // this timer's own memory of "when did I last fire" means a
        // manual fresh check (the button, or another client hitting
        // /api/check) also resets the clock, so this doesn't pile a
        // redundant one on top of a check that just happened for some
        // other reason. Missing entirely (nothing's ever been
        // collected) counts as infinitely stale, so it fires as soon
        // as an interval is configured rather than waiting a full
        // interval past a launch with no data at all.
        let elapsedMinutes = minutesSinceLastCollection() ?? .greatestFiniteMagnitude
        guard elapsedMinutes >= Double(intervalMinutes) else { return }

        logWindow("auto fresh check: \(Int(elapsedMinutes))m since last collection, " +
                  "\(intervalMinutes)m interval (\(isDisplayAsleep ? "asleep" : "awake")) — running one")
        runAction("check", "") { _ in }
    }

    // Reads settings.json directly rather than shelling out to node
    // 19-settings.js for a few values — it's a plain file already
    // sitting on disk, and this needs an answer every 60 seconds, not
    // a whole node process spun up that often just to ask it. Missing
    // keys or a missing file both mean 0/true (freshCheckOnlyWhenCharging
    // defaults true in 19-settings.js too, see its own comment there for
    // why) — NOT a full merge-with-defaults, since there's no equivalent
    // happening on this side. A freshly-created settings.json from
    // before this feature existed simply doesn't have these keys yet,
    // and the safe reading of the two minute values specifically is
    // "off", not "guess at what the default should have been".
    // THIS IS THE ACTUAL RUNTIME ENFORCEMENT POINT, NOT 19-settings.js's
    // OWN validate().
    //
    // This reads settings.json directly, off this project's normal
    // read()/validate() path entirely — a value here didn't necessarily
    // come through the settings panel or the API, which is exactly what
    // makes clamping it here, not just at the save point, the fix that
    // actually matters. Confirmed live: freshCheckAsleepMinutes sitting
    // at 5 meant a full, real-browser Fresh check (Edpuzzle included,
    // itself about a minute to run) launching roughly every 5-8 minutes
    // around the clock — sustained memory pressure into swap and a pile
    // of leftover Brave helper processes, bad enough to need force-
    // quitting by hand. Any positive value under 10 is treated as
    // disabled (0), not rounded up to 10 — a value that low reads as
    // unsafe leftover state to fail safe away from, not a real request
    // for "as close to 10 as possible" this should try to honor.
    private func clampFreshCheckMinutes(_ n: Int) -> Int {
        return (n > 0 && n < 10) ? 0 : n
    }

    private func readFreshCheckSettings() -> (awake: Int, asleep: Int, onlyWhenCharging: Bool) {
        let path = projectDir + "/settings.json"
        guard let data = FileManager.default.contents(atPath: path),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return (0, 0, true)
        }
        let awake = clampFreshCheckMinutes((obj["freshCheckAwakeMinutes"] as? Int) ?? 0)
        let asleep = clampFreshCheckMinutes((obj["freshCheckAsleepMinutes"] as? Int) ?? 0)
        let onlyWhenCharging = (obj["freshCheckOnlyWhenCharging"] as? Bool) ?? true
        return (awake, asleep, onlyWhenCharging)
    }

    private func minutesSinceLastCollection() -> Double? {
        let path = projectDir + "/last-collection.json"
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: path),
              let modDate = attrs[.modificationDate] as? Date else {
            return nil
        }
        return Date().timeIntervalSince(modDate) / 60
    }

    // Whether AC power is what's actually supplying this Mac right now
    // — not the finer-grained "mid charge cycle" question, which would
    // wrongly say no for a laptop sitting on its charger at 100%. A
    // desktop with no battery at all (an empty power-source list, not
    // one reporting "Battery Power") falls through the loop below and
    // returns true from the guard — there's nothing else it could be
    // running on. Confirmed against this project's own Mac mini: no
    // battery/charging entities exist for it in Home Assistant's own
    // Mac-monitoring integration either, for the same underlying reason.
    private func isOnACPower() -> Bool {
        guard let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let sources = IOPSCopyPowerSourcesList(blob)?.takeRetainedValue() as? [CFTypeRef],
              !sources.isEmpty else {
            return true
        }
        for source in sources {
            guard let info = IOPSGetPowerSourceDescription(blob, source)?.takeUnretainedValue() as? [String: Any],
                  let state = info[kIOPSPowerSourceStateKey] as? String else { continue }
            return state == kIOPSACPowerValue
        }
        return true
    }

    // MARK: - Update check

    // "IS THERE A NEWER RELEASE?" — CHECKED HERE, NOT FROM NODE.
    //
    // The GitHub API call and the version comparison both happen in
    // this process, not 05-playwright-draft.js: this is the one place
    // with a long-running Timer already (see setupAutoFreshCheck right
    // above) and a menu bar to hang a manual "Check for Updates…" item
    // on — neither exists on the Node side. The result is written to
    // update-status.json so 08-page.js can still show it on the
    // summary page and in settings, the same file-based handoff every
    // other piece of state shared between this app and the collector
    // already uses (settings.json, last-collection.json, and the rest).
    //
    // Dismissing the banner is the one piece that goes the OTHER way —
    // the page calls back through the normal napominalka:// bridge
    // (dismissUpdate, in 21-notifier-actions.js) instead of this file
    // touching update-status.json a second way. One writer for
    // "did we check and what did we find" (this function), one writer
    // for "has the user seen it" (the bridge) — no two code paths ever
    // racing to write the same field.
    func setupUpdateCheck() {
        checkForUpdates(manual: false)
        // No minute-by-minute "is it time yet?" tick like the fresh-
        // check timer above — there's no awake/asleep distinction to
        // make here, just "once a day while the app happens to be
        // running", and the launch-time check right above already
        // covers the common case of the app not staying open 24 hours
        // straight.
        updateCheckTimer = Timer.scheduledTimer(withTimeInterval: 86400, repeats: true) { [weak self] _ in
            self?.checkForUpdates(manual: false)
        }
        // Resumes an install that was downloaded but never confirmed
        // last time the app ran — declinedInstallVersion is per-launch,
        // so a fresh launch always asks again about a still-pending
        // update, same as the 60-second poll below asks again about
        // one that just finished downloading via the API.
        maybeShowInstallPrompt()
        setupInstallPromptCheck()
    }

    // MARK: - New-project setup wizard (continued)
    //
    // setUpNewProject() (top of this file) only gets a project folder to
    // exist and load — everything past that needs the real window/web
    // view to already be up, which is why this runs from the END of
    // applicationDidFinishLaunching instead of being part of that
    // function directly. Guarded by isNewProjectSetup so this is a
    // complete no-op on every ordinary launch after the first.
    func continueNewProjectSetupIfNeeded() {
        guard isNewProjectSetup else { return }
        isNewProjectSetup = false // only ever runs once, right after creation
        presentBrowserSetup { [weak self] in
            self?.promptForSettingsThenLogin()
        }
    }

    // The browser-choice step — the wizard's own, but also reachable any
    // time afterward from the menu bar's "Choose Browser…" (see
    // chooseBrowserFromMenu() below). Testing the wizard live turned up
    // a real gap: skipping this (or wanting to redo it later) left no
    // way back short of deleting the project folder and starting the
    // whole wizard over. `completion` runs once a choice has actually
    // been made or declined — the wizard chains into settings+login
    // there; a menu-triggered run just does nothing further.
    func presentBrowserSetup(completion: @escaping () -> Void) {
        let browserAlert = NSAlert()
        browserAlert.messageText = "Set Up a Browser for Collection"
        browserAlert.informativeText = "ClassDash needs a real Chromium-based browser to " +
            "log in and collect your assignments. Brave is recommended — more " +
            "privacy-focused than Chrome, and this installs a separate, isolated copy just " +
            "for ClassDash, never touching your everyday browser. About 150 MB, one time " +
            "only — ClassDash will continue automatically once it's done."
        browserAlert.addButton(withTitle: "Install Brave (Recommended)")
        browserAlert.addButton(withTitle: "I Already Have Chrome")
        browserAlert.addButton(withTitle: "Choose a Different Browser…")
        browserAlert.addButton(withTitle: "Skip for Now")

        switch browserAlert.runModal() {
        case .alertFirstButtonReturn:
            // --force: install Brave even though 20-browser.js would
            // otherwise skip it if Chrome's already present (see its own
            // hasSystemChrome() comment) — the whole point of defaulting
            // to this button is Brave over Chrome, not "whichever's less
            // work." Off the main thread so the ~150MB download doesn't
            // freeze the app; completion only runs once this has
            // actually finished.
            let dir = projectDir
            // Found live testing this: with nothing visible on screen
            // during the (potentially real, ~150MB) download, there was
            // no way to tell "still working" from "silently stuck" —
            // this closes the exact same gap the update-check fix
            // (v1.3.2) closed for a different silent step.
            let busy = showBusyPanel("Installing Brave…")
            DispatchQueue.global(qos: .userInitiated).async {
                runNodeScriptSync("20-browser.js", args: ["--force"], in: dir)
                DispatchQueue.main.async {
                    busy.close()
                    completion()
                }
            }
        case .alertThirdButtonReturn:
            chooseCustomBrowser(completion: completion)
        default: // "I Already Have Chrome" or "Skip for Now" — nothing to do
            completion()
        }
    }

    // Manual browser selection — for anyone whose real browser is
    // neither Brave nor Chrome. Written straight into settings.json's
    // browserPath, the SAME field 05-playwright-draft.js's own BROWSER
    // resolution already checks first (see its own comment there) — no
    // new plumbing needed on the Node side, this only ever writes to an
    // existing, already-read setting.
    //
    // THE WARNING BELOW IS NOT DECORATIVE. See 20-browser.js's own header
    // comment: Arc silently ignored --user-data-dir once, ran ClassDash's
    // automation against a REAL everyday profile instead of an isolated
    // one, and the real cookies/extensions in that profile didn't survive
    // the next normal launch — no backup, no way back. Detected by name
    // here specifically because it already happened for real, not as a
    // hypothetical.
    func chooseCustomBrowser(completion: @escaping () -> Void) {
        let panel = NSOpenPanel()
        panel.title = "Choose a Browser"
        panel.message = "Pick the browser app ClassDash should use to log in and collect " +
            "your assignments."
        panel.prompt = "Choose"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.directoryURL = URL(fileURLWithPath: "/Applications")
        if #available(macOS 11.0, *) {
            panel.allowedContentTypes = [.application]
        }

        guard panel.runModal() == .OK, let chosenApp = panel.url else {
            completion()
            return
        }

        let bundle = Bundle(path: chosenApp.path)
        let displayName = (bundle?.infoDictionary?["CFBundleName"] as? String) ??
            chosenApp.deletingPathExtension().lastPathComponent
        // company.thebrowser.Browser is Arc's real bundle identifier —
        // checked alongside the display name so this still catches it
        // even if a future Arc version changes either one on its own.
        let bundleID = (bundle?.bundleIdentifier ?? "").lowercased()
        let isKnownUnsafe = bundleID.contains("thebrowser") || displayName.lowercased() == "arc"

        let warning = NSAlert()
        if isKnownUnsafe {
            warning.messageText = "⚠️ \(displayName) Is Not Safe to Use Here"
            warning.informativeText = "\(displayName) does not respect the isolated " +
                "profile folder ClassDash asks for. This already happened for real once: " +
                "it silently used the REAL, everyday \(displayName) profile instead of a " +
                "separate one, and once ClassDash's automation touched it, the real " +
                "cookies and extensions in that profile did not survive the next normal " +
                "launch — no backup, no way to undo it. This is not a \"probably fine\" " +
                "warning. Use Chrome or Brave instead."
            warning.alertStyle = .critical
            warning.addButton(withTitle: "Choose a Different Browser Instead")
            warning.addButton(withTitle: "Use \(displayName) Anyway (Not Recommended)")
        } else {
            warning.messageText = "Use \(displayName)?"
            warning.informativeText = "Only choose a browser you know respects an " +
                "isolated profile folder (a \"--user-data-dir\" launch flag) — Chrome and " +
                "Brave are confirmed safe. If \(displayName) doesn't, it could use your " +
                "REAL everyday profile instead of a separate one, with no way to undo any " +
                "damage that causes. If you're not sure, use Chrome or Brave instead."
            warning.alertStyle = .warning
            warning.addButton(withTitle: "Use \(displayName)")
            warning.addButton(withTitle: "Cancel")
        }

        let response = warning.runModal()
        let confirmed = isKnownUnsafe
            ? response == .alertSecondButtonReturn  // "Use anyway" is the 2nd button there
            : response == .alertFirstButtonReturn   // "Use X" is the 1st button there

        guard confirmed, let executablePath = bundle?.executableURL?.path else {
            chooseCustomBrowser(completion: completion) // declined/cancelled — try another
            return
        }

        writeBrowserPathSetting(executablePath)
        completion()
    }

    // Menu-bar entry points — same underlying functions the wizard uses,
    // just reachable any time instead of gated behind isNewProjectSetup.
    @objc func chooseBrowserFromMenu() {
        presentBrowserSetup {
            let done = NSAlert()
            done.messageText = "Browser Updated"
            done.informativeText = "Takes effect on the next check — right away if you " +
                "start one now (the reload button, or Check Now)."
            done.runModal()
        }
    }

    @objc func signInFromMenu() {
        attemptLogin()
    }

    private func writeBrowserPathSetting(_ path: String) {
        let settingsPath = projectDir + "/settings.json"
        guard let data = FileManager.default.contents(atPath: settingsPath),
              var obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        obj["browserPath"] = path
        guard let out = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted]) else { return }
        try? out.write(to: URL(fileURLWithPath: settingsPath))
    }

    // A small floating "still working" indicator — not an NSAlert, since
    // those need at least one button and this specifically has nothing
    // for the user to click yet. Non-activating so it doesn't steal
    // focus from whatever else the user's doing while a real download
    // runs in the background. Caller closes it themselves once the
    // actual work finishes; nothing here times out or auto-dismisses.
    private func showBusyPanel(_ message: String) -> NSPanel {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 280, height: 70),
                             styleMask: [.titled, .nonactivatingPanel, .utilityWindow],
                             backing: .buffered, defer: false)
        panel.title = ""
        panel.isFloatingPanel = true
        panel.center()

        let spinner = NSProgressIndicator(frame: NSRect(x: 20, y: 25, width: 20, height: 20))
        spinner.style = .spinning
        spinner.startAnimation(nil)

        let label = NSTextField(labelWithString: message)
        label.frame = NSRect(x: 50, y: 25, width: 210, height: 20)

        panel.contentView?.addSubview(spinner)
        panel.contentView?.addSubview(label)
        panel.makeKeyAndOrderFront(nil)
        return panel
    }

    // Opens the real, already-built settings panel (same bridge and page
    // every ordinary launch uses — no new settings UI needed for the
    // wizard) so the user fills in their email/Canvas domain, then offers
    // to start the interactive login. Login itself is unavoidably manual
    // — the user has to actually type their password somewhere real, not
    // something this wizard could or should do for them.
    private func promptForSettingsThenLogin() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        web.evaluateJavaScript("toggleSettingsPanel()", completionHandler: nil)

        let loginAlert = NSAlert()
        loginAlert.messageText = "Sign In to Google Classroom"
        loginAlert.informativeText = "Fill in your settings above, then click Sign In — a " +
            "real browser window will open for you to log in normally, the same as logging " +
            "into any site. Come back here once you're done."
        loginAlert.addButton(withTitle: "Sign In")
        loginAlert.addButton(withTitle: "I'll Do This Later")
        guard loginAlert.runModal() == .alertFirstButtonReturn else { return }

        attemptLogin()
    }

    // Split out from promptForSettingsThenLogin() so a failed attempt can
    // retry itself directly — see its own alert below. Waits a few
    // seconds before saying anything at all: see runNodeScriptDetached's
    // own comment on why, and the real crash (no compatible browser
    // installed at all) this was written against.
    private func attemptLogin() {
        // Found live testing this: without any warning, macOS's own
        // Privacy & Security block (App Management/Automation, Files
        // and Folders — see the README's own step 3) shows up as an
        // unexplained system notification with no connection back to
        // what ClassDash was doing. Saying so upfront, every attempt —
        // cheap (one click) against genuinely confusing otherwise, and
        // the permission can need re-granting after some rebuilds too
        // (see build.sh's own comment on the stable local cert).
        let headsUp = NSAlert()
        headsUp.messageText = "One More Thing Before Signing In"
        headsUp.informativeText = "The first time, macOS may show a notification saying " +
            "ClassDash was blocked from accessing files or automating another app — " +
            "that's expected, not an error. If it happens: System Settings → Privacy & " +
            "Security → allow ClassDash under both App Management (or Automation) and " +
            "Files and Folders, then try Sign In again."
        headsUp.addButton(withTitle: "OK, Continue")
        headsUp.runModal()

        runNodeScriptDetached("05-playwright-draft.js", args: ["--login"], in: projectDir) { [weak self] crashed in
            guard let self = self else { return }
            if crashed {
                let alert = NSAlert()
                alert.messageText = "Couldn't open a browser to sign in"
                alert.informativeText = "Two common causes: no compatible browser is " +
                    "installed (Install Google Chrome, or run \"npm run setup-browser\" for " +
                    "a separate Brave install), or macOS just blocked the permission this " +
                    "needs — check System Settings → Privacy & Security → App Management " +
                    "and Files and Folders for ClassDash there. Then try again."
                alert.alertStyle = .warning
                alert.addButton(withTitle: "Try Again")
                alert.addButton(withTitle: "Cancel")
                if alert.runModal() == .alertFirstButtonReturn {
                    self.attemptLogin()
                }
                return
            }
            let doneAlert = NSAlert()
            doneAlert.messageText = "Signing In"
            doneAlert.informativeText = "A browser window should now be open. Log in with " +
                "your school account, then come back and click Done."
            doneAlert.addButton(withTitle: "Done")
            doneAlert.runModal()
            self.runAction("check", "") { _ in }
        }
    }

    // A download that's already sitting there ready doesn't need
    // hitting GitHub again — the menu item's whole point is being the
    // one convenient place to go for "what's the update situation and
    // what do I do about it", so it goes straight to the install
    // confirmation instead of re-checking and reporting "up to date"
    // relative to a version that's not even installed yet.
    //
    // Relies on maybeShowInstallPrompt()'s own return value rather than
    // re-checking readyToInstall here itself: that function now falls
    // through to false (instead of just silently returning) both when
    // the recorded download has gone missing and when this version was
    // already declined this session — either way, this button should
    // never be a silent no-op, so both cases fall back to a real check.
    @objc private func checkForUpdatesManually() {
        guard !maybeShowInstallPrompt() else { return }
        checkForUpdates(manual: true)
    }

    // The repo this app itself is built from — not configurable,
    // there's only ever the one place this project's releases come from.
    private static let updateAPIURL = URL(string:
        "https://api.github.com/repos/vemboy200/ClassDash/releases/latest")!
    private static let updateReleasesURL =
        "https://github.com/vemboy200/ClassDash/releases/latest"

    private func checkForUpdates(manual: Bool) {
        let currentVersion = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0.0.0"

        var request = URLRequest(url: Self.updateAPIURL)
        // No auth needed for a public repo's releases — GitHub's
        // unauthenticated rate limit (60/hour per IP) is nowhere close
        // to what a once-a-day-plus-occasional-manual-click check needs.
        // The User-Agent header IS required though: GitHub's API 403s
        // any request that doesn't send one at all.
        request.setValue("ClassDash/\(currentVersion)", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 15

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }
            if let error = error {
                let reason = error.localizedDescription
                logWindow("update check failed: \(reason)")
                self.recordCheckError(reason)
                if manual {
                    DispatchQueue.main.async { self.showUpdateCheckFailedAlert(reason) }
                }
                return
            }
            guard let data = data,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let tagName = obj["tag_name"] as? String else {
                logWindow("update check: couldn't parse GitHub's response")
                self.recordCheckError("unexpected response from GitHub")
                if manual {
                    DispatchQueue.main.async { self.showUpdateCheckFailedAlert("unexpected response from GitHub") }
                }
                return
            }
            let latestVersion = tagName.hasPrefix("v") ? String(tagName.dropFirst()) : tagName
            let releaseURL = (obj["html_url"] as? String) ?? Self.updateReleasesURL
            let updateAvailable = Self.isNewer(latestVersion, than: currentVersion)

            // The .dmg's own direct download URL, not the release PAGE
            // url above — downloadUpdate() below needs something it can
            // actually fetch bytes from. release.yml always names it
            // "ClassDash-<tag>.dmg"; matched by suffix rather than that
            // exact pattern so a hand-published release with a
            // differently-formatted asset name still works, as long as
            // it's still the one .dmg.
            let assets = obj["assets"] as? [[String: Any]] ?? []
            let downloadURL = assets.first(where: {
                ($0["name"] as? String)?.hasSuffix(".dmg") == true
            }).flatMap { $0["browser_download_url"] as? String }

            logWindow("update check: running \(currentVersion), latest is \(latestVersion)" +
                            (updateAvailable ? " — update available" : "") +
                            (downloadURL == nil ? " (no .dmg asset found)" : ""))
            self.writeUpdateStatus(currentVersion: currentVersion, latestVersion: latestVersion,
                                    url: releaseURL, downloadURL: downloadURL, updateAvailable: updateAvailable)

            if manual {
                DispatchQueue.main.async {
                    if updateAvailable {
                        self.window.makeKeyAndOrderFront(nil)
                        NSApp.activate(ignoringOtherApps: true)
                        self.web.evaluateJavaScript("location.reload()", completionHandler: nil)
                        self.offerToDownload(latestVersion: latestVersion)
                    } else {
                        let alert = NSAlert()
                        alert.messageText = "You're up to date"
                        alert.informativeText = "ClassDash \(currentVersion) is the latest version."
                        alert.runModal()
                    }
                }
            }
        }.resume()
    }

    @MainActor
    private func showUpdateCheckFailedAlert(_ reason: String) {
        let alert = NSAlert()
        alert.messageText = "Couldn't check for updates"
        alert.informativeText = reason
        alert.alertStyle = .warning
        alert.runModal()
    }

    // ONLY SHOWN FOR A MANUAL CHECK — the "convenient update button in
    // the menu" the automatic silent checks deliberately aren't (that
    // banner-only behavior for the automatic path is unchanged). This
    // is what makes the menu item into an actual one-stop "check, then
    // download, then (once downloadUpdate() reports readyToInstall)
    // install" flow instead of stopping at "here's a banner, go figure
    // out how to actually get the update yourself."
    //
    // Fires the SAME downloadUpdate action the API uses, through
    // runAction() (the normal node-CLI bridge path) — safe to do from
    // here specifically because a menu click doesn't need to wait
    // synchronously on the result the way a page button would (see
    // downloadUpdate's own case in 21-notifier-actions.js for why that
    // matters there and not here): this just fires it and lets
    // maybeShowInstallPrompt()'s existing 60-second poll notice once
    // it's actually done, exactly like an API-triggered download
    // already gets noticed.
    @MainActor
    private func offerToDownload(latestVersion: String) {
        let alert = NSAlert()
        alert.messageText = "ClassDash \(latestVersion) is available"
        alert.informativeText = "Download it now? You'll be asked to confirm again before it's actually installed."
        alert.addButton(withTitle: "Download")
        alert.addButton(withTitle: "Not Now")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        logWindow("menu: starting download of v\(latestVersion)")
        runAction("downloadUpdate", "") { _ in }
    }

    // A failed check couldn't call writeUpdateStatus() below — there's
    // no latestVersion/url/updateAvailable to write, that's the whole
    // problem — but silently leaving update-status.json exactly as it
    // was would mean a client watching `status` never learns the check
    // is failing at all, automatic ones especially (a manual failure at
    // least shows an alert). A plain merge, not a full rewrite: nothing
    // else on file needs to change just because this one check failed.
    private func recordCheckError(_ reason: String) {
        let path = projectDir + "/update-status.json"
        var status = readUpdateStatusFile() ?? [:]
        status["error"] = reason
        status["checkedAt"] = ISO8601DateFormatter().string(from: Date())
        guard let data = try? JSONSerialization.data(withJSONObject: status, options: [.prettyPrinted]) else { return }
        try? data.write(to: URL(fileURLWithPath: path))
    }

    // Written fresh on every check, EXCEPT dismissedVersion and the
    // download-state fields — those belong to other writers
    // (dismissUpdate in 21-notifier-actions.js, downloadUpdate() below)
    // and have to survive being overwritten by the next automatic
    // check or a dismissal / a completed download would silently
    // un-happen. Read the existing file first and carry those forward;
    // every other field is this function's own to decide fresh.
    //
    // The download-state fields are carried over CONDITIONALLY, not
    // unconditionally like dismissedVersion: they're only still true
    // for the version they were recorded against. If a newer release
    // ships after one was already downloaded-but-not-installed, that
    // download is now stale — carrying readyToInstall forward would
    // offer to install a version that's no longer the latest one.
    private func writeUpdateStatus(currentVersion: String, latestVersion: String,
                                    url: String, downloadURL: String?, updateAvailable: Bool) {
        let path = projectDir + "/update-status.json"
        var dismissedVersion: String? = nil
        var readyToInstall = false
        var readyVersion: String? = nil
        var downloadedPath: String? = nil
        if let existing = FileManager.default.contents(atPath: path),
           let obj = try? JSONSerialization.jsonObject(with: existing) as? [String: Any] {
            dismissedVersion = obj["dismissedVersion"] as? String
            let existingReadyVersion = obj["readyVersion"] as? String
            if existingReadyVersion == latestVersion {
                readyToInstall = (obj["readyToInstall"] as? Bool) ?? false
                readyVersion = existingReadyVersion
                downloadedPath = obj["downloadedPath"] as? String
            }
        }

        let formatter = ISO8601DateFormatter()
        var status: [String: Any] = [
            "currentVersion": currentVersion,
            "latestVersion": latestVersion,
            "url": url,
            "checkedAt": formatter.string(from: Date()),
            "updateAvailable": updateAvailable,
            "downloading": false,
            "readyToInstall": readyToInstall,
        ]
        if let downloadURL = downloadURL { status["downloadURL"] = downloadURL }
        if let dismissedVersion = dismissedVersion { status["dismissedVersion"] = dismissedVersion }
        if let readyVersion = readyVersion { status["readyVersion"] = readyVersion }
        if let downloadedPath = downloadedPath { status["downloadedPath"] = downloadedPath }

        guard let data = try? JSONSerialization.data(withJSONObject: status, options: [.prettyPrinted]) else { return }
        try? data.write(to: URL(fileURLWithPath: path))
    }

    // Plain numeric version comparison — "1.10.0" is newer than "1.9.0",
    // not older, which a naive string compare would get wrong. No
    // pre-release/build-metadata handling (a real release tag is always
    // clean X.Y.Z here — see build.sh's own VERSION comment for why a
    // local dev build's messier `git describe` output is never what
    // ships as a tagged release), and missing components pad with 0 so
    // "1.2" vs "1.2.0" compares equal instead of erroring.
    private static func isNewer(_ a: String, than b: String) -> Bool {
        func parts(_ s: String) -> [Int] {
            s.split(separator: ".").map { Int($0.prefix(while: { $0.isNumber })) ?? 0 }
        }
        let (pa, pb) = (parts(a), parts(b))
        for i in 0..<max(pa.count, pb.count) {
            let (x, y) = (i < pa.count ? pa[i] : 0, i < pb.count ? pb[i] : 0)
            if x != y { return x > y }
        }
        return false
    }

    // MARK: - Update download & install

    // "API TRIGGERS DOWNLOAD, NATIVE CONFIRM BEFORE INSTALL" — THE
    // DELIBERATE SPLIT, AND WHY THE DOWNLOAD ITSELF LIVES IN NODE, NOT HERE.
    //
    // 17-api.js runs as a fully independent, detached process (see
    // startApiServer() in 21-notifier-actions.js) — its lifetime has
    // nothing to do with whether this app is even open. A download
    // triggered from downloadUpdate() living in THIS process would
    // silently do nothing whenever the API is hit while ClassDash.app
    // isn't running, which defeats the entire point of triggering it
    // over the API in the first place. So 26-update-check.js does the
    // actual fetch and writes downloading/readyToInstall/readyVersion/
    // downloadedPath straight into update-status.json — no quarantine
    // concern there either, since a plain download only gets tagged
    // com.apple.quarantine by an app that explicitly opts into
    // LSFileQuarantineEnabled (Safari, Mail) or calls the quarantine
    // APIs directly, neither of which a Node `https.get` does.
    //
    // What still has to live HERE: replacing this app's own running
    // binary on disk and relaunching it needs AppKit (NSWorkspace) and
    // has to happen from inside the actual macOS app, not a detached
    // Node process — installReadyUpdate() below. And the confirmation
    // before that happens is deliberately ONLY ever native (this
    // periodic check + maybeShowInstallPrompt()'s NSAlert): nothing
    // outside this process can trigger or skip it, unlike the download
    // itself, which is safe to start unattended (worst case it wastes
    // some bandwidth and disk space).
    private func readUpdateStatusFile() -> [String: Any]? {
        let path = projectDir + "/update-status.json"
        guard let data = FileManager.default.contents(atPath: path) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    // Ticks independently of updateCheckTimer's 24-hour cadence — a
    // download triggered over the API while this app happens to be
    // open needs to be noticed reasonably soon, not up to a day later.
    // Cheap enough (one file read) that a modest interval costs
    // nothing; matches the auto-fresh-check timer's own 60-second tick
    // just above for the same "cheap enough to just poll" reasoning.
    private func setupInstallPromptCheck() {
        installPromptTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            DispatchQueue.main.async { self?.maybeShowInstallPrompt() }
        }
    }

    // The one and only place installReadyUpdate() can be reached from.
    // Called on launch, every 60 seconds after (setupInstallPromptCheck
    // above), and right after checkForUpdates() finds nothing new to
    // download — reading readyToInstall straight from the file rather
    // than an in-memory flag means this is correct however the ready
    // state actually got there: an API-triggered download that
    // finished while this app was running, one that finished while it
    // wasn't, or one from a previous launch nobody answered yet.
    // Returns whether an install prompt was actually shown — so callers
    // (checkForUpdatesManually() above) know whether to fall back to a
    // real check instead of treating this as having handled things.
    //
    // The fileExists check below isn't just defensive: the recorded
    // download can genuinely vanish out from under a real install —
    // someone deleting what looks like a stray leftover .dmg sitting in
    // their project folder, a cloud-synced project folder evicting the
    // local copy, or the project folder being moved after the download
    // finished (downloadedPath is an absolute path baked in at download
    // time). Previously this just returned with readyToInstall left
    // true forever, which made the manual "Check for Updates…" button a
    // permanent silent no-op once that happened. Clearing the stale
    // fields here means the guard fails cleanly and stays fixed instead
    // of failing the exact same way on every future launch and 60-second
    // poll.
    @discardableResult
    @MainActor
    private func maybeShowInstallPrompt() -> Bool {
        guard let status = readUpdateStatusFile(),
              (status["readyToInstall"] as? Bool) == true,
              let readyVersion = status["readyVersion"] as? String,
              let downloadedPath = status["downloadedPath"] as? String else {
            return false
        }
        guard FileManager.default.fileExists(atPath: downloadedPath) else {
            logWindow("update: \(downloadedPath) is gone — clearing stale ready-to-install state")
            clearStaleReadyState()
            return false
        }
        guard readyVersion != declinedInstallVersion else { return false }

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        let alert = NSAlert()
        alert.messageText = "Install ClassDash \(readyVersion)?"
        alert.informativeText = "The update has already been downloaded. Installing will quit ClassDash and relaunch it as the new version."
        alert.addButton(withTitle: "Install & Relaunch")
        alert.addButton(withTitle: "Later")
        if alert.runModal() == .alertFirstButtonReturn {
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                self?.installReadyUpdate(dmgPath: downloadedPath)
            }
        } else {
            declinedInstallVersion = readyVersion
        }
        return true
    }

    // Same "read existing, touch only these fields" merge every other
    // writer here uses (see recordCheckError above) — clears exactly the
    // fields maybeShowInstallPrompt() found stale (a downloadedPath that
    // no longer exists), leaving whatever the last real check wrote
    // (latestVersion, url, error, ...) untouched.
    private func clearStaleReadyState() {
        let path = projectDir + "/update-status.json"
        var status = readUpdateStatusFile() ?? [:]
        status["readyToInstall"] = false
        status.removeValue(forKey: "readyVersion")
        status.removeValue(forKey: "downloadedPath")
        guard let data = try? JSONSerialization.data(withJSONObject: status, options: [.prettyPrinted]) else { return }
        try? data.write(to: URL(fileURLWithPath: path))
    }

    // MOUNT, COPY, RELAUNCH — THE SAME THREE STEPS build.sh's OWN
    // /Applications INSTALL ALREADY DOES, just from a downloaded .dmg
    // instead of a fresh local build. No sudo/elevation needed: this
    // app got INTO /Applications the same unprivileged way in the
    // first place (a drag in Finder, or build.sh's own `cp -R`) — same
    // permissions apply to replacing it.
    //
    // Deliberately synchronous (Process.waitUntilExit(), not a
    // completion handler like runAction() above) — called from a
    // background queue by maybeShowInstallPrompt() specifically so
    // blocking here doesn't freeze the UI, and the whole sequence has
    // to happen in order anyway (can't copy from a volume that isn't
    // mounted yet).
    private func installReadyUpdate(dmgPath: String) {
        logWindow("install update: mounting \(dmgPath)")

        let attach = Process()
        attach.executableURL = URL(fileURLWithPath: "/usr/bin/hdiutil")
        attach.arguments = ["attach", dmgPath, "-nobrowse", "-plist"]
        let outPipe = Pipe()
        attach.standardOutput = outPipe
        do {
            try attach.run()
        } catch {
            DispatchQueue.main.async { self.showInstallFailedAlert("couldn't mount the update: \(error.localizedDescription)") }
            return
        }
        let plistData = outPipe.fileHandleForReading.readDataToEndOfFile()
        attach.waitUntilExit()

        guard attach.terminationStatus == 0,
              let plist = try? PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any],
              let entities = plist["system-entities"] as? [[String: Any]],
              let mountPoint = entities.compactMap({ $0["mount-point"] as? String }).first else {
            DispatchQueue.main.async { self.showInstallFailedAlert("couldn't mount the update — hdiutil didn't report a mount point") }
            return
        }

        defer {
            let detach = Process()
            detach.executableURL = URL(fileURLWithPath: "/usr/bin/hdiutil")
            detach.arguments = ["detach", mountPoint, "-quiet"]
            try? detach.run()
        }

        let mountedApp = mountPoint + "/ClassDash.app"
        guard FileManager.default.fileExists(atPath: mountedApp) else {
            DispatchQueue.main.async { self.showInstallFailedAlert("the downloaded update doesn't contain ClassDash.app") }
            return
        }

        logWindow("install update: copying to /Applications")
        let destination = "/Applications/ClassDash.app"
        do {
            if FileManager.default.fileExists(atPath: destination) {
                try FileManager.default.removeItem(atPath: destination)
            }
            try FileManager.default.copyItem(atPath: mountedApp, toPath: destination)
        } catch {
            DispatchQueue.main.async { self.showInstallFailedAlert("couldn't install to /Applications: \(error.localizedDescription)") }
            return
        }

        try? FileManager.default.removeItem(atPath: dmgPath)

        // THE INSTALL ACTUALLY HAPPENED — readyToInstall/readyVersion/
        // downloadedPath now describe something that's no longer true.
        // Without this, the NEXT launch's own fresh check would carry
        // readyToInstall forward (writeUpdateStatus()'s own carry-over
        // logic: readyVersion still equals the new latestVersion, since
        // that's exactly what was just installed) pointing at a
        // downloadedPath that no longer exists — status would read
        // "ready" for an install that already happened. Merged in here
        // rather than left to the relaunched instance to notice and
        // clean up itself, since maybeShowInstallPrompt() already
        // guards on the file existing before ever showing the alert —
        // this is about what GET /api/update-status honestly reports,
        // not about anything the UI would have gotten wrong.
        var status = readUpdateStatusFile() ?? [:]
        status["readyToInstall"] = false
        status.removeValue(forKey: "readyVersion")
        status.removeValue(forKey: "downloadedPath")
        if let data = try? JSONSerialization.data(withJSONObject: status, options: [.prettyPrinted]) {
            try? data.write(to: URL(fileURLWithPath: projectDir + "/update-status.json"))
        }

        logWindow("install update: relaunching from \(destination)")

        DispatchQueue.main.async {
            let config = NSWorkspace.OpenConfiguration()
            config.createsNewApplicationInstance = true
            NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: destination), configuration: config) { _, error in
                if let error = error {
                    logWindow("install update: relaunch failed: \(error.localizedDescription)")
                }
            }
            // A moment for the relaunch to actually get going before
            // this instance disappears out from under it — matches
            // the reasoning already documented on lastHandoff further
            // up for why a handoff and this process's own exit can't
            // be assumed instantaneous relative to each other.
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                NSApp.terminate(nil)
            }
        }
    }

    @MainActor
    private func showInstallFailedAlert(_ reason: String) {
        logWindow("install update FAILED: \(reason)")
        let alert = NSAlert()
        alert.messageText = "Couldn't install the update"
        alert.informativeText = reason + "\n\nThe currently installed version was not changed."
        alert.alertStyle = .warning
        alert.runModal()
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
