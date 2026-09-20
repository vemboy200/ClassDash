// The Electron wizard's new Canvas-only steps, run against scripted dialogs.
const T = require('./helpers');
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');
const REAL = T.REPO;
const src = fs.readFileSync(path.join(REAL, 'electron/main.js'), 'utf8');
const a = src.indexOf('async function continueNewProjectSetupIfNeeded()');
const b = src.indexOf('// A small floating "still working" indicator');
const block = src.slice(a, b);
const promptA = src.indexOf('async function promptForSettingsThenLogin()');
const promptB = src.indexOf('// Reachable both from the wizard above');
const promptFn = src.slice(promptA, promptB);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

function scenario({ answers, settings, duringDialog }) {
  const dir = T.tmpDir('wiz-');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings));
  const calls = [];
  const dialogs = [];
  const queue = [...answers];
  const win = {
    show() {}, focus() {}, isDestroyed: () => false,
    webContents: {
      once: (ev, fn) => { calls.push('once:' + ev); setImmediate(fn); },
      reload: () => calls.push('reload'),
      executeJavaScript: async (js) => { calls.push('js:' + js); if (duringDialog && /toggleSettingsPanel\(\)$/.test(js)) duringDialog(dir); },
    },
  };
  const ctx = {
    fs, path, projectDir: dir, win, console, setTimeout, setImmediate, Promise,
    isNewProjectSetup: true,
    dialog: { showMessageBox: async (_w, opts) => { dialogs.push(opts.message); const r = queue.shift(); if (typeof r === 'function') r(dir); return { response: typeof r === 'number' ? r : 0 }; } },
    runNodeScriptSync: (script, args) => calls.push('run:' + script + ' ' + args.join(' ')),
    runAction: (action) => calls.push('action:' + action),
    presentBrowserSetup: (cb) => calls.push('presentBrowserSetup'),
    attemptLogin: () => calls.push('attemptLogin'),
  };
  vm.createContext(ctx);
  vm.runInContext(promptFn + '\n' + block + '\nthis.__go = continueNewProjectSetupIfNeeded;\nthis.__prompt = promptForSettingsThenLogin;', ctx);
  return { ctx, dir, calls, dialogs, read: () => JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')) };
}

(async () => {
  // A. "Google Classroom" -> the ordinary browser + sign-in steps, settings untouched
  let s = scenario({ answers: [0], settings: { email: 'a@b', canvas: '' } });
  await s.ctx.__go();
  ok(s.calls.includes('presentBrowserSetup') && !s.calls.some(c => c.startsWith('run:')), 'A Classroom path goes to the browser step and redraws nothing');
  ok(s.read().classroomEnabled === undefined, 'A settings untouched');

  // B. Only Canvas + token, then Done with address AND token entered
  s = scenario({ answers: [1, 0, 0], settings: { email: 'keep@me', canvas: '', language: 'en' },
    duringDialog: (dir) => {} });
  // the user "types" into the panel while the details dialog is open: fill in the file when that dialog appears
  const origShow = s.ctx.dialog.showMessageBox;
  s.ctx.dialog.showMessageBox = async (w, o) => {
    if (o.message === 'Add Your Canvas Details') fs.writeFileSync(path.join(s.dir, 'settings.json'), JSON.stringify({ ...s.read(), canvas: 'https://x.instructure.com', canvasToken: 'tok~1' }));
    return origShow(w, o);
  };
  await s.ctx.__go();
  ok(s.read().classroomEnabled === false && s.read().edpuzzleEnabled === false, 'B Classroom and Edpuzzle switched off');
  ok(s.read().email === 'keep@me' && s.read().language === 'en', 'B other settings kept');
  ok(s.read().canvasSsoEnabled === false, 'B the token path also switches the browser sign-in way off (browserless)');
  ok(s.calls.includes('run:05-playwright-draft.js --redraw'), 'B page redrawn from the new settings');
  const iReload = s.calls.indexOf('reload'), iToggle = s.calls.findIndex(c => c.startsWith('js:toggleSettingsPanel'));
  ok(iReload >= 0 && iToggle > iReload, 'B page reloaded BEFORE the settings panel is opened');
  ok(s.calls.some(c => c.startsWith("js:(function(){var p=document.getElementById('settings-panel')")), 'B panel closed (saved) only if open');
  ok(!s.calls.includes('presentBrowserSetup'), 'B no browser step on the token path');
  ok(s.calls.includes('action:reload'), 'B first check started once address + token are there');
  ok(JSON.stringify(s.dialogs) === JSON.stringify(['What Does Your School Use?', 'How Do You Sign In to Canvas?', 'Add Your Canvas Details']), 'B dialogs in order: ' + JSON.stringify(s.dialogs));

  // C. Only Canvas + token path, but an address with no token -> offered a browser
  s = scenario({ answers: [1, 0, 0, 0], settings: { canvas: '' } });
  const showC = s.ctx.dialog.showMessageBox;
  s.ctx.dialog.showMessageBox = async (w, o) => {
    if (o.message === 'Add Your Canvas Details') fs.writeFileSync(path.join(s.dir, 'settings.json'), JSON.stringify({ ...s.read(), canvas: 'https://x.instructure.com' }));
    return showC(w, o);
  };
  await s.ctx.__go();
  ok(s.dialogs.includes('No Access Token'), 'C address without a token is called out');
  ok(s.calls.includes('presentBrowserSetup') && !s.calls.includes('action:reload'), 'C "Set Up a Browser" goes to the browser step, no check started');
  ok(s.read().canvasSsoEnabled === true, 'C choosing a browser switches the browser sign-in way back on');
  {
    const redraws = s.calls.map((c, i) => c.startsWith('run:') ? i : -1).filter(i => i >= 0);
    const ib = s.calls.indexOf('presentBrowserSetup');
    ok(redraws.length === 2 && redraws[1] < ib && s.calls.slice(redraws[1], ib).includes('reload'), 'C page redrawn AND reloaded after that write, before the browser step (no stale panel)');
  }

  // C2. ...and choosing to add a token instead does nothing further
  s = scenario({ answers: [1, 0, 0, 1], settings: { canvas: '' } });
  const showC2 = s.ctx.dialog.showMessageBox;
  s.ctx.dialog.showMessageBox = async (w, o) => {
    if (o.message === 'Add Your Canvas Details') fs.writeFileSync(path.join(s.dir, 'settings.json'), JSON.stringify({ ...s.read(), canvas: 'https://x.instructure.com' }));
    return showC2(w, o);
  };
  await s.ctx.__go();
  ok(!s.calls.includes('presentBrowserSetup') && !s.calls.includes('action:reload'), 'C2 "I\'ll Add a Token" does nothing further');

  // D. Only Canvas + Google sign-in -> the browser steps, but with Classroom off
  s = scenario({ answers: [1, 1], settings: { canvas: '' } });
  await s.ctx.__go();
  ok(s.calls.includes('presentBrowserSetup') && s.read().classroomEnabled === false && !s.dialogs.includes('Add Your Canvas Details'), 'D Google sign-in path: browser setup, Classroom off, no token prompt');
  ok(s.read().canvasSsoEnabled === undefined, 'D the Google sign-in path leaves the browser way on (untouched)');

  // E. Nothing entered -> silent
  s = scenario({ answers: [1, 0, 0], settings: { canvas: '' } });
  await s.ctx.__go();
  ok(!s.dialogs.includes('No Access Token') && !s.calls.includes('action:reload'), 'E nothing entered: nothing further');

  // F. "I'll do this later" -> stops before reading anything back
  s = scenario({ answers: [1, 0, 1], settings: { canvas: 'https://x.instructure.com' } });
  await s.ctx.__go();
  ok(!s.calls.some(c => c.startsWith("js:(function(){")) && !s.calls.includes('action:reload'), 'F later: no save, no check');

  // G. the sign-in prompt is titled for what is being signed into
  s = scenario({ answers: [1, 1], settings: { classroomEnabled: false } });
  await s.ctx.__prompt();
  ok(s.dialogs[0] === 'Sign In to Canvas', 'G title with Classroom off: ' + s.dialogs[0]);
  s = scenario({ answers: [1], settings: {} });
  await s.ctx.__prompt();
  ok(s.dialogs[0] === 'Sign In to Google Classroom', 'G title with Classroom on: ' + s.dialogs[0]);

  console.log(`wizard-electron: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
