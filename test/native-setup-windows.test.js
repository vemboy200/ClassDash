// Windows app: the native setup actions and the "answer the page, don't write the file" sink.
const T = require('./helpers');
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');
const REAL = T.REPO;
const src = fs.readFileSync(path.join(REAL, 'electron/main.js'), 'utf8');
const cut = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); if (a < 0 || b < 0) throw new Error('marker missing: ' + from); return src.slice(a, b); };
const code = [
  cut('const NATIVE_SETUP_ACTIONS', '// ── Live updates'),
  cut('async function presentBrowserSetup', '// UNLIKE 20-browser.js'),
  cut('async function chooseCustomBrowser', '// Opens the real, already-built settings panel'),
].join('\n');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

function world({ answers = {}, open = [], chrome = null, braveOk = true }) {
  const dir = T.tmpDir('nat-');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ email: 'keep@me', browserPath: '' }));
  const log = { reloads: 0, logins: 0, messages: [], errors: [] };
  const opens = [...open];
  const ctx = {
    fs, path: { ...path, basename: path.win32.basename, extname: path.win32.extname }, process, projectDir: dir, console, Promise, setTimeout,
    win: { isDestroyed: () => false, webContents: { once: (e, fn) => setImmediate(fn), reload: () => { log.reloads++; } } },
    dialog: {
      showMessageBox: async (a, b) => {
        const o = b || a; log.messages.push(o.message);
        const q = answers[o.message]; const r = Array.isArray(q) ? q.shift() : q;
        return { response: r === undefined ? 0 : r };
      },
      showOpenDialog: async () => { const p = opens.shift(); return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] }; },
      showErrorBox: (t) => log.errors.push(t),
    },
    showBusyWindow: () => ({ close() {} }),
    installBraveWindows: async () => { if (braveOk) ctx.writeBrowserPathSetting('C:\\Brave\\brave.exe'); return braveOk; },
    chromeExePath: () => chrome,
    braveExePath: () => 'C:\\Brave\\brave.exe',
    attemptLogin: () => { log.logins++; },
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\nthis.run = runNativeSetupAction; this.present = presentBrowserSetup; this.write = writeBrowserPathSetting; this.writeBrowserPathSetting = writeBrowserPathSetting; this.sinkSet = () => browserPathSink !== null;', ctx);
  return { ctx, dir, log, settings: () => JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')) };
}
const SETUP = 'Set Up a Browser for Collection';

(async () => {
  // 1. Install Brave: the path comes back, the file is untouched, no reload
  let w = world({ answers: { [SETUP]: 0 } });
  let r = await w.ctx.run('setupBrowser');
  ok(r.ok && r.browserPath === 'C:\\Brave\\brave.exe', '1 Install Brave answers with the path: ' + JSON.stringify(r));
  ok(w.settings().browserPath === '' && w.log.reloads === 0, '1 settings.json untouched and the page not reloaded (the panel is open)');
  ok(!w.ctx.sinkSet(), '1 the sink is cleared afterwards');

  // 2. Chrome found
  w = world({ answers: { [SETUP]: 1 }, chrome: 'C:\\Chrome\\chrome.exe' });
  r = await w.ctx.run('setupBrowser');
  ok(r.browserPath === 'C:\\Chrome\\chrome.exe' && w.settings().browserPath === '' && w.log.reloads === 0, '2 Chrome: path returned, file untouched');

  // 3. Chrome not found: an error box, nothing changed
  w = world({ answers: { [SETUP]: 1 }, chrome: null });
  r = await w.ctx.run('setupBrowser');
  ok(r.ok && r.browserPath === null && w.log.errors.length === 1, '3 no Chrome: nothing changes, the person is told');

  // 4. Skip for now
  w = world({ answers: { [SETUP]: 3 } });
  r = await w.ctx.run('setupBrowser');
  ok(r.ok && r.browserPath === null, '4 skip: null (nothing changed)');

  // 5. A different browser
  w = world({ answers: { [SETUP]: 2, 'Use vivaldi?': 0 }, open: ['C:\\Vivaldi\\vivaldi.exe'] });
  r = await w.ctx.run('setupBrowser');
  ok(r.browserPath === 'C:\\Vivaldi\\vivaldi.exe' && w.settings().browserPath === '', '5 a different browser: path returned, file untouched');

  // 6. Advanced picker: cancelled
  w = world({ open: [] });
  r = await w.ctx.run('pickBrowserApp');
  ok(r.ok && r.browserPath === null, '6 picker cancelled -> null');

  // 7. Advanced picker: a normal browser needs a confirmation, and a decline goes back to the picker
  w = world({ answers: { 'Use chrome?': [1, 0] }, open: ['C:\\A\\chrome.exe', 'C:\\B\\chrome.exe'] });
  r = await w.ctx.run('pickBrowserApp');
  ok(r.browserPath === 'C:\\B\\chrome.exe', '7 declining the first pick offers the picker again: ' + JSON.stringify(r));
  ok(w.settings().browserPath === '', '7 settings.json untouched');

  // 8. the safety warning is still there for a browser known to be unsafe
  w = world({ answers: { 'arc Is Not Safe to Use Here': [0] }, open: ['C:\\Users\\x\\arc.exe'] });
  r = await w.ctx.run('pickBrowserApp');
  ok(w.log.messages.includes('arc Is Not Safe to Use Here') && r.browserPath === null, '8 the unsafe-browser warning still appears, and declining picks nothing');
  w = world({ answers: { 'arc Is Not Safe to Use Here': [1] }, open: ['C:\\Users\\x\\arc.exe'] });
  r = await w.ctx.run('pickBrowserApp');
  ok(r.browserPath === 'C:\\Users\\x\\arc.exe', '8 "use anyway" is still possible');

  // 9. sign in
  w = world({});
  r = await w.ctx.run('setupSignIn');
  ok(r.ok && w.log.logins === 1, '9 setupSignIn starts the sign-in and answers at once');

  // 10. an exception is answered, and the sink is still cleared
  w = world({});
  w.ctx.dialog.showMessageBox = async () => { throw new Error('dialog blew up'); };
  r = await w.ctx.run('setupBrowser');
  ok(r.ok === false && /blew up/.test(r.why) && !w.ctx.sinkSet(), '10 a failure answers {ok:false} and leaves no sink behind: ' + JSON.stringify(r));

  // 11. the wizard (no sink) still writes the file and reloads, exactly as before
  w = world({ answers: { [SETUP]: 1 }, chrome: 'C:\\Chrome\\chrome.exe' });
  await new Promise(res => w.ctx.present(res));
  ok(w.settings().browserPath === 'C:\\Chrome\\chrome.exe' && w.log.reloads === 1, '11 the wizard still writes browserPath and reloads the page');

  console.log(`native-setup-windows: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
