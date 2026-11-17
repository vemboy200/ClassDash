// Services and Sign-ins on a computer following another (58-sync.js): which
// services are on and the plain settings they're read with are the master's
// (shared, so editable and sent there), and what only the computer that
// checks can do (browser sign-ins, the Canvas token, Q's login, the browser)
// is greyed out. Also: the Google account number lives under Sign-ins.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), cp = require('child_process');
const PROJ = T.makeProject(); process.chdir(PROJ);
const { JSDOM, VirtualConsole } = T.jsdom();
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SETTINGS = { language: 'en', email: 'a@example.test', canvas: 'https://x.instructure.com', classroomEnabled: true, edpuzzleEnabled: true, canvasSsoEnabled: true, canvasApiEnabled: true, gradesProvider: 'q' };
const render = () => {
  fs.writeFileSync('settings.json', JSON.stringify(SETTINGS));
  cp.spawnSync('node', ['05-playwright-draft.js', '--redraw'], { cwd: PROJ });
  return fs.readFileSync('summary.html', 'utf8');
};
const open = async () => {
  const vc = new VirtualConsole();
  const dom = await JSDOM.fromFile(path.join(PROJ, 'summary.html'), { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.Element.prototype.scrollIntoView = function () {};
      w.location.reload = () => {};
      w.webkit = { messageHandlers: { classdash: { postMessage: () => {} } } };
    } });
  await sleep(300);
  return dom.window;
};
const section = (d, id) => d.querySelector(`[data-section="${id}"]`);
const greyed = el => !!el && !!el.closest('fieldset.on-master') && el.closest('fieldset.on-master').disabled;

(async () => {
  // ── What sync shares ──
  const sync = require(path.join(PROJ, '58-sync.js'));
  for (const key of ['classroomEnabled', 'edpuzzleEnabled', 'canvasSsoEnabled', 'canvasApiEnabled', 'email', 'account', 'canvas', 'gradesProvider', 'gradesAddress']) {
    if (!sync.SHARED_SETTINGS.includes(key)) ok(false, `${key} is shared`);
  }
  ok(sync.SHARED_SETTINGS.includes('edpuzzleEnabled') && sync.SHARED_SETTINGS.includes('account'), 'which services are on, and their plain settings, are shared with the master');
  ok(!['canvasToken', 'gradesUsername', 'browserPath'].some(k => sync.SHARED_SETTINGS.includes(k)), 'the Canvas token, Q\'s username and the browser are not');

  // ── Not following: everything as before ──
  let html = render();
  ok(!/class="on-master"/.test(html), 'not following: nothing greyed out');
  let w = await open(), d = w.document;
  ok(!section(d, 'svc-classroom').querySelector('[data-key="account"]'), 'the Google account number isn\'t on Classroom\'s page any more');
  const acct = section(d, 'sign-ins').querySelector('[data-key="account"]');
  ok(!!acct && !acct.disabled, 'it\'s under Sign-ins, with the Google sign-in');
  w.addService('edpuzzle');
  ok(section(d, 'svc-edpuzzle').classList.contains('svc-setting-up'), 'adding a service still waits for its sign-in');
  ok(!!d.getElementById('ai-scan-pick') && !greyed(d.querySelector('[data-bool-key="aiSkipClasswork"]')), 'the announcement scan\'s AI can be picked');
  w.close();

  // ── Following a master called "Mac" ──
  fs.writeFileSync('sync.json', JSON.stringify({ master: { name: 'Mac', fp: 'AA:BB', key: 'k', localUrl: 'https://127.0.0.1:1' } }));
  html = render();
  ok(/Sign-ins, passwords and keys are set up on Mac, the computer that checks\./.test(html), 'following: says where sign-ins and keys are set up');
  w = await open(); d = w.document;
  const signInButtons = [...section(d, 'sign-ins').querySelectorAll('[onclick*="setupSignIn"]')];
  ok(signInButtons.length > 0 && signInButtons.every(greyed), 'Sign-ins: every Sign In… is greyed out');
  ok(greyed(section(d, 'sign-ins').querySelector('[onclick*="lookAgain"]')), '...and Look again, which reads this computer\'s browser');
  const acct2 = section(d, 'sign-ins').querySelector('[data-key="account"]');
  ok(!!acct2 && !greyed(acct2) && !acct2.disabled, 'but the Google account number can still be changed (it\'s sent to the master)');
  ok([...section(d, 'svc-classroom').querySelectorAll('[onclick*="setupSignIn"]')].every(greyed), 'a service\'s own sign-in step is greyed out');
  const email = section(d, 'svc-classroom').querySelector('[data-key="email"]');
  ok(!!email && !greyed(email), 'Classroom\'s school email can be changed');
  ok(greyed(section(d, 'svc-canvas').querySelector('[data-key="canvasToken"]')), 'Canvas: the access token is greyed out');
  ok(!greyed(section(d, 'svc-canvas').querySelector('[data-key="canvas"]')) && !greyed(section(d, 'svc-canvas').querySelector('[data-bool-key="canvasApiEnabled"]')), '...its address and which ways it uses aren\'t');
  ok(greyed(section(d, 'svc-q').querySelector('[data-key="gradesUsername"]')) && greyed(d.getElementById('grades-password')), 'Q: username and password are greyed out');
  ok(!greyed(section(d, 'svc-q').querySelector('[data-key="gradesAddress"]')) && !greyed(section(d, 'svc-q').querySelector('[onclick*="checkGradesNow"]')), '...its address and Check now aren\'t (a check runs on the master)');
  ok(greyed(d.querySelector('[onclick="setupBrowser()"]')), 'the browser choice is greyed out');
  ok(!d.getElementById('ai-scan-pick') && greyed(d.querySelector('[data-bool-key="aiSkipClasswork"]')) && greyed(d.querySelector('[data-key="aiScanMinFreeGb"]')), 'the announcement scan: no AI picker (it would list this computer\'s), and its settings greyed out');
  ok(/Mac reads the announcements, so their AI is set up there\./.test(html), '...saying the master reads them');
  w.addService('edpuzzle');
  const ed = section(d, 'svc-edpuzzle');
  ok(!ed.classList.contains('svc-setting-up') && ed.querySelector('.svc-off-row') && !greyed(ed.querySelector('.svc-off-row button')), 'adding a service doesn\'t wait for a sign-in only the master can do, and Turn off works');
  w.close();

  // A settings save here: the shared part goes to the master.
  const change = sync.sharedConfigChange(Buffer.from(JSON.stringify({ edpuzzleEnabled: false, canvasToken: 'secret', account: 2 })).toString('base64url'));
  const sent = change && JSON.parse(Buffer.from(change, 'base64url').toString('utf8'));
  ok(sent && sent.edpuzzleEnabled === false && sent.account === 2 && !('canvasToken' in sent), 'turning a service off goes to the master, the token doesn\'t: ' + JSON.stringify(sent));
})().catch(e => { console.log('FAIL', e.stack); process.exitCode = 1; });
