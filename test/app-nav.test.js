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
  const menu = d.getElementById('settings-menu');
  const shown = () => [...d.querySelectorAll('.settings-section')].filter(x => !x.hidden).map(x => x.getAttribute('data-section')).join();
  ok('...straight to its Grades section, not the menu', menu.hidden && shown() === 'grades');

  // ── Settings as a menu ──
  w.showPage('dashboard');
  d.getElementById('settings-button').click();
  ok('Settings opens on its menu, every section closed', !menu.hidden && shown() === '');
  ok('a row per section, in order, each with what it holds', [...d.querySelectorAll('.settings-row')].map(r => r.getAttribute('data-open')).join() === 'services,ai,classes,schedule,calendar,grades,fetching,display,api,advanced' &&
    [...d.querySelectorAll('.settings-row-desc')].every(x => x.textContent.trim()));
  d.querySelector('.settings-row[data-open="ai"]').click();
  ok('a row opens its section as a page, with its name and a back arrow', menu.hidden && shown() === 'ai' &&
    d.querySelector('[data-section="ai"] .settings-section-head h2').textContent === 'AI' && !!d.querySelector('[data-section="ai"] .settings-back .icon-back'));
  d.querySelector('[data-section="ai"] .settings-back').click();
  ok('the back arrow goes to the menu, its row focused', !menu.hidden && shown() === '' && d.activeElement === d.querySelector('.settings-row[data-open="ai"]'));
  d.querySelector('.settings-row[data-open="calendar"]').click();
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  ok('Esc goes back to the menu too, and Settings stays open', !menu.hidden && !settings.hidden);
  ok('Schedule and Calendar are pages of their own', !!d.querySelector('[data-section="schedule"] #schedule-settings') && !d.querySelector('[data-section="calendar"] #schedule-settings'));
  ok('Language is under Display, other AI apps under AI', !!d.querySelector('[data-section="display"] [data-key="language"]') && !!d.querySelector('[data-section="ai"] #ai-mcp') && !d.querySelector('[data-section="api"] #ai-mcp'));
  d.querySelector('.settings-row[data-open="display"]').click();
  w.showPage('dashboard');
  d.getElementById('settings-button').click();
  ok('opening Settings again starts at the menu', !menu.hidden && shown() === '');

  // No Done button: hiding the window with changes in Settings saves them.
  const f2 = settings.querySelector('input[type="text"][data-key]');
  f2.value = f2.value + 'y';
  posted.length = 0;
  Object.defineProperty(d, 'hidden', { configurable: true, get: () => true });
  d.dispatchEvent(new w.Event('visibilitychange'));
  ok('hiding the window with Settings changed saves them', posted.some(m => m.action === 'config'), JSON.stringify(posted.map(m => m.action)));
  Object.defineProperty(d, 'hidden', { configurable: true, get: () => false });
}
process.exit(process.exitCode || 0);
