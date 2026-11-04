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
  ok('Quick check, Full check and the status dots are under Settings', ['quickcheck-button', 'freshcheck-button'].every(id => d.querySelector('#app-nav .nav-actions #' + id)) &&
    !!d.querySelector('#app-nav .nav-actions .check-status') && !d.querySelector('header .reload, header .check-status'));
  const edit = d.getElementById('dash-edit');
  ok('an Edit button on the dashboard, with what it does as its tooltip', !!edit && edit.textContent.trim() === 'Edit' && /Edit the dashboard/.test(edit.title) && !d.body.classList.contains('dash-editing'));
  edit.click();
  ok('Edit turns edit mode on and says Done', d.body.classList.contains('dash-editing') && edit.textContent.trim() === 'Done' && edit.getAttribute('aria-pressed') === 'true');
  edit.click();
  ok('Done turns it off again', !d.body.classList.contains('dash-editing') && edit.textContent.trim() === 'Edit');
  edit.click();
  w.showPage('settings');
  ok('leaving the Dashboard ends edit mode', !d.body.classList.contains('dash-editing') && edit.textContent.trim() === 'Edit');
  w.showPage('dashboard');
  const cards = [...d.querySelectorAll('.dash-card')].map(c => c.getAttribute('data-dash-card')).join();
  ok('the cards that can come off, each with a Hide; no grades card without grades', cards === 'filters,reminders,calendar,announcements,transcripts' &&
    d.querySelectorAll('.dash-card > .dash-hide').length === 5, cards);
  ok('no assignment list is in one', !d.querySelector('.dash-card [data-has-items]'));
  ok('the corner has just Edit, no Hidden cards list', d.querySelectorAll('.dash-edit-bar button').length === 1 && !d.getElementById('dash-hidden-menu'));
}

// ── edit mode: taking cards off and putting them back ──
{
  const soon = new Date(Date.now() + 2 * 86400000);
  const proj = T.makeProject({ 'settings.json': { language: 'en', dashHidden: ['transcripts'] },
    'last-collection.json': [{ class: 'Made-up Math', id: 'r1', type: 'Assignment', title: 'Problem Set 7', due: null, due_iso: soon.toISOString(), link: 'x' }] });
  const posted = [];
  const w = open(proj, posted);
  const d = w.document;
  const card = id => d.querySelector('.dash-card[data-dash-card="' + id + '"]');
  const last = () => { const m = posted.filter(x => x.action === 'config').pop(); return m && JSON.parse(Buffer.from(m.arg, 'base64url').toString()); };
  ok('a card off in settings is drawn hidden, its button saying Show', card('transcripts').classList.contains('dash-off') && card('transcripts').querySelector('.dash-hide').textContent === 'Show');
  d.getElementById('dash-edit').click();
  ok('edit mode hides the sidebar, nothing else to click halfway through', d.body.classList.contains('dash-editing') && w.getComputedStyle(d.getElementById('app-nav')).display === 'none');
  card('calendar').querySelector('.dash-hide').click();
  ok('Hide hides a card at once and remembers it', card('calendar').classList.contains('dash-off') && card('calendar').querySelector('.dash-hide').textContent === 'Show' && JSON.stringify(last().dashHidden) === '["calendar","transcripts"]', JSON.stringify(last()));
  card('transcripts').querySelector('.dash-hide').click();
  card('calendar').querySelector('.dash-hide').click();
  ok('Show brings them back', !card('calendar').classList.contains('dash-off') && JSON.stringify(last().dashHidden) === '[]', JSON.stringify(last()));
  const box = d.querySelector('.filters input[data-group]');
  box.checked = false;
  card('filters').querySelector('.dash-hide').click();
  ok('hiding the filters resets them first, so nothing stays filtered out unseen', box.checked && card('filters').classList.contains('dash-off'));
  card('filters').querySelector('.dash-hide').click();
  ok("a hidden card's Show, greyed out in edit mode, brings it back", !card('filters').classList.contains('dash-off') && card('filters').querySelector('.dash-hide').textContent === 'Hide');
  w.pageLoadedAt = w.lastInteraction = Date.now() - 60000;
  w.reloadWhenQuiet();
  ok("a redrawn page doesn't reload itself while editing (that ended edit mode)", !w.reloadingForLive);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  ok('Esc ends edit mode, like Done, and the sidebar is back', !d.body.classList.contains('dash-editing') && w.getComputedStyle(d.getElementById('app-nav')).display !== 'none');
  w.lastInteraction = Date.now() - 60000;
  w.reloadWhenQuiet();
  ok('...and after it the page reloads as usual', w.reloadingForLive === true);
}

{
  const S = require('../src/19-settings.js');
  ok('dashHidden takes only known cards', S.validate('dashHidden', ['grades', 'grades']).value.join() === 'grades' && !S.validate('dashHidden', ['overdue']).ok);
}

// ── folded sidebar, and the rest of the first page ──
{
  const proj = T.makeProject({ 'settings.json': { language: 'en' } });
  const d = open(proj).document;
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
  ok("...straight to Aequitas Q's page under Services, not the menu", menu.hidden && shown() === 'svc-q');

  // ── Settings as a menu ──
  w.showPage('dashboard');
  d.getElementById('settings-button').click();
  ok('Settings opens on its menu, every section closed', !menu.hidden && shown() === '');
  ok('Sign out shows only in a browser signed in with the key, not here', d.getElementById('settings-signout').hidden === true);
  ok('a row per section, in order, each with what it holds', [...d.querySelectorAll('.settings-row[data-open]')].map(r => r.getAttribute('data-open')).join() === 'services,ai,classes,schedule,calendar,grades,fetching,display,api,advanced' &&
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

// ── LAN access and rolling the key: app only ──
{
  const proj = T.makeProject({ 'settings.json': { language: 'en' } });
  const lan = d => d.querySelector('[data-bool-key="apiLan"]');
  const roll = d => d.querySelector('button[onclick="rollApiToken()"]');
  const note = d => d.querySelector('[data-app-only-note]');
  const browser = open(proj).document;
  ok('in a browser the LAN switch and Roll are greyed out, not hidden', lan(browser).disabled && roll(browser).disabled && !!lan(browser).closest('label'));
  ok('...with a line saying they\'re changed in the app', note(browser) && !note(browser).hidden && /only be changed in the ClassDash app/.test(note(browser).textContent));
  const app = open(proj, []).document;
  ok('in the app they work, and there\'s no such line', !lan(app).disabled && !roll(app).disabled && note(app).hidden);
}

// ── Quick check and Full check ──
{
  const proj = T.makeProject({ 'settings.json': { language: 'en' } });
  const w = open(proj, []);
  const d = w.document, quick = d.getElementById('quickcheck-button'), full = d.getElementById('freshcheck-button');
  ok('the buttons read Quick check and Full check', quick.querySelector('.reload-label').textContent === 'Quick check' && full.querySelector('.reload-label').textContent === 'Full check');
  ok('Quick check has the wheel, hidden until a check runs', !!quick.querySelector('.pixel-spinner') && !quick.classList.contains('checking'));
  w.applyRunState({ running: true, at: Date.now() });
  ok('while any check runs it shows the wheel and can\'t be pressed', quick.classList.contains('checking') && quick.disabled);
  ok('...and reads Checking…, since it may be a full check running', quick.querySelector('.reload-label').textContent === 'Checking…');
  w.applyRunState({ running: false, at: Date.now() });
  ok('...and goes back once it\'s over', !quick.classList.contains('checking') && !quick.disabled && quick.querySelector('.reload-label').textContent === 'Quick check');
  ok('with Edpuzzle on, Full check is a different check, so it\'s there', !full.hasAttribute('data-quick-only'));
  const off = T.makeProject({ 'settings.json': { language: 'en', edpuzzleEnabled: false } });
  const offFull = open(off, []).document.getElementById('freshcheck-button');
  ok('with Edpuzzle off it\'s the same as Quick check: marked to hide, except as Stop', offFull.hasAttribute('data-quick-only'));
  const html = fs.readFileSync(path.join(off, 'summary.html'), 'utf8');
  ok('...by its CSS', /#freshcheck-button\[data-quick-only\]:not\(\.running\) \{ display: none; \}/.test(html));
}
process.exit(process.exitCode || 0);
