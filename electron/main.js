// ClassDash's Windows wrapper — the Electron equivalent of 16-summary.swift.
//
// Bundling Node inside Electron means the actual bridge target
// (21-notifier-actions.js) and everything downstream of it (settings,
// virtual assignments, the update-download logic in 26-update-check.js)
// runs completely unmodified — this file replicates the SHAPE Swift
// exposes (the window.webkit.messageHandlers.classdash bridge, the menu
// items, the fresh-check timer, the update check/install flow), not the
// underlying logic those already-cross-platform files already own.
'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, powerMonitor, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn, spawnSync } = require('child_process');

// Electron's own app.getName() — which drives internal paths like
// getPath('userData') below — defaults to package.json's "name" field
// ("classdash-windows"), not "productName" ("ClassDash") from the build
// config. Only affects Electron's own bookkeeping paths, nothing
// user-visible or functionally broken either way, but there's no reason
// for this file's own config storage to sit under a different name than
// everything else calls this app.
app.setName('ClassDash');

const CONFIG_PATH = path.join(app.getPath('userData'), 'project-dir.json');

let win = null;
let projectDir = null;
let isLocked = false; // mirrors isDisplayAsleep's role, via lock-screen below
let declinedInstallVersion = null;
let freshCheckTimer = null;
let updateCheckTimer = null;
let installPromptTimer = null;

// Set true only by setUpNewProject() succeeding — gates
// continueNewProjectSetupIfNeeded() so an existing-folder launch (the
// ordinary case, every time after the very first) never sees the
// browser/settings/login prompts meant for a brand new setup. Mirrors
// isNewProjectSetup in 16-summary.swift exactly.
let isNewProjectSetup = false;

// Electron's own bundled Node runtime, run as a plain node process
// instead of a second Electron instance — ELECTRON_RUN_AS_NODE makes
// process.execPath (the Electron binary itself) behave like an ordinary
// `node` binary for one invocation. Deliberately NOT a system-installed
// `node`: the whole point of bundling Node via Electron is that nobody
// running this needs one installed separately — falling back to a
// system `node` here would quietly reintroduce exactly the dependency
// the wizard below exists to remove.
function nodeEnv() {
  return { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
}

// Blocking — for one-shot setup steps (the --redraw pass in
// setUpNewProject() below) where the next step genuinely can't start
// until this one has actually finished. Mirrors runNodeScriptSync in
// 16-summary.swift.
function runNodeScriptSync(script, args, dir) {
  spawnSync(process.execPath, [path.join(dir, script), ...args], {
    cwd: dir,
    env: nodeEnv(),
    stdio: 'ignore',
  });
}

// Genuinely fire-and-forget — for --login, which needs to keep running
// (and its real, visible browser window needs to keep existing) for as
// long as the user takes to actually log in. UNLIKE a plain fire-and-
// forget spawn, this reports back whether it crashed almost
// immediately — found the hard way testing this same wizard on macOS: a
// machine with no compatible browser installed makes login() throw
// right away, and with no feedback at all that silently looks exactly
// like nothing happened. checkAfterMs gives it a few seconds (a real
// login run keeps the process alive far longer than that, waiting on
// the browser window closing) before reporting in — long enough to
// catch a launch failure, short enough not to meaningfully delay the
// normal case. Node's child.on('exit', ...) fires on this same
// single-threaded event loop, so — unlike the Swift version, which had
// to explicitly redirect a cross-thread terminationHandler callback
// onto the main queue — there's no equivalent race to guard against here.
function runNodeScriptDetached(script, args, dir, checkAfterMs, completion) {
  let child;
  try {
    child = spawn(process.execPath, [path.join(dir, script), ...args], {
      cwd: dir,
      env: nodeEnv(),
      detached: true,
      stdio: 'ignore',
    });
  } catch {
    completion(true);
    return;
  }
  let hasExited = false;
  child.on('exit', () => { hasExited = true; });
  child.on('error', () => { hasExited = true; });
  child.unref();
  setTimeout(() => completion(hasExited), checkAfterMs);
}

// ── Project folder resolution ──
//
// Swift's resolveProjectDir() has a build-time-baked-path step with no
// Windows equivalent (that step exists specifically to survive a GitHub
// Actions runner's throwaway checkout path ending up in Info.plist — see
// its own comment). Nothing here plays that role: this ships as a
// portable app the user points at an existing project folder explicitly,
// once, and the choice is remembered from then on.
function isValidProjectDir(dir) {
  return !!dir && fs.existsSync(path.join(dir, 'summary.html'));
}

function readStoredProjectDir() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).projectDir || null;
  } catch {
    return null;
  }
}

function writeStoredProjectDir(dir) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ projectDir: dir }));
  } catch {
    /* not fatal — just means asking again next launch */
  }
}

async function resolveProjectDir() {
  if (isValidProjectDir(process.env.CLASSDASH_PROJECT_DIR)) {
    return process.env.CLASSDASH_PROJECT_DIR;
  }
  const stored = readStoredProjectDir();
  if (isValidProjectDir(stored)) return stored;

  // Mirrors the NSAlert in 16-summary.swift's applicationDidFinishLaunching
  // — a real choice instead of only ever asking to locate an existing
  // folder, so a first-time setup never needs git or npm run by hand.
  const welcome = await dialog.showMessageBox({
    type: 'question',
    message: 'Welcome to ClassDash',
    detail: 'ClassDash needs a project folder to work from — the folder that does the ' +
      'actual collecting and stores your data. If you don\'t have one yet, ClassDash can ' +
      'set one up for you, no Terminal needed.',
    buttons: ['Set Up New Project', 'I Already Have a Project Folder'],
    defaultId: 0,
  });

  if (welcome.response === 0) {
    const created = await setUpNewProject();
    if (created) isNewProjectSetup = true;
    return created;
  }

  const result = await dialog.showOpenDialog({
    title: 'Choose your ClassDash project folder',
    message: 'Pick the folder that already has summary.html in it (the one you ran the collector from).',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const chosen = result.filePaths[0];
  if (!isValidProjectDir(chosen)) {
    dialog.showErrorBox(
      'Not a ClassDash project folder',
      `${chosen} doesn't have a summary.html in it yet. Run the collector there first, then relaunch ClassDash.`
    );
    return null;
  }
  writeStoredProjectDir(chosen);
  return chosen;
}

// THE ALTERNATIVE TO THE FOLDER-PICKER ABOVE: creates a new project
// folder instead of locating an existing one. Mirrors setUpNewProject()
// in 16-summary.swift — copies the pristine template electron-builder
// bundles (electron/package.json's own extraResources, the Windows
// equivalent of build.sh's Contents/Resources/ProjectTemplate step) into
// wherever the user picks, then runs one collection-less --redraw pass
// so there's a real summary.html to load before anything's actually
// been collected — already verified live on macOS that this works
// against a fully empty project.
async function setUpNewProject() {
  const result = await dialog.showOpenDialog({
    title: 'Set Up a New ClassDash Project',
    message: 'Choose where to create your ClassDash project folder — pick an empty ' +
      'folder, or use "New Folder" to make one.',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const chosen = result.filePaths[0];

  // Only a packaged build has this — running unpackaged via `npm start`
  // (electron .) has no resourcesPath template at all. Failing here with
  // a clear message is better than copying nothing and leaving a broken
  // half-empty folder.
  const templateDir = path.join(process.resourcesPath, 'ProjectTemplate');
  if (!fs.existsSync(templateDir)) {
    dialog.showErrorBox(
      "Can't set up a new project from this copy",
      'This build doesn\'t have the project template bundled in it. Use "I Already Have ' +
      'a Project Folder" instead, or build ClassDash from source.'
    );
    return null;
  }

  try {
    fs.cpSync(templateDir, chosen, { recursive: true });
    const settingsPath = path.join(chosen, 'settings.json');
    fs.copyFileSync(path.join(chosen, 'settings.example.json'), settingsPath);
    // settings.example.json's own canvas field is a fake-but-valid-
    // looking URL, not an empty string — and 05-playwright-draft.js's
    // CANVAS_ENABLED check treats ANY non-empty value as "yes, read
    // this", not just a real one. Same fix as setUpNewProject() in
    // 16-summary.swift, for the same reason: start correctly in the
    // already-supported "Canvas off" state instead of trying (and
    // failing) to read a fake domain.
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    settings.canvas = '';
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (e) {
    dialog.showErrorBox('Couldn\'t set up the project folder', e.message);
    return null;
  }

  runNodeScriptSync('05-playwright-draft.js', ['--redraw'], chosen);

  writeStoredProjectDir(chosen);
  return chosen;
}

// ── Bridge — the Electron side of 21-notifier-actions.js ──
//
// 17-api.js already calls main(action, arg) as a plain in-process
// function instead of spawning 21-notifier-actions.js as a subprocess
// (see its own header comment on why that's safe: nothing here calls
// process.exit(), so nothing here would tear down a long-lived host
// process early). This does the same thing 16-summary.swift's runAction()
// does over a spawned `node 21-notifier-actions.js` — just without the
// spawn, since this process already IS Node.
function runAction(action, arg) {
  try {
    const notifierActions = require(path.join(projectDir, '21-notifier-actions.js'));
    return notifierActions.main(action, arg || '');
  } catch (e) {
    return { ok: false, action, why: e.message };
  }
}

// Mirrors deliver() in 16-summary.swift exactly: runs in the page's own
// main world via executeJavaScript, calling the same global the page
// already defines for the Swift bridge — see preload.js for why this
// can't just be a renderer-side IPC listener instead.
function deliverResult(requestId, result) {
  if (!win || win.isDestroyed()) return;
  const script = `window.classdashBridgeResult && window.classdashBridgeResult(${JSON.stringify(requestId)}, ${JSON.stringify(result)});`;
  win.webContents.executeJavaScript(script).catch(() => {});
}

ipcMain.on('classdash-action', (_event, body) => {
  if (!body || typeof body !== 'object') return;
  const { id, action, arg } = body;
  if (!id || !action) return;
  const result = runAction(action, arg);
  deliverResult(id, result);
});

// ── Window ──

function loadSummary() {
  win.loadFile(path.join(projectDir, 'summary.html'));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'ClassDash',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 08-page.js has real target="_blank" links (assignments, the update
  // banner's "View Release"). Electron's default for those is to open a
  // second BrowserWindow inside this app, not the user's actual browser
  // — sending them to the system browser instead is what a real <a
  // target="_blank"> click means everywhere else.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  loadSummary();
}

// ── Menu ──
//
// Windows shows this as a real menu bar at the top of the window — the
// expected place for it there, unlike the global app-name menu Mac apps
// use (16-summary.swift's buildMainMenu()). Same three custom items
// (Check for Updates…, Settings…, plus Quit), no Edit/Window submenus —
// those existed on Mac only to route Cmd-C/Cmd-V into the WKWebView;
// Chromium's own default menu already wires up copy/paste/select-all.
function buildMenu() {
  const template = [
    {
      label: 'ClassDash',
      submenu: [
        { label: 'Check for Updates…', click: () => checkForUpdatesManually() },
        { label: 'Settings…', click: () => openSettings() },
        // Both reachable any time, not just during the one-time new-
        // project wizard — see chooseBrowserFromMenu()/attemptLogin()'s
        // own comments for why (the same gap testing the macOS wizard
        // live turned up there).
        { label: 'Choose Browser…', click: () => chooseBrowserFromMenu() },
        { label: 'Sign In to Google Classroom…', click: () => attemptLogin() },
        { type: 'separator' },
        { role: 'reload' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function openSettings() {
  if (!win || win.isDestroyed()) return;
  win.show();
  win.focus();
  win.webContents.executeJavaScript('toggleSettingsPanel()').catch(() => {});
}

// ── New-project setup wizard (continued) ──
//
// setUpNewProject() above only gets a project folder to exist and load
// — everything past that needs the real window to already be up, which
// is why this runs from app.whenReady()'s own callback, after
// createWindow(), instead of being part of setUpNewProject() directly.
// Mirrors continueNewProjectSetupIfNeeded() in 16-summary.swift exactly.
function continueNewProjectSetupIfNeeded() {
  if (!isNewProjectSetup) return;
  isNewProjectSetup = false; // only ever runs once, right after creation
  presentBrowserSetup(() => promptForSettingsThenLogin());
}

// A small floating "still working" indicator — Electron has no native
// panel-plus-spinner control the way AppKit's NSProgressIndicator does,
// so this is a frameless BrowserWindow loading an inline data: URL
// instead. Found live testing the macOS version this replicates: with
// nothing visible on screen during a real ~150MB download, there was no
// way to tell "still working" from "silently stuck."
function showBusyWindow(message) {
  const busy = new BrowserWindow({
    width: 300,
    height: 80,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: { contextIsolation: true },
  });
  const html = '<!doctype html><html><body style="margin:0;display:flex;' +
    'align-items:center;gap:14px;padding:20px;font:14px -apple-system,sans-serif;' +
    'background:#2b2b2b;color:#fff;box-sizing:border-box;height:100%;">' +
    '<div style="width:20px;height:20px;flex:none;border:3px solid #555;' +
    'border-top-color:#4da3ff;border-radius:50%;animation:spin 0.8s linear infinite;">' +
    '</div><div>' + message + '</div>' +
    '<style>@keyframes spin{to{transform:rotate(360deg)}}</style></body></html>';
  // charset=utf-8 is required here, not decorative — without it the "…"
  // in the message argument (e.g. "Installing Brave…") gets read back
  // as Windows-1252 instead of UTF-8, rendering as garbled "â‚¬"-style
  // mojibake. Found live testing this on Windows.
  busy.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  return busy;
}

// The browser-choice step — the wizard's own, but also reachable any
// time afterward from the menu bar's "Choose Browser…" (see
// chooseBrowserFromMenu() below) — same gap testing the macOS wizard
// live turned up there: skipping this (or wanting to redo it later)
// left no way back short of deleting the project folder and starting
// over. `completion` runs once a choice has actually been made or
// declined — the wizard chains into settings+login there; a
// menu-triggered run just shows a confirmation instead.
async function presentBrowserSetup(completion) {
  const { response } = await dialog.showMessageBox({
    type: 'question',
    message: 'Set Up a Browser for Collection',
    detail: 'ClassDash needs a real Chromium-based browser to log in and collect your ' +
      'assignments. Brave is recommended — more privacy-focused than Chrome. About ' +
      '150 MB, one time only — ClassDash will continue automatically once it\'s done.',
    buttons: ['Install Brave (Recommended)', 'I Already Have Chrome',
      'Choose a Different Browser…', 'Skip for Now'],
    defaultId: 0,
  });

  if (response === 0) {
    const busy = showBusyWindow('Installing Brave…');
    await installBraveWindows();
    busy.close();
    completion();
  } else if (response === 2) {
    await chooseCustomBrowser(completion);
  } else {
    completion();
  }
}

// UNLIKE 20-browser.js's Mac install (an isolated copy extracted into
// this project's own .browser/ folder, never touching a system-wide
// install), Windows has no equivalent of "just copy an app bundle out
// and it works standalone" — Brave's Windows distribution is a real
// installer that writes to a standard per-user location. This makes it
// the user's regular Windows Brave too, not project-only — still safe,
// since the isolation the Mac approach protects (never touching a real
// profile) comes from Playwright's own --user-data-dir flag, not from
// the install being physically separate.
//
// LOWER CONFIDENCE THAN THE REST OF THIS FILE: the exact download URL
// and silent-install flags below are a best-effort guess (following
// laptop-updates.brave.com's own URL pattern, already verified working
// for the Mac endpoints in 20-browser.js) rather than something
// verified live — this is the single most likely spot in the whole
// Windows wizard to need adjusting after an actual test run.
const BRAVE_INSTALLER_URL = 'https://laptop-updates.brave.com/latest/winx64';

function braveExePath() {
  return path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser',
    'Application', 'brave.exe');
}

function installBraveWindows() {
  return new Promise((resolve) => {
    const installerPath = path.join(app.getPath('temp'), `BraveInstaller-${Date.now()}.exe`);

    const download = (url, redirectsLeft) => {
      https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) { resolve(false); return; }
          download(res.headers.location, redirectsLeft - 1);
          return;
        }
        if (res.statusCode !== 200) { res.resume(); resolve(false); return; }
        const file = fs.createWriteStream(installerPath);
        res.pipe(file);
        file.on('finish', () => file.close(runInstaller));
      }).on('error', () => resolve(false));
    };

    function runInstaller() {
      // /silent /install: the commonly-documented flags for this
      // Omaha-style (Google-Update-derived) installer family Brave's
      // own Windows build uses — not confirmed against this exact
      // build, see this function's own header comment.
      let child;
      try {
        child = spawn(installerPath, ['/silent', '/install'], { stdio: 'ignore' });
      } catch {
        resolve(false);
        return;
      }
      child.on('exit', () => {
        fs.unlink(installerPath, () => {});
        if (fs.existsSync(braveExePath())) {
          writeBrowserPathSetting(braveExePath());
          resolve(true);
        } else {
          resolve(false);
        }
      });
      child.on('error', () => resolve(false));
    }

    download(BRAVE_INSTALLER_URL, 5);
  });
}

// Manual browser selection — for anyone whose real browser is neither
// Brave nor Chrome. Written straight into settings.json's browserPath,
// the SAME field 05-playwright-draft.js's own BROWSER resolution
// already checks first — no new plumbing needed on the Node side.
//
// THE WARNING BELOW IS NOT DECORATIVE. See 20-browser.js's own header
// comment: Arc silently ignored --user-data-dir once (on macOS), ran
// ClassDash's automation against a REAL everyday profile instead of an
// isolated one, and the real cookies/extensions in that profile didn't
// survive the next normal launch — no backup, no way back. Detection
// here is filename/path-based (no bundle identifier on Windows the way
// macOS has one) — a real, smaller-coverage fallback than the Mac
// check, not a full equivalent.
async function chooseCustomBrowser(completion) {
  const result = await dialog.showOpenDialog({
    title: 'Choose a Browser',
    message: 'Pick the browser ClassDash should use to log in and collect your assignments.',
    properties: ['openFile'],
    filters: [{ name: 'Applications', extensions: ['exe'] }],
    defaultPath: process.env.LOCALAPPDATA || undefined,
  });
  if (result.canceled || !result.filePaths[0]) {
    completion();
    return;
  }

  const chosenPath = result.filePaths[0];
  const displayName = path.basename(chosenPath, path.extname(chosenPath));
  const isKnownUnsafe = chosenPath.toLowerCase().includes('arc');

  let confirmed;
  if (isKnownUnsafe) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      message: `${displayName} Is Not Safe to Use Here`,
      detail: `${displayName} may not respect the isolated profile folder ClassDash asks ` +
        `for. This already happened for real once (on macOS): it silently used the REAL, ` +
        `everyday profile instead of a separate one, and once ClassDash's automation ` +
        `touched it, the real cookies and extensions in that profile did not survive the ` +
        `next normal launch — no backup, no way to undo it. This is not a "probably fine" ` +
        `warning. Use Chrome or Brave instead.`,
      buttons: ['Choose a Different Browser Instead', `Use ${displayName} Anyway (Not Recommended)`],
      defaultId: 0,
    });
    confirmed = response === 1;
  } else {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      message: `Use ${displayName}?`,
      detail: `Only choose a browser you know respects an isolated profile folder (a ` +
        `"--user-data-dir" launch flag) — Chrome and Brave are confirmed safe. If ` +
        `${displayName} doesn't, it could use your REAL everyday profile instead of a ` +
        `separate one, with no way to undo any damage that causes. If you're not sure, ` +
        `use Chrome or Brave instead.`,
      buttons: [`Use ${displayName}`, 'Cancel'],
      defaultId: 0,
    });
    confirmed = response === 0;
  }

  if (!confirmed) {
    await chooseCustomBrowser(completion); // declined/cancelled — try another
    return;
  }

  writeBrowserPathSetting(chosenPath);
  completion();
}

function writeBrowserPathSetting(browserPath) {
  const settingsPath = path.join(projectDir, 'settings.json');
  try {
    const obj = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    obj.browserPath = browserPath;
    fs.writeFileSync(settingsPath, JSON.stringify(obj, null, 2));
  } catch {
    /* not fatal — browser choice just won't be saved */
  }
}

// Opens the real, already-built settings panel (same bridge and page
// every ordinary launch uses — no new settings UI needed for the
// wizard) so the user fills in their email/Canvas domain, then offers
// to start the interactive login.
async function promptForSettingsThenLogin() {
  win.show();
  win.focus();
  win.webContents.executeJavaScript('toggleSettingsPanel()').catch(() => {});

  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    message: 'Sign In to Google Classroom',
    detail: 'Fill in your settings above, then click Sign In — a real browser window ' +
      'will open for you to log in normally, the same as logging into any site. Come ' +
      'back here once you\'re done.',
    buttons: ['Sign In', "I'll Do This Later"],
    defaultId: 0,
  });
  if (response !== 0) return;
  attemptLogin();
}

// Reachable both from the wizard above and any time afterward from the
// menu bar (signInFromMenu below) — no macOS-style permission gate to
// warn about first on Windows (there's no Privacy & Security equivalent
// to App Management/Automation here), so unlike 16-summary.swift's
// attemptLogin() this goes straight to spawning the login script.
function attemptLogin() {
  runNodeScriptDetached('05-playwright-draft.js', ['--login'], projectDir, 3000, async (crashed) => {
    if (crashed) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        message: "Couldn't open a browser to sign in",
        detail: 'This usually means no compatible browser is installed. Use "Choose ' +
          'Browser…" from the menu to install Brave or pick one, then try again.',
        buttons: ['Try Again', 'Cancel'],
        defaultId: 0,
      });
      if (response === 0) attemptLogin();
      return;
    }
    await dialog.showMessageBox(win, {
      message: 'Signing In',
      detail: 'A browser window should now be open. Log in with your school account, ' +
        'then come back and click Done.',
      buttons: ['Done'],
    });
    runAction('check', '');
  });
}

// Menu-bar entry points — same underlying functions the wizard uses,
// just reachable any time instead of gated behind isNewProjectSetup.
function chooseBrowserFromMenu() {
  presentBrowserSetup(() => {
    dialog.showMessageBox(win, {
      message: 'Browser Updated',
      detail: 'Takes effect on the next check — right away if you start one now (the ' +
        'reload button, or Check Now).',
    });
  });
}

// ── Auto fresh-check timer — port of setupAutoFreshCheck() /
// maybeRunAutoFreshCheck() (16-summary.swift:747-865) ──
//
// KNOWN GAP, DELIBERATELY NOT SOLVED HERE (see the plan this was built
// from): Electron's powerMonitor has no macOS-style "the display slept
// but the system didn't" event on Windows. Using lock-screen/unlock-screen
// instead of suspend/resume specifically because suspend freezes this
// whole process (same as real macOS system sleep pausing the Mac version's
// timer too, which needs no special handling for exactly that reason) — a
// locked-but-awake session is the closer analogue to "nobody's using this
// right now" that still leaves the process running to actually notice.
function readFreshCheckSettings() {
  try {
    const obj = JSON.parse(fs.readFileSync(path.join(projectDir, 'settings.json'), 'utf8'));
    const clamp = (n) => (n > 0 && n < 10 ? 0 : n);
    return {
      awake: clamp(obj.freshCheckAwakeMinutes || 0),
      asleep: clamp(obj.freshCheckAsleepMinutes || 0),
      onlyWhenCharging: obj.freshCheckOnlyWhenCharging !== false,
    };
  } catch {
    return { awake: 0, asleep: 0, onlyWhenCharging: true };
  }
}

function minutesSinceLastCollection() {
  try {
    const stat = fs.statSync(path.join(projectDir, 'last-collection.json'));
    return (Date.now() - stat.mtimeMs) / 60000;
  } catch {
    return null;
  }
}

function maybeRunAutoFreshCheck() {
  const { awake, asleep, onlyWhenCharging } = readFreshCheckSettings();
  const intervalMinutes = isLocked ? asleep : awake;
  if (intervalMinutes <= 0) return;

  if (onlyWhenCharging && powerMonitor.isOnBatteryPower()) return;

  const elapsed = minutesSinceLastCollection() ?? Infinity;
  if (elapsed < intervalMinutes) return;

  runAction('check', '');
}

function setupAutoFreshCheck() {
  powerMonitor.on('lock-screen', () => { isLocked = true; });
  powerMonitor.on('unlock-screen', () => { isLocked = false; });
  freshCheckTimer = setInterval(maybeRunAutoFreshCheck, 60 * 1000);
}

// ── Update check / install — Windows-shaped port of
// checkForUpdates()/maybeShowInstallPrompt()/installReadyUpdate()
// (16-summary.swift:900-1360) ──
//
// Checking (this file) and downloading (26-update-check.js, reused
// unmodified) stay split for the same reason Swift/Node split them there:
// a download triggered over the home API has to work even when this
// window isn't open. Only the native install confirmation is duplicated
// per-platform, same as Swift — that step has no meaning outside an
// actual running app instance.
const UPDATE_API_URL = 'https://api.github.com/repos/vemboy200/ClassDash/releases/latest';

function isNewer(a, b) {
  const parts = (s) => s.split('.').map((p) => parseInt(p, 10) || 0);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

function readUpdateStatusFile() {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectDir, 'update-status.json'), 'utf8'));
  } catch {
    return null;
  }
}

function writeUpdateStatusFields(fields) {
  const current = readUpdateStatusFile() || {};
  Object.assign(current, fields);
  try {
    fs.writeFileSync(path.join(projectDir, 'update-status.json'), JSON.stringify(current, null, 2));
  } catch {
    /* not fatal — status just won't reflect this step */
  }
}

// A FULL OVERWRITE, NOT A MERGE — unlike writeUpdateStatusFields() above.
// Matches writeUpdateStatus() in 16-summary.swift exactly: every check
// writes currentVersion/latestVersion/url/checkedAt/updateAvailable fresh,
// and readyVersion/downloadedPath are carried forward ONLY when they
// still match the version just found (see the caller). Using the merge
// helper here instead would leave a stale readyVersion/downloadedPath
// from an OLDER, no-longer-current version sitting in the file forever
// once a newer release ships — the exact bug class the Mac-side
// maybeShowInstallPrompt() fix (v1.3.2) already had to clean up once.
function writeUpdateStatusFull(fields) {
  try {
    fs.writeFileSync(path.join(projectDir, 'update-status.json'), JSON.stringify(fields, null, 2));
  } catch {
    /* not fatal — status just won't reflect this check */
  }
}

function checkForUpdates(manual) {
  const currentVersion = app.getVersion();
  const req = https.get(UPDATE_API_URL, {
    headers: { 'User-Agent': `ClassDash/${currentVersion}` },
    timeout: 15000,
  }, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      let obj;
      try {
        obj = JSON.parse(body);
      } catch {
        writeUpdateStatusFields({ error: "unexpected response from GitHub", checkedAt: new Date().toISOString() });
        if (manual) dialog.showErrorBox("Couldn't check for updates", "Unexpected response from GitHub");
        return;
      }
      if (!obj.tag_name) {
        writeUpdateStatusFields({ error: obj.message || 'unexpected response from GitHub', checkedAt: new Date().toISOString() });
        if (manual) dialog.showErrorBox("Couldn't check for updates", obj.message || 'unexpected response from GitHub');
        return;
      }
      const latestVersion = obj.tag_name.replace(/^v/, '');
      const releaseURL = obj.html_url || 'https://github.com/vemboy200/ClassDash/releases/latest';
      const updateAvailable = isNewer(latestVersion, currentVersion);
      const assets = obj.assets || [];
      // .exe, not .dmg — the one difference from Swift's own asset match.
      const asset = assets.find((a) => (a.name || '').endsWith('.exe'));
      const downloadURL = asset ? asset.browser_download_url : undefined;

      const existing = readUpdateStatusFile() || {};
      const fields = {
        currentVersion, latestVersion, url: releaseURL,
        checkedAt: new Date().toISOString(), updateAvailable, downloading: false,
        readyToInstall: false, error: null,
      };
      if (downloadURL) fields.downloadURL = downloadURL;
      if (existing.dismissedVersion) fields.dismissedVersion = existing.dismissedVersion;
      // Carry a still-matching in-progress/ready download forward — same
      // "only for the version it was recorded against" rule
      // writeUpdateStatus() follows on the Mac side.
      if (existing.readyVersion === latestVersion) {
        fields.readyToInstall = !!existing.readyToInstall;
        fields.readyVersion = existing.readyVersion;
        if (existing.downloadedPath) fields.downloadedPath = existing.downloadedPath;
      }
      writeUpdateStatusFull(fields);

      if (manual) {
        if (updateAvailable) {
          win.show();
          win.focus();
          win.webContents.reload();
          offerToDownload(latestVersion);
        } else {
          dialog.showMessageBox(win, {
            message: "You're up to date",
            detail: `ClassDash ${currentVersion} is the latest version.`,
          });
        }
      }
    });
  });
  req.on('error', (err) => {
    writeUpdateStatusFields({ error: err.message, checkedAt: new Date().toISOString() });
    if (manual) dialog.showErrorBox("Couldn't check for updates", err.message);
  });
  req.on('timeout', () => req.destroy(new Error('timed out')));
}

function offerToDownload(latestVersion) {
  dialog.showMessageBox(win, {
    type: 'question',
    message: `ClassDash ${latestVersion} is available`,
    detail: "Download it now? You'll be asked to confirm again before it's actually installed.",
    buttons: ['Download', 'Not Now'],
    defaultId: 0,
  }).then(({ response }) => {
    if (response === 0) runAction('downloadUpdate', '');
  });
}

// Returns whether an install prompt was actually shown — checkForUpdatesManually()
// below falls back to a real check whenever this is false, same reasoning
// as the Mac fix that made maybeShowInstallPrompt() return Bool there: a
// vanished download or an already-declined version should never leave the
// menu item looking like it did nothing.
function maybeShowInstallPrompt() {
  const status = readUpdateStatusFile();
  if (!status || !status.readyToInstall || !status.readyVersion || !status.downloadedPath) return false;

  if (!fs.existsSync(status.downloadedPath)) {
    writeUpdateStatusFields({ readyToInstall: false, readyVersion: undefined, downloadedPath: undefined });
    return false;
  }
  if (status.readyVersion === declinedInstallVersion) return false;

  win.show();
  win.focus();
  dialog.showMessageBox(win, {
    type: 'question',
    message: `Install ClassDash ${status.readyVersion}?`,
    detail: 'The update has already been downloaded. Installing will quit ClassDash and relaunch it as the new version.',
    buttons: ['Install & Relaunch', 'Later'],
    defaultId: 0,
  }).then(({ response }) => {
    if (response === 0) {
      installReadyUpdate(status.downloadedPath);
    } else {
      declinedInstallVersion = status.readyVersion;
    }
  });
  return true;
}

function checkForUpdatesManually() {
  if (!maybeShowInstallPrompt()) checkForUpdates(true);
}

// Simpler than the Mac mount/copy/relaunch dance (installReadyUpdate() in
// 16-summary.swift): the downloaded asset here is a real NSIS installer,
// not a disk image — /S skips the wizard UI, and NSIS replaces this app's
// own files on disk itself once this process has actually exited, same as
// any ordinary Windows installer overwrite.
//
// NOT ACTUALLY SILENT END-TO-END, though — installer.NSIS's own /S flag
// only skips ITS UI. This build installs per-machine (Program Files,
// electron/package.json's own nsis.perMachine), which needs admin rights;
// Windows has no way to grant that without a UAC consent prompt, and
// nothing running as a normal user process can suppress or pre-answer
// that prompt. The dialog just above this (Install & Relaunch) is
// followed by a SECOND, OS-level one neither this file nor NSIS controls.
function installReadyUpdate(installerPath) {
  try {
    spawn(installerPath, ['/S'], { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    dialog.showErrorBox('Install failed', `Couldn't launch the installer: ${e.message}`);
    return;
  }
  app.quit();
}

function setupUpdateCheck() {
  checkForUpdates(false);
  updateCheckTimer = setInterval(() => checkForUpdates(false), 24 * 60 * 60 * 1000);
  maybeShowInstallPrompt();
  installPromptTimer = setInterval(maybeShowInstallPrompt, 60 * 1000);
}

// ── App lifecycle ──

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    projectDir = await resolveProjectDir();
    if (!projectDir) {
      app.quit();
      return;
    }
    buildMenu();
    createWindow();
    setupAutoFreshCheck();
    setupUpdateCheck();
    continueNewProjectSetupIfNeeded();
  });

  app.on('window-all-closed', () => {
    // Same convention 16-summary.swift's
    // applicationShouldTerminateAfterLastWindowClosed(false) follows on
    // Mac — EXCEPT Windows apps don't have that convention at all
    // (closing the last window normally does quit a Windows app). Quitting
    // here matches the platform's own expectation rather than copying the
    // Mac behavior verbatim.
    app.quit();
  });

  app.on('before-quit', () => {
    clearInterval(freshCheckTimer);
    clearInterval(updateCheckTimer);
    clearInterval(installPromptTimer);
  });
}
