// After the computer restarts: a pid file left from before the restart is
// never taken for the home API server (the system hands its old pid to
// something else), the app starts the server again when it opens
// (ensureApi), and the opt-in "Open at login" setting.
const T = require('./helpers');
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@b', canvas: '', apiEnabled: true, apiPort: 18997, apiNetwork: false } });
process.chdir(proj);
const security = require(path.join(proj, '23-api-security.js'));
const pidFile = security.PID_FILE;
const lastBoot = Date.now() - require('os').uptime() * 1000;
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

// A live process standing in for "whatever got the server's old pid".
const stranger = cp.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });

(async () => {
  // ── the pid file ──
  fs.writeFileSync(pidFile, JSON.stringify({ pid: stranger.pid, boot: Math.round(lastBoot - 3 * 864e5) }));
  ok('a pid from before the last restart isn\'t the server, though something answers to it', security.readPid() === null && !security.isServerRunning());
  fs.writeFileSync(pidFile, JSON.stringify({ pid: stranger.pid, boot: Math.round(lastBoot + 30 * 1000) }));
  ok('one from since the restart is (a little drift allowed)', security.readPid() === stranger.pid && security.isServerRunning());
  fs.writeFileSync(pidFile, String(stranger.pid));
  ok('a pid file from before this check (a bare number) is taken as it is', security.readPid() === stranger.pid);
  fs.writeFileSync(pidFile, 'not a pid');
  ok('...and nonsense isn\'t a pid', security.readPid() === null);

  // ── stopping never signals the stranger ──
  const actions = require(path.join(proj, '21-notifier-actions.js'));
  fs.writeFileSync(pidFile, JSON.stringify({ pid: stranger.pid, boot: Math.round(lastBoot - 864e5) }));
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  actions.main('config', b64({ apiEnabled: false }));
  await sleep(300);   // a signalled child shows up here once it's been reaped
  ok('turning the API off doesn\'t stop a program that got the server\'s old pid', stranger.exitCode === null && stranger.signalCode === null);

  // ── ensureApi, which the app runs when it opens ──
  actions.main('config', b64({ apiEnabled: true }));
  // The save itself starts the server; stop it, and leave a pid file from before a "restart".
  const started = security.readPid();
  if (started) { try { process.kill(started, 'SIGKILL'); } catch {} }
  await sleep(200);
  fs.writeFileSync(pidFile, JSON.stringify({ pid: stranger.pid, boot: Math.round(lastBoot - 864e5) }));
  const r = actions.main('ensureApi', '');
  let fresh = null;
  for (let i = 0; i < 40 && !fresh; i++) { await sleep(150); fresh = security.readPid(); if (fresh === stranger.pid) fresh = null; }
  ok('ensureApi starts the server again after a restart', r.ok && r.started === true && fresh && alive(fresh), JSON.stringify(r));
  ok('...and once it\'s running, it leaves it be', actions.main('ensureApi', '').started === false);
  ok('...and the new pid file says which start of the computer it\'s from', typeof JSON.parse(fs.readFileSync(pidFile, 'utf8')).boot === 'number');
  try { process.kill(fresh, 'SIGKILL'); } catch {}
  stranger.kill('SIGKILL');

  // ── the setting ──
  const settings = require(path.join(proj, '19-settings.js'));
  ok('Open at login is off unless turned on', settings.read().openAtLogin === false);
  const saved = settings.applyBatch(b64({ openAtLogin: true }));
  ok('...and can be saved', saved.ok && settings.read().openAtLogin === true, JSON.stringify(saved));
  ok('...as a true/false only', settings.applyBatch(b64({ openAtLogin: 'yes' })).accepted.length === 0);
  T.redraw(proj);
  const html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
  const row = /<label class="setting-row" data-native-only>\s*<span class="field-name">Open at login<\/span>\s*<input type="checkbox" class="toggle" data-bool-key="openAtLogin" checked>/.test(html);
  ok('Settings → Checking has the switch, in the app only', row);

  // ── the Windows app ──
  const src = fs.readFileSync(path.join(T.REPO, 'electron/main.js'), 'utf8');
  const a = src.indexOf('const AT_LOGIN_ARG'), z = src.indexOf('function createWindow');
  const calls = [];
  const world = (packaged, current) => {
    const dir = T.tmpDir('login-');
    const ctx = { fs, path, projectDir: dir, process: { argv: ['ClassDash.exe'] },
      app: { isPackaged: packaged, getLoginItemSettings: () => ({ openAtLogin: current }), setLoginItemSettings: o => calls.push(o) } };
    vm.createContext(ctx);
    vm.runInContext(src.slice(a, z) + '\nthis.apply = applyOpenAtLogin;', ctx);
    return { ctx, set: on => fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ openAtLogin: on })) };
  };
  let w = world(true, false); w.set(true); w.ctx.apply();
  ok('turned on, the app adds itself, started with --at-login', calls.length === 1 && calls[0].openAtLogin === true && calls[0].args[0] === '--at-login', JSON.stringify(calls));
  calls.length = 0; w = world(true, true); w.set(false); w.ctx.apply();
  ok('turned off, it removes itself (same args, so Windows finds it)', calls.length === 1 && calls[0].openAtLogin === false && calls[0].args[0] === '--at-login');
  calls.length = 0; w = world(true, false); w.ctx.apply();
  ok('no setting at all: off, nothing to change', calls.length === 0);
  calls.length = 0; w = world(false, false); w.set(true); w.ctx.apply();
  ok('a development run never registers itself', calls.length === 0);
  ok('the app starts the API server when it opens, and applies the setting after a save',
    /noteRunningVersion\(\);[\s\S]{0,300}runAction\('ensureApi', ''\);\s*applyOpenAtLogin\(\);/.test(src) &&
    /if \(action === 'config' && result && result\.ok\) applyOpenAtLogin\(\);/.test(src));
  const swift = fs.readFileSync(path.join(T.REPO, 'mac/16-summary.swift'), 'utf8');
  ok('...and so does the Mac app', /runAction\("ensureApi", ""\) \{ _ in \}\s*applyOpenAtLogin\(\)/.test(swift) &&
    /if action == "config" \{ DispatchQueue\.main\.async \{ self\?\.applyOpenAtLogin\(\) \} \}/.test(swift) && /SMAppService\.mainApp/.test(swift));
})();
