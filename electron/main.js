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

// Keeps the project folder's scripts in step with this app. The app ships a
// copy of the project and the wizard copies it into the person's folder, but
// nothing ever refreshed that copy: a newer installer replaced the app and
// left the page, the collector and everything else as they were the day the
// folder was made. 30-template-sync.js does the copying (and knows what to
// leave alone — settings, data, and any git checkout); it's run from the
// BUNDLED template because the project may be too old to have it. When
// something actually changed the page is redrawn from the new scripts and a
// running home API server (still the old code, in memory) is restarted.
// Never throws: a failure here must not stop the app from opening, and the
// sync retries on the next launch.
function syncProjectScripts() {
  const templateDir = path.join(process.resourcesPath, 'ProjectTemplate');
  const script = path.join(templateDir, '30-template-sync.js');
  if (!fs.existsSync(script)) return; // an unpackaged run has no bundled template
  try {
    const run = spawnSync(process.execPath, [script, templateDir, projectDir], {
      env: nodeEnv(), encoding: 'utf8', timeout: 120000,
    });
    const line = String(run.stdout || '').trim().split('\n').filter(Boolean).pop();
    const result = JSON.parse(line);
    if (result.ok === false) {
      console.warn('refreshing the project scripts failed:', result.error);
      return;
    }
    if (result.action === 'synced' && (result.changed.length || result.refreshedModules)) {
      runNodeScriptSync('05-playwright-draft.js', ['--redraw'], projectDir);
      runNodeScriptSync('21-notifier-actions.js', ['restartApi'], projectDir);
    }
  } catch (e) {
    console.warn('refreshing the project scripts failed:', e.message);
  }
}

// Tells the project which version is really running, so the page (a static
// snapshot) is built from the true version and not from whatever the last
// update check happened to record. Runs after the script refresh — the
// project's 21-notifier-actions.js has to be the new one — and before the
// window loads the page. See recordRunningVersion in 26-update-check.js.
function noteRunningVersion() {
  runNodeScriptSync('21-notifier-actions.js', ['noteVersion', app.getVersion()], projectDir);
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
// stderr is now piped and captured, not ignored — found live testing a
// real "no compatible browser" report: the dialog that crash detection
// feeds into could only ever show a GUESS at why ("this usually means…"),
// never the actual reason, because stdio: 'ignore' threw away whatever
// Playwright itself printed on the way down. Playwright's own launch
// failures are normally specific and diagnosable (e.g. "Executable
// doesn't exist at ..." or a channel-resolution failure naming exactly
// what it looked for) — worth keeping instead of discarding. stdout
// stays ignored; login() has nothing on stdout worth surfacing here.
// onExit (optional) fires exactly once, the moment the process actually
// terminates — whenever that turns out to be, not just at the fixed
// checkAfterMs deadline. Added for attemptLogin()'s own Done button,
// which needs to know the real moment --login's browser window has
// actually closed, not just whether it survived the first few seconds.
function runNodeScriptDetached(script, args, dir, checkAfterMs, completion, onExit) {
  let child;
  try {
    child = spawn(process.execPath, [path.join(dir, script), ...args], {
      cwd: dir,
      env: nodeEnv(),
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (e) {
    completion(true, e.message);
    return;
  }
  let hasExited = false;
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const markExited = () => {
    if (hasExited) return;
    hasExited = true;
    if (onExit) onExit();
  };
  child.on('exit', markExited);
  child.on('error', markExited);
  child.unref();
  setTimeout(() => completion(hasExited, stderr.trim()), checkAfterMs);
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
// A REAL SPAWNED SUBPROCESS, deliberately NOT an in-process require()
// call the way 17-api.js does it (see its own header comment on why
// that's safe there — nothing it calls ever calls process.exit()).
// That would be safe here too by the same reasoning, but 21-notifier-
// actions.js's own redraw()/fullCheck()/quickCheck()/startApiServer()
// all re-spawn further work via `process.execPath` — which, called
// in-process from an Electron app, IS ClassDash.exe itself, not a
// plain node binary. Found live testing this: settings genuinely saved
// to disk correctly (applyBatch() runs before the broken part), but
// the redraw() a save triggers afterward silently failed to actually
// re-render the page, making a real save look like it hadn't happened
// at all. Spawning this exactly like 16-summary.swift's own runAction()
// does — with ELECTRON_RUN_AS_NODE set — means that same env var
// propagates down to any further child process THIS spawns too,
// fixing every one of those internal re-spawns at once without
// touching 21-notifier-actions.js itself, which has no idea it's ever
// running under Electron at all and shouldn't need to.
function runAction(action, arg) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath,
        [path.join(projectDir, '21-notifier-actions.js'), action, arg || ''],
        { cwd: projectDir, env: nodeEnv() });
    } catch (e) {
      resolve({ ok: false, action, why: e.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => resolve({ ok: false, action, why: e.message }));
    child.on('close', (code) => {
      // 21-notifier-actions.js's own contract: one JSON object as the
      // LAST line of stdout, always, success or failure — see its CLI
      // entry point's own comment on why. Mirrors exactly how
      // 16-summary.swift's runAction() reads its spawned child's output.
      const lines = stdout.split('\n').filter(Boolean);
      const lastLine = lines[lines.length - 1];
      if (code !== 0 || !lastLine) {
        resolve({ ok: false, action, why: stderr.trim() || `node exited with status ${code}` });
        return;
      }
      try {
        resolve(JSON.parse(lastLine));
      } catch (e) {
        resolve({ ok: false, action, why: 'could not parse result: ' + e.message });
      }
    });
  });
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

ipcMain.on('classdash-action', async (_event, body) => {
  if (!body || typeof body !== 'object') return;
  const { id, action, arg } = body;
  if (!id || !action) return;
  // The setup actions need native dialogs (a file picker, message boxes, a
  // browser window), so they never reach the notifier script.
  if (NATIVE_SETUP_ACTIONS.includes(action)) {
    deliverResult(id, await runNativeSetupAction(action));
    return;
  }
  const result = await runAction(action, arg);
  deliverResult(id, result);
});

// Settings → Account → Setup, and Advanced's browser path picker. Each
// answers the page with the same {ok, ...} shape as any bridge action.
//
//   setupBrowser    the "Set Up a Browser" dialog (install Brave / Chrome /
//                   pick one). Answers {browserPath: <path> | null}: a path if
//                   one was chosen (or "" if it should be cleared), null if
//                   nothing about it changed.
//   pickBrowserApp  just the file picker, with its safety warning.
//   setupSignIn     the real sign-in flow (the browser window, the Done
//                   button), answered at once.
const NATIVE_SETUP_ACTIONS = ['setupBrowser', 'pickBrowserApp', 'setupSignIn'];

async function runNativeSetupAction(action) {
  if (action === 'setupSignIn') {
    attemptLogin();
    return { ok: true, action };
  }
  // While the page is the one asking, the chosen path goes back to it
  // instead of into settings.json (see browserPathSink).
  let chosen = null;
  browserPathSink = (browserPath) => { chosen = browserPath; };
  try {
    await new Promise((resolve, reject) => {
      const started = action === 'setupBrowser'
        ? presentBrowserSetup(resolve)
        : chooseCustomBrowser(resolve);
      // Both are async and only call `resolve` when they finish normally; a
      // throw inside would otherwise be an unhandled rejection and the page
      // would wait forever for an answer.
      Promise.resolve(started).catch(reject);
    });
    return { ok: true, action, browserPath: chosen };
  } catch (e) {
    // Answer the page either way: a button that never hears back looks broken.
    return { ok: false, action, why: e.message };
  } finally {
    browserPathSink = null;
  }
}

// ── Live updates ──
//
// The Windows twin of LiveStatePusher in 16-summary.swift; see that and
// 28-live-state.js for the whole story. A collection leaves two small JSON
// files in live/; this watches the folder (not the files — they're replaced
// by renaming a temp file over them) and hands the page both as one call to
// window.classdashLiveChanged, so the page never has to poll. Also pushed
// once per page load, since a page that has just loaded missed everything
// before it existed. What's pushed is re-serialized JSON, never file text
// run as script.
let liveWatcher = null;
let livePushTimer = null;

function readLiveJson(name) {
  try {
    return JSON.stringify(JSON.parse(fs.readFileSync(path.join(projectDir, 'live', name), 'utf8')));
  } catch {
    return 'null';
  }
}

function pushLiveState() {
  if (!win || win.isDestroyed()) return;
  const script = `window.classdashLiveChanged && window.classdashLiveChanged({run: ${readLiveJson('check-run.json')}, version: ${readLiveJson('page-version.json')}});`;
  win.webContents.executeJavaScript(script).catch(() => {});
}

function startLiveWatcher() {
  if (liveWatcher) { liveWatcher.close(); liveWatcher = null; }
  const dir = path.join(projectDir, 'live');
  try {
    fs.mkdirSync(dir, { recursive: true });
    // One write is several events, and there are two files: debounced, so
    // the page gets one call.
    liveWatcher = fs.watch(dir, () => {
      clearTimeout(livePushTimer);
      livePushTimer = setTimeout(pushLiveState, 50);
    });
    liveWatcher.on('error', () => {});
  } catch (e) {
    console.warn(`live watcher: couldn't watch ${dir}: ${e.message}`);
  }
}

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

  win.webContents.on('did-finish-load', pushLiveState);
  startLiveWatcher();
  win.once('closed', () => {
    if (liveWatcher) { liveWatcher.close(); liveWatcher = null; }
  });
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
        // "Choose Browser…" and "Sign In…" used to sit here, reachable any
        // time after the one-time wizard. They moved into Settings →
        // Account → Setup (see runNativeSetupAction()), next to the sources
        // that need them, so they aren't a hidden second place to look.
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    // The page's own keyboard shortcuts for Refresh, Fresh check and the
    // check-status panel, as menu items so they show up (with their keys)
    // where people look for them. Each one calls the same function the page's
    // key handler does (window.classdashShortcut in 08-page.js), so a click
    // here and a keypress in the page can't behave differently. The built-in
    // `reload` role used to sit in the ClassDash menu with Ctrl+R and
    // Ctrl+Shift+R of its own — a menu accelerator is handled before the page
    // ever sees the key, so it would have swallowed both. The plain-letter
    // filter shortcuts (1-9, A, C, M, N…) stay in the page: they aren't menu
    // commands.
    {
      label: 'View',
      submenu: [
        { label: 'Refresh', accelerator: 'CmdOrCtrl+R', click: () => runPageShortcut('refresh') },
        { label: 'Fresh Check', accelerator: 'CmdOrCtrl+Shift+R', click: () => runPageShortcut('fresh') },
        { type: 'separator' },
        { label: 'Check Status', accelerator: 'CmdOrCtrl+S', click: () => runPageShortcut('status') },
      ],
    },
    { role: 'editMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function runPageShortcut(name) {
  if (!win || win.isDestroyed()) return;
  win.webContents
    .executeJavaScript(`window.classdashShortcut && window.classdashShortcut('${name}')`)
    .catch(() => {});
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
async function continueNewProjectSetupIfNeeded() {
  if (!isNewProjectSetup) return;
  isNewProjectSetup = false; // only ever runs once, right after creation

  // THE FIRST QUESTION DECIDES WHETHER A BROWSER IS NEEDED AT ALL. Google
  // Classroom and Edpuzzle can only be read through a real browser, so a
  // school that uses either gets the browser and sign-in steps below. A
  // school that only uses Canvas doesn't need them: Canvas can be read
  // with an access token instead. Mirrors continueNewProjectSetupIfNeeded()
  // in 16-summary.swift.
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    message: 'What Does Your School Use?',
    detail: 'Google Classroom (and Edpuzzle) can only be read through a real browser, so ' +
      'ClassDash sets one up and has you sign in. If your school only uses Canvas, ' +
      'ClassDash can skip the browser entirely.',
    buttons: ['Google Classroom', 'Only Canvas'],
    defaultId: 0,
  });
  if (response === 1) {
    await continueCanvasOnlySetup();
    return;
  }
  presentBrowserSetup(() => promptForSettingsThenLogin());
}

// The project's settings.json as an object — for the wizard, which needs to
// read a couple of values and write a couple of others without going
// through the settings panel. (Empty if the file is missing or unreadable.)
function readSettingsFile() {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectDir, 'settings.json'), 'utf8'));
  } catch {
    return {};
  }
}

// Read-modify-write, so everything else in the file is left as it was.
function updateSettingsFile(changes) {
  try {
    fs.writeFileSync(path.join(projectDir, 'settings.json'),
      JSON.stringify({ ...readSettingsFile(), ...changes }, null, 2));
  } catch {
    /* not fatal — the wizard just won't have set these */
  }
}

// Reloads the page and WAITS for it to finish — see presentBrowserSetup()
// for why "started" isn't enough (a panel opened over the old page renders
// stale values and its first save writes them back).
async function reloadPageAndWait() {
  if (!win || win.isDestroyed()) return;
  await new Promise((resolve) => {
    win.webContents.once('did-finish-load', resolve);
    win.webContents.reload();
    setTimeout(resolve, 5000); // safety net, not the expected path
  });
}

// Writes settings for the wizard, then redraws the page from them and
// reloads it — BEFORE anything opens the settings panel, so a save from that
// panel can't put the old values back (see presentBrowserSetup()).
async function applyWizardSettings(changes) {
  updateSettingsFile(changes);
  runNodeScriptSync('05-playwright-draft.js', ['--redraw'], projectDir);
  await reloadPageAndWait();
}

// "Only Canvas" — but that alone doesn't mean no browser: without an access
// token Canvas is read through the browser's own signed-in session (see
// 10-canvas.js), so the second question is HOW they sign in to Canvas, not
// just which services they use. Mirrors continueCanvasOnlySetup() in
// 16-summary.swift.
async function continueCanvasOnlySetup() {
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    message: 'How Do You Sign In to Canvas?',
    detail: 'An access token needs no browser at all: you create one in Canvas (Account → ' +
      'Settings → New Access Token) and paste it into ClassDash. If your school signs in ' +
      "to Canvas with Google and doesn't let students make tokens, ClassDash can sign in " +
      'through a browser instead.',
    buttons: ['Access Token (No Browser)', 'Google Sign-In (Needs a Browser)'],
    defaultId: 0,
  });
  const useToken = response === 0;

  // Classroom and Edpuzzle off either way: they were never used. On the
  // token path the browser sign-in way is off too — it would only be the
  // fallback, and this path is the one that asks for no browser at all (it
  // can be switched back on in Settings).
  const changes = { classroomEnabled: false, edpuzzleEnabled: false };
  if (useToken) changes.canvasSsoEnabled = false;
  await applyWizardSettings(changes);

  if (useToken) {
    await promptForCanvasDetails();
  } else {
    presentBrowserSetup(() => promptForSettingsThenLogin());
  }
}

// The token path's counterpart to promptForSettingsThenLogin(): the same
// real settings panel, but nothing to sign in to afterwards.
async function promptForCanvasDetails() {
  win.show();
  win.focus();
  win.webContents.executeJavaScript('toggleSettingsPanel()').catch(() => {});

  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    message: 'Add Your Canvas Details',
    detail: 'In the settings above, fill in your Canvas address and paste your access token, ' +
      'then click Done.\n\nTo make a token: in Canvas, open Account → Settings → New Access ' +
      'Token, pick an expiry date, and copy it — Canvas only shows it once.',
    buttons: ['Done', "I'll Do This Later"],
    defaultId: 0,
  });
  if (response !== 0) return;

  // Closing the panel is what saves it (see toggleSettingsPanel() in
  // 08-page.js) — but only if it's still open: calling it on a panel
  // already closed would open it again.
  await win.webContents.executeJavaScript(
    "(function(){var p=document.getElementById('settings-panel');" +
    "if(p&&!p.hidden){toggleSettingsPanel();}})()").catch(() => {});
  // The save goes through the bridge to a separate node process; a moment to
  // land before the file is read back.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await checkCanvasDetails();
}

// What if there's an address but no token? Then Canvas is read the browser
// way — which needs a browser — so say so instead of letting the first
// check fail on it.
async function checkCanvasDetails() {
  const settings = readSettingsFile();
  const address = String(settings.canvas || '').trim();
  const token = String(settings.canvasToken || '').trim();
  if (!address) return; // nothing entered — Canvas stays off until they add it

  if (!token) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      message: 'No Access Token',
      detail: 'You entered a Canvas address but no access token, so ClassDash will need a ' +
        'browser to sign in to Canvas. Set one up now, or add a token in Settings instead — ' +
        'no browser needed.',
      buttons: ['Set Up a Browser', "I'll Add a Token"],
      defaultId: 0,
    });
    if (response === 0) {
      // The browser sign-in way has to be on for a browser to be any use
      // (the token path switched it off).
      await applyWizardSettings({ canvasSsoEnabled: true });
      presentBrowserSetup(() => promptForSettingsThenLogin());
    }
    return;
  }
  // Address and token: everything's there, so start the first check (the
  // page would otherwise just offer "Check now").
  runAction('reload', '');
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
// time afterward from Settings → Account → Setup (see
// runNativeSetupAction() above) — same gap testing the macOS wizard
// live turned up there: skipping this (or wanting to redo it later)
// left no way back short of deleting the project folder and starting
// over. `completion` runs once a choice has actually been made or
// declined — the wizard chains into settings+login there; a
// menu-triggered run just shows a confirmation instead.
async function presentBrowserSetup(completion) {
  // Reloads the page BEFORE running completion() — only for a path that
  // actually wrote browserPath (a successful Brave install, or a
  // confirmed custom-browser pick), never for Chrome/Skip/a failed
  // install, which didn't change anything worth re-reading.
  //
  // Found live testing this, and it's a real bug, not a nice-to-have:
  // 08-page.js's settingsPanel() renders browserPath's value into the
  // Advanced section's input field ONCE, when the page loads — it has
  // no idea this file just wrote a new value straight to settings.json
  // underneath it. saveSettings() then sends EVERY visible field on
  // every save, by design (see its own comment on why) — so the very
  // next ordinary Settings save (adjusting email, say) would resend
  // that field's still-stale, still-empty value and silently overwrite
  // the browserPath this step just set. A reload here means the panel,
  // whenever it's next opened, renders from the real current disk
  // state instead.
  const reloadThenComplete = async () => {
    // Nothing to reload when the settings page asked: it takes the answer and
    // updates its own field (see browserPathSink) — a reload would throw away
    // whatever else is half-typed in its open panel.
    if (browserPathSink) {
      completion();
      return;
    }
    // AWAITS THE RELOAD ACTUALLY FINISHING — a genuine, separate bug
    // from the one described above it, found live in a second round of
    // testing: webContents.reload() only ever STARTS a navigation, it
    // doesn't wait for it. Firing completion() (which opens the
    // settings panel) right away meant that panel was still running
    // against the OLD, pre-reload page — so it rendered the same stale
    // browserPath the reload was supposed to fix, and the very next
    // save re-clobbered it right back to empty. Confirmed exactly by
    // its own signature: the wizard's OWN immediate login (before any
    // save had a chance to run) correctly used the new browser, but
    // sign-in from the menu afterward — after anything got saved from
    // that stale-panel window — reverted to Chrome every time.
    if (win && !win.isDestroyed()) {
      await new Promise((resolve) => {
        win.webContents.once('did-finish-load', resolve);
        win.webContents.reload();
        // Safety net, not the expected path — did-finish-load should
        // always fire for a same-origin file:// reload like this one.
        setTimeout(resolve, 5000);
      });
    }
    completion();
  };

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
    const installed = await installBraveWindows();
    busy.close();
    // Found live testing this: the install can genuinely fail (wrong
    // installer variant downloaded a small stub instead of the full
    // browser — see BRAVE_INSTALLER_URL's own comment) with NO error at
    // all if this isn't checked — completion() would run regardless,
    // making the whole step silently look like it worked.
    if (!installed) {
      dialog.showErrorBox(
        "Brave didn't install correctly",
        'Something went wrong installing Brave. Try "Choose Browser…" in Settings → ' +
        'Account → Setup to install it again, use Chrome instead, or pick a different ' +
        'browser manually.'
      );
      completion();
      return;
    }
    reloadThenComplete();
  } else if (response === 1) {
    // A REAL BUG, FOUND FROM A LIVE REPORT THAT LOOKED LIKE SOMETHING
    // ELSE ENTIRELY: "I Already Have Chrome" used to fall straight into
    // the same completion()-only branch as "Skip for Now" below — it
    // never wrote anything to browserPath at all. That left BROWSER
    // resolution in 05-playwright-draft.js falling through every single
    // time to Playwright's own channel: 'chrome' auto-detection, with
    // no way to tell whether that detection had actually succeeded
    // until a login attempt crashed. The person hitting this described
    // it as the browser choice "forgetting what's selected" — an
    // understandable read of the symptom, but nothing was ever
    // remembered here to forget; this button simply never saved
    // anything, silently, every time.
    //
    // Now actually looks for Chrome at its real, well-known Windows
    // install locations (the same kind of direct, verifiable check
    // braveExePath() already does for Brave, rather than trusting an
    // opaque auto-detection this project has no visibility into) and
    // writes the real path straight into browserPath when found — the
    // same deterministic, diagnosable path every other browser choice
    // here already gets.
    const found = chromeExePath();
    if (found) {
      writeBrowserPathSetting(found);
      reloadThenComplete();
    } else {
      dialog.showErrorBox(
        "Couldn't find Chrome",
        "Chrome isn't in any of its usual install locations. Use \"Choose Browser…\" in " +
        'Settings → Account → Setup to point directly at chrome.exe, or install Brave instead.'
      );
      completion();
    }
  } else if (response === 2) {
    await chooseCustomBrowser(reloadThenComplete);
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
// WRONG TWICE BEFORE THIS — both laptop-updates.brave.com and
// referrals.brave.com were guesses (the first downloaded a small online
// stub instead of the real browser; the second just didn't work at
// all). This one instead comes from Brave's OWN real winget package
// manifest (microsoft/winget-pkgs, Brave.Brave, checked directly via
// `gh api`) — the actual InstallerUrl their x64/user-scope entry uses,
// which needs no InstallerSwitches at all (already silent by design,
// matching this file's own choice to run it with no arguments below).
// /latest/download/ is GitHub's own stable "always the newest release"
// redirect, confirmed live via curl to land on a real ~156MB asset —
// not a hardcoded version number that would go stale.
const BRAVE_INSTALLER_URL =
  'https://github.com/brave/brave-browser/releases/latest/download/BraveBrowserStandaloneSilentSetup.exe';

function braveExePath() {
  return path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser',
    'Application', 'brave.exe');
}

// The three real, well-known places a Windows Chrome install actually
// puts chrome.exe — checked directly and in this order (per-machine
// 64-bit, per-machine 32-bit, per-user) rather than trusting
// Playwright's own opaque channel: 'chrome' resolution, which this
// project has no visibility into when it fails. Returns the first one
// that actually exists on disk, or null if none do — same shape as
// braveExePath() being a known, verifiable path, except Chrome (unlike
// this project's own Brave install) could genuinely be in any of the
// three depending on how it was installed.
function chromeExePath() {
  const candidates = [
    path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function installBraveWindows() {
  return new Promise((resolve) => {
    const installerPath = path.join(app.getPath('temp'), `BraveInstaller-${Date.now()}.exe`);

    const download = (url, redirectsLeft) => {
      let req;
      try {
        req = https.get(url, { timeout: 30000 }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (redirectsLeft <= 0) { resolve(false); return; }
            // A Location header isn't guaranteed to be an absolute URL
            // — resolving it against the URL just requested handles a
            // relative one correctly (an already-absolute one passes
            // through new URL() unchanged either way). Found live
            // testing this: a relative Location here crashed the WHOLE
            // APP with an uncaught "Invalid URL" exception, since
            // https.get() throws SYNCHRONOUSLY for a non-absolute URL
            // string instead of failing just this one download —
            // exactly why this whole call is now wrapped in try/catch,
            // not only guarded by the request's own 'error' event.
            let nextUrl;
            try {
              nextUrl = new URL(res.headers.location, url).toString();
            } catch {
              resolve(false);
              return;
            }
            download(nextUrl, redirectsLeft - 1);
            return;
          }
          if (res.statusCode !== 200) { res.resume(); resolve(false); return; }
          const file = fs.createWriteStream(installerPath);
          res.pipe(file);
          file.on('finish', () => file.close(runInstaller));
        });
      } catch {
        resolve(false);
        return;
      }
      req.on('error', () => resolve(false));
      // An IDLE timeout, not an overall deadline — fires only when the
      // socket goes quiet this long, not just because a ~150MB transfer
      // takes a while. Found live testing this: the laptop went to
      // sleep mid-download, and with no timeout at all the request just
      // hung forever on waking, with the busy panel stuck open and no
      // way back into the app short of force-quitting it.
      req.on('timeout', () => req.destroy(new Error('stalled')));
    };

    function runInstaller() {
      // No arguments — confirmed via the real winget manifest (see
      // BRAVE_INSTALLER_URL's own comment): this exact installer's
      // user-scope entry has no InstallerSwitches at all, unlike the
      // machine-scope one (which needs /silent /install and admin
      // elevation) — "Silent" is already what this specific exe is for.
      let child;
      try {
        child = spawn(installerPath, [], { stdio: 'ignore' });
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
    // %LOCALAPPDATA% was wrong here — confirmed live it left the picker
    // starting somewhere unhelpful (Program Files (x86)), and Chrome
    // and Arc aren't there. %ProgramFiles% (the real, 64-bit one — not
    // the x86 copy) is where a per-machine Chrome install actually
    // lives, confirmed against the user's own real machine. A per-user
    // install (some Chrome/Arc setups use %LOCALAPPDATA%\Programs
    // instead) still just means one extra click to navigate there —
    // not the dead end the wrong default was.
    defaultPath: process.env.ProgramFiles || undefined,
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

// When set, writeBrowserPathSetting() hands the chosen path here instead of
// writing settings.json. Used while the settings page itself is asking for a
// browser (Setup → Choose Browser…, Advanced → Choose App…): the page's panel
// is open with its own copy of every field, so a write to the file underneath
// it would be overwritten by the panel's next save. Instead the path goes back
// to the page, which puts it in its field and saves it with the rest when the
// panel closes.
let browserPathSink = null;

function writeBrowserPathSetting(browserPath) {
  if (browserPathSink) {
    browserPathSink(browserPath);
    return;
  }
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
    // With Classroom turned off (a Canvas-only school on the browser way)
    // what they're signing in to is Canvas.
    message: readSettingsFile().classroomEnabled === false
      ? 'Sign In to Canvas' : 'Sign In to Google Classroom',
    detail: 'Fill in your settings above, then click Sign In — a real browser window ' +
      'will open for you to log in normally, the same as logging into any site. Come ' +
      'back here once you\'re done.',
    buttons: ['Sign In', "I'll Do This Later"],
    defaultId: 0,
  });
  if (response !== 0) return;
  attemptLogin();
}

// Reachable both from the wizard above and any time afterward from Settings →
// Account → Setup (the "setupSignIn" action) — no macOS-style permission gate to
// warn about first on Windows (there's no Privacy & Security equivalent
// to App Management/Automation here), so unlike 16-summary.swift's
// attemptLogin() this goes straight to spawning the login script.
// FOUND LIVE, TWICE IN ONE EVENING: "Done" below used to just dismiss
// its own dialog and kick off a background check — it never actually
// touched the running --login process or the browser window it opened.
// Someone who'd already finished signing in had no way to end the flow
// short of hunting down and manually closing a browser window they
// might not even remember seeing.
//
// The actual fix lives in 05-playwright-draft.js's own login(), which
// polls for a plain file flag and calls ctx.close() itself — not a
// process signal sent from here: SIGTERM/SIGKILL on Windows just force-
// kills the target process outright (no real POSIX signal delivery),
// so a handler over there would never get the chance to run, and the
// real browser window would be orphaned instead of closed. This side's
// job is just to write that flag and then actually wait for the
// process to exit — via onExit, the real moment it happens, not a
// fixed guess at how long that should take.
function attemptLogin() {
  let hasFinished = false;
  runNodeScriptDetached('05-playwright-draft.js', ['--login'], projectDir, 3000, async (crashed, errorText) => {
    if (crashed) {
      // Leads with Playwright's OWN error text when there is any —
      // "no compatible browser is installed" was always a guess at the
      // cause, and a real report showed it guessing wrong: the person
      // had picked "I Already Have Chrome" (which writes nothing to
      // browserPath at all — see presentBrowserSetup()'s response===1
      // branch — it just leaves BROWSER resolution in
      // 05-playwright-draft.js to fall through to Playwright's own
      // channel: 'chrome' auto-detection every time), and it kept
      // failing there in a way that looked exactly like "it forgot what
      // I picked", because nothing was ever actually saved to forget.
      const detail = errorText
        ? `Here's exactly what happened:\n\n${errorText.slice(-800)}\n\nUse "Choose Browser…" ` +
          'in Settings → Account → Setup to install Brave or point directly at a browser\'s .exe, then try again.'
        : 'This usually means no compatible browser is installed. Use "Choose ' +
          'Browser…" in Settings → Account → Setup to install Brave or pick one, then try again.';
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        message: "Couldn't open a browser to sign in",
        detail,
        buttons: ['Try Again', 'Cancel'],
        defaultId: 0,
      });
      if (response === 0) attemptLogin();
      return;
    }
    await dialog.showMessageBox(win, {
      message: 'Signing In',
      detail: 'A browser window should now be open. Log in with your school account, ' +
        'then click Done — this closes the browser and finishes signing in.',
      buttons: ['Done'],
    });

    // Already closed on its own (a person closing the window manually
    // still works exactly like before) — nothing left to wait for.
    if (hasFinished) {
      runAction('check', '');
      return;
    }

    try {
      fs.writeFileSync(path.join(projectDir, 'login-finish-request.txt'), '');
    } catch {
      // Can't ask it to close itself — fall through to the wait below
      // anyway; the person can still close the window by hand.
    }

    const busy = showBusyWindow('Finishing sign-in…');
    await new Promise((resolve) => {
      const deadline = Date.now() + 8000;
      const poll = () => {
        if (hasFinished || Date.now() > deadline) { resolve(); return; }
        setTimeout(poll, 300);
      };
      poll();
    });
    busy.close();

    runAction('check', '');
  }, () => { hasFinished = true; });
}

// Menu-bar entry points — same underlying functions the wizard uses,
// just reachable any time instead of gated behind isNewProjectSetup.
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
    detail: 'The update has already been downloaded. Installing will quit ClassDash and relaunch it as the new version. ' +
      'Windows will ask for administrator permission first.',
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
// not a disk image, and NSIS replaces this app's own files on disk itself
// once this process has actually exited.
//
// WHY THE ELEVATE.EXE STEP — THIS USED TO NEVER WORK, ON ANY MACHINE.
// This build installs per-machine (electron/package.json's nsis.perMachine),
// and NSIS marks a per-machine installer requireAdministrator (confirmed
// in the released .exe's own manifest). spawn() is CreateProcess, which
// can't raise the consent prompt: Windows refuses to start an admin-only
// program from a normal-user process with ERROR_ELEVATION_REQUIRED, and
// libuv reports that as EACCES (src/win/error.c maps exactly that error
// to UV_EACCES; an ordinary access-denied — a file locked by OneDrive or
// an antivirus scan — is EPERM instead). Every attempt to update from
// inside the app failed with "spawn ...update-download.exe EACCES".
//
// The fix is the one electron-builder's own updater uses (see
// NsisUpdater.ts): try the installer directly, and on EACCES run it
// through elevate.exe, which electron-builder ships in resources/ and
// which goes through ShellExecute's "runas" — the thing that actually
// shows the consent prompt. If elevate.exe isn't there (running
// unpackaged with "npm start"), shell.openPath does the same through
// ShellExecute, just with the installer's own wizard instead of a silent
// run.
//
// EARLIER (v1.4.2) THIS WAS MISDIAGNOSED as OneDrive briefly locking the
// freshly downloaded file, and "fixed" with five retries and a hint
// blaming OneDrive. Neither could ever help — the failure was permanent,
// not a race — and the hint sent people looking at the wrong thing. What
// v1.4.2 did get right, and this keeps: the failure arrives as an async
// 'error' event, so it has to be listened for, or it crashes the whole
// app ("A JavaScript error occurred in the main process").
//
// Flags, same as electron-updater passes: --updated (the installer's own
// upgrade mode: skips its wizard pages, keeps shortcuts), /S (silent), and
// --force-run — a silent install doesn't start the app again by itself.
function installReadyUpdate(installerPath) {
  const args = ['--updated', '/S', '--force-run'];

  const fail = (e) => {
    dialog.showErrorBox('Install failed',
      "Couldn't launch the installer" + (e.code ? ' (' + e.code + ')' : '') + ': ' + e.message +
      '\n\nThe update is still downloaded. You can also install it yourself by running:\n' + installerPath);
  };

  // 'spawn' only fires once the OS has actually launched the process; only
  // then is it safe to quit, so the installer can replace this app's files.
  const launch = (exe, exeArgs, onError) => {
    let child;
    try {
      child = spawn(exe, exeArgs, { detached: true, stdio: 'ignore' });
    } catch (e) {
      onError(e);
      return;
    }
    child.once('error', onError);
    child.once('spawn', () => {
      child.unref();
      app.quit();
    });
  };

  const viaElevate = () => {
    const elevate = path.join(process.resourcesPath, 'elevate.exe');
    if (fs.existsSync(elevate)) {
      launch(elevate, [installerPath, ...args], fail);
      return;
    }
    shell.openPath(installerPath).then((err) => {
      if (err) fail(new Error(err));
      else app.quit();
    });
  };

  launch(installerPath, args, (e) => (e.code === 'EACCES' ? viaElevate() : fail(e)));
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
    // Before anything loads the page or runs a script: the project folder's
    // copy of the scripts must match this app's (see 30-template-sync.js).
    syncProjectScripts();
    noteRunningVersion();
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
