// Q signing in fine but then asking for a new password (an expired one):
// ClassDash signs out, stops trying that password, and passes Q's words on
// for the person to set a new one on Q's own site. Made-up pages and
// passwords; the browser is a stand-in, never a real one.
process.env.CLASSDASH_GRADES_STORE = 'file';
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const { JSDOM, VirtualConsole } = T.jsdom();

const SAID = 'Your password has expired. Please create a new password to continue.';
const pages = {
  login: `<form><input id="Pin"><input id="Password" type="password"><button id="LoginButton">Log In</button>
    <a href="#">Forgot your password? Reset your password here</a><p>Passwords expire every 90 days, and you'll be asked for a new password then.</p><div id="loginerrormsg"><span class="error" hidden>Invalid</span></div></form>`,
  change: `<div class="notice"><h3>Password</h3><p>${SAID}</p></div>
    <form><label>New Password</label><input type="password"><label>Confirm New Password</label><input type="password"><button>Change Password</button></form>`,
  formOnly: `<form><label>New Password</label><input type="password"><label>Confirm</label><input type="password"><button>Save</button></form>`,
  portal: `<nav><a href="#">Change Password</a><a href="#">Log Out</a></nav><main><h1>Made-up Student</h1><p>Welcome back to the student portal <span hidden>(your password has expired and needs a reset)</span> for this term.</p>
    <div hidden><p>Your password must be changed every 90 days by the district.</p><input type="password"><input type="password"></div></main>`,
  portalAsked: `<nav><a href="#">Change Password</a></nav><div class="modal"><p>You need to set a new password before you can view your grades.</p></div>`,
};

(async () => {
  const on = { language: 'en', gradesProvider: 'q', gradesAddress: 'q.made-up.example/Production/StudentPortal', gradesUsername: 'made-up-user' };
  const proj = T.makeProject({ 'settings.json': on });
  process.chdir(proj);
  const grades = require(path.join(proj, '40-grades.js'));
  const secret = path.join(proj, 'grades-secret.json');
  grades._setStore(grades.fileStore(secret));
  grades.savePassword('made-up-old-pass');

  // ── telling the request apart ──
  const ask = html => {
    const w = new JSDOM(html, { runScripts: 'outside-only', virtualConsole: new VirtualConsole() }).window;
    w.Element.prototype.checkVisibility = function () { return !this.closest('[hidden]'); };
    return w.eval(`(${grades.newPasswordMessage.toString()})()`);
  };
  ok('the sign-in page itself never counts, its password notes and "Reset" link and all', ask(pages.login) === null);
  const change = ask(pages.change);
  ok('a change-password page: Q\'s own sentence, not a label or the heading', change && change.message === SAID, JSON.stringify(change));
  ok('a form with two password boxes and no sentence still counts', JSON.stringify(ask(pages.formOnly)) === JSON.stringify({ message: null }));
  ok('the portal\'s own "Change Password" link and hidden settings don\'t', ask(pages.portal) === null);
  ok('a request shown over the portal does', ask(pages.portalAsked).message === 'You need to set a new password before you can view your grades.');

  // ── signing in, with a stand-in browser ──
  const fakeChromium = (scene, visited) => ({
    launch: async () => ({
      close: async () => {},
      newContext: async () => ({ newPage: async () => ({
        setDefaultTimeout() {},
        goto: async u => { visited.push(u.replace('https://q.made-up.example/Production/StudentPortal', '')); },
        waitForSelector: sel => sel === '#Pin' ? Promise.resolve() : new Promise(() => {}),
        fill: async () => {}, click: async () => {}, waitForTimeout: async () => {},
        waitForURL: () => scene === 'changePage' ? new Promise(() => {}) : Promise.resolve(),
        waitForFunction: () => scene === 'changePage' ? Promise.resolve(true) : new Promise(() => {}),
        evaluate: async fn => fn === grades.newPasswordMessage
          ? (scene === 'changePage' ? { message: SAID } : scene === 'overPortal' ? { message: 'You need a new password.' } : null)
          : [],
        $: async () => null,
        $eval: async () => '',
      }) }),
    }),
  });
  const read = async scene => {
    const visited = [];
    try {
      const r = await grades.read({ base: 'https://q.made-up.example/Production/StudentPortal', username: 'u', password: 'p', s: on, chromium: fakeChromium(scene, visited) });
      return { r, visited };
    } catch (e) { return { e, visited }; }
  };
  let r = await read('changePage');
  ok('sent to change the password: stops with Q\'s words, as a Rejected', r.e instanceof grades.NewPasswordNeeded && r.e instanceof grades.Rejected && r.e.message === SAID, r.e && r.e.message);
  ok('...and signs out first', r.visited[r.visited.length - 1] === '/Home/Logout', JSON.stringify(r.visited));
  r = await read('overPortal');
  ok('asked over the portal: the same', r.e instanceof grades.NewPasswordNeeded && r.e.message === 'You need a new password.');
  r = await read('normal');
  ok('a normal sign-in carries on to the grades', !r.e && Array.isArray(r.r), r.e && r.e.message);

  // ── what a check does with it ──
  let tries = 0;
  const wanting = async () => { tries++; throw new grades.NewPasswordNeeded(SAID); };
  let c = await grades.check({ force: true, reader: wanting });
  const saved = JSON.parse(fs.readFileSync(path.join(proj, 'grades.json'), 'utf8'));
  ok('the check fails with Q\'s words, remembered as wanting a new password', !c.ok && c.why === SAID && saved.newPassword === true && !!saved.rejected);
  c = await grades.check({ force: true, reader: wanting });
  ok('...and never signs in with that password again, not even Check now', c.skipped === 'rejected' && tries === 1);
  const view = grades.gradesView();
  ok('the API says so: newPassword, with Q\'s words as why', view.newPassword === true && view.rejected === true && view.why === SAID);

  // ── the page ──
  {
    T.redraw(proj);
    const d = new JSDOM(fs.readFileSync(path.join(proj, 'summary.html'), 'utf8'), { virtualConsole: new VirtualConsole() }).window.document;
    const note = d.querySelector('#grades-section .grades-problem');
    ok('the Grades list passes Q\'s words on, and what to do', note && note.textContent.includes(`It said: "${SAID}"`) && /Set a new password on Q's site in your browser, then save it in Settings → Grades/.test(note.textContent), note && note.textContent);
    const open = d.querySelector('#grades-section .grades-fix a');
    ok('...with Open Q (Q\'s sign-in page, in the browser) and a way to Settings → Grades', open && open.getAttribute('href') === 'https://q.made-up.example/Production/StudentPortal/' && open.getAttribute('target') === '_blank' &&
      /openGradesSettings/.test(d.querySelector('#grades-section .grades-fix button').getAttribute('onclick')));
    ok('Settings → Grades says it too', /Q wants a new password/.test(d.getElementById('grades-check-status').textContent));
  }
  {
    const w = new JSDOM(fs.readFileSync(path.join(proj, 'summary.html'), 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://classdash.localhost/summary.html', virtualConsole: new VirtualConsole(),
      beforeParse(win) { win.setTimeout = () => 0; win.setInterval = () => 0; win.Element.prototype.scrollIntoView = () => {}; } }).window;
    w.document.querySelector('#grades-section .grades-fix button').click();
    const shown = [...w.document.querySelectorAll('.settings-section')].filter(x => !x.hidden).map(x => x.getAttribute('data-section'));
    ok('the button opens Settings at Grades, on the password box', !w.document.getElementById('settings-panel').hidden && JSON.stringify(shown) === '["grades"]' &&
      w.document.activeElement === w.document.getElementById('grades-password'), JSON.stringify(shown));
    w.close();
  }

  // ── saving the new one ──
  const notifier = require(path.join(proj, '21-notifier-actions.js'));
  let started = 0;
  grades._setStartCheck(() => { started++; });
  const res = await notifier.main('saveGradesPassword', Buffer.from(JSON.stringify('made-up-new-pass')).toString('base64url'));
  ok('saving a new password checks Q right away', res.ok && started === 1);
  ok('...and that new password is due (the old one\'s refusal doesn\'t hold it back)', grades.due(Date.now(), { force: true }).due === true);
  c = await grades.check({ force: true, reader: async () => [{ period: '1', class: 'Made-up Biology', grade: 'A', percent: 95, term: 'S1', assignments: [] }] });
  const after = JSON.parse(fs.readFileSync(path.join(proj, 'grades.json'), 'utf8'));
  ok('...and once it works, the request is cleared', c.ok && !after.newPassword && !after.rejected && grades.gradesView().newPassword === false);
  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ ...on, gradesUsername: '' }));
  await notifier.main('saveGradesPassword', Buffer.from(JSON.stringify('made-up-third')).toString('base64url'));
  ok('not set up yet (no username): no check started', started === 1);
  process.exit(process.exitCode || 0);
})();
