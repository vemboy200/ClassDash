// The sidebar (appNav and showPage in 08-page.js): Dashboard, Workspace,
// the Grades center and Settings, one page showing at a time, the item
// for it lit, and each page closed the way its own Close does on the way
// out (Settings saves). Made-up settings; the app is a stand-in bridge.
process.env.CLASSDASH_GRADES_STORE = 'file';
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const { JSDOM, VirtualConsole } = T.jsdom();

function open(proj, posted, timers) {
  T.redraw(proj);
  return new JSDOM(fs.readFileSync(path.join(proj, 'summary.html'), 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://classdash.localhost/summary.html', virtualConsole: new VirtualConsole(),
    beforeParse(win) {
      win.Element.prototype.scrollIntoView = function () {};
      win.setTimeout = (fn, ms) => { if (timers) timers.push([ms, fn]); return timers ? timers.length : 0; };
      win.clearTimeout = () => {};
      win.setInterval = () => 0;
      if (posted) win.webkit = { messageHandlers: { classdash: { postMessage: m => posted.push(m) } } };
    } }).window;
}
const lit = d => Array.from(d.querySelectorAll('.nav-item[aria-current="page"]')).map(b => b.getAttribute('data-page'));

// ── a plain browser tab, no grades: Dashboard and Settings only ──
{
  const proj = T.makeProject({ 'settings.json': { language: 'en' } });
  const w = open(proj);
  const d = w.document;
  ok('the sidebar is there, Dashboard lit', !!d.getElementById('app-nav') && lit(d).join() === 'dashboard' && d.body.getAttribute('data-page') === 'dashboard', lit(d).join());
  ok('no Grades center item without grades', !d.getElementById('nav-grades') && !d.getElementById('grades-center'));
  ok('no Workspace item outside the app', d.getElementById('workspace-button').style.display === 'none');
  ok('the header lost its Workspace and gear buttons', !d.querySelector('header #settings-button') && !d.querySelector('header #workspace-button'));
  ok('the gear item keeps its "Saving… / Saved." spot', !!d.querySelector('#settings-button #settings-status'));
  ok("ClassDash's name is at the top of the sidebar, not the header", d.querySelector('#app-nav .nav-brand').textContent === 'ClassDash' && !d.querySelector('header h1'));
  ok('Refresh, Fresh check and the status dots are under Settings', ['refresh-button', 'freshcheck-button'].every(id => d.querySelector('#app-nav .nav-actions #' + id)) &&
    !!d.querySelector('#app-nav .nav-actions .check-status') && !d.querySelector('header .reload, header .check-status'));
  ok('starts unfolded', !d.getElementById('app-nav').classList.contains('collapsed') && !d.body.classList.contains('nav-collapsed'));
}

// ── folded, remembered ──
{
  const proj = T.makeProject({ 'settings.json': { language: 'en', navCollapsed: true } });
  const d = open(proj).document;
  ok('navCollapsed draws it folded, no flash', d.getElementById('app-nav').classList.contains('collapsed') && d.body.classList.contains('nav-collapsed') &&
    d.getElementById('nav-toggle').getAttribute('aria-expanded') === 'false' && d.getElementById('nav-toggle').title === 'Expand the sidebar');
  ok("folded, an item's name is its tooltip", d.getElementById('nav-dashboard').title === 'Dashboard');
  ok('each item has its own icon', ['nav-dashboard icon-dashboard', 'workspace-button icon-workspace', 'settings-button icon-settings'].every(x => { const [id, c] = x.split(' '); return d.querySelector('#' + id + ' .nav-icon').classList.contains(c); }));
}

// ── in the app, with grades ──
{
  const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'made-up@student.example', gradesProvider: 'q', gradesAddress: 'q.made-up.example/Production/StudentPortal', gradesUsername: 'made-up-user' } });
  const posted = [], timers = [];
  const w = open(proj, posted, timers);
  const d = w.document;
  const settings = d.getElementById('settings-panel'), center = d.getElementById('grades-center'), workspace = d.getElementById('workspace-panel');
  ok('the Grades center has its A+', d.querySelector('#nav-grades .nav-icon').classList.contains('icon-grades'));
  ok('all four items in the app with grades', ['nav-dashboard', 'workspace-button', 'nav-grades', 'settings-button'].every(id => d.getElementById(id)) &&
    d.getElementById('workspace-button').style.display === '');

  d.getElementById('settings-button').click();
  ok('Settings opens as a page and lights up', !settings.hidden && lit(d).join() === 'settings' && d.body.getAttribute('data-page') === 'settings');
  ok('Settings sits straight under main, so the page CSS can show it alone', settings.parentElement.tagName === 'MAIN');
  d.getElementById('settings-button').click();
  ok('clicking Settings again keeps it open', !settings.hidden);

  const field = settings.querySelector('input[type="text"][data-key]');
  field.value = field.value + 'x';
  posted.length = 0;
  d.getElementById('nav-grades').click();
  ok('leaving Settings saves it, as Done does', settings.hidden && posted.some(m => m.action === 'config'), JSON.stringify(posted.map(m => m.action)));
  ok('the Grades center opens, lit, the page under it held still', !center.hidden && lit(d).join() === 'grades' && d.body.style.overflow === 'hidden');

  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  ok('Esc in the Grades center goes back to the Dashboard', center.hidden && lit(d).join() === 'dashboard' && d.body.style.overflow === '');

  posted.length = 0;
  d.getElementById('workspace-button').click();
  ok('Workspace opens, lit', !workspace.hidden && lit(d).join() === 'workspace' && posted.some(m => m.action === 'workspacePage'));
  timers.length = 0;
  d.getElementById('nav-dashboard').click();
  ok('leaving the workspace lights the Dashboard at once, while it saves', lit(d).join() === 'dashboard' && !workspace.hidden);
  const finish = timers.find(([ms]) => ms === 2000);
  finish[1]();
  ok('then the workspace closes', workspace.hidden && d.body.style.overflow === '');

  w.toggleSettingsPanel();
  ok("the app's own Settings… lights the item too", lit(d).join() === 'settings');
  w.toggleSettingsPanel();
  ok('and closing it the same way goes back', lit(d).join() === 'dashboard');

  posted.length = 0;
  d.getElementById('nav-toggle').click();
  const sent = posted.find(m => m.action === 'config');
  ok('☰ folds it at once and remembers it', d.getElementById('app-nav').classList.contains('collapsed') && d.body.classList.contains('nav-collapsed') &&
    !!sent && JSON.parse(Buffer.from(sent.arg, 'base64url').toString()).navCollapsed === true, JSON.stringify(posted));
  d.getElementById('nav-toggle').click();
  ok('and unfolds it', !d.getElementById('app-nav').classList.contains('collapsed') && d.getElementById('nav-toggle').title === 'Collapse the sidebar');

  w.openGradesSettings();
  ok("the grades' Open settings goes to the Settings page", !settings.hidden && lit(d).join() === 'settings');
}
process.exit(process.exitCode || 0);
