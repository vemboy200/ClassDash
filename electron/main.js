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
  const { spawn } = require('child_process');
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
