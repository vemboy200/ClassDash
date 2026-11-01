// Settings → Services: a card per service that's on, each with its own page,
// + Add service and Turn off, all driven by the same settings as before.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), cp = require('child_process');
const PROJ = T.makeProject(); process.chdir(PROJ);
const { JSDOM, VirtualConsole } = T.jsdom();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

const render = (settings) => {
  fs.writeFileSync('settings.json', JSON.stringify(settings));
  cp.spawnSync('node', ['05-playwright-draft.js', '--redraw'], { cwd: PROJ });
  return fs.readFileSync('summary.html', 'utf8');
};
const open = async () => {
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(String(e.message || e)));
  const dom = await JSDOM.fromFile(path.join(PROJ, 'summary.html'), { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.Element.prototype.scrollIntoView = function () {}; w.scrollTo = () => {}; } });
  await new Promise(r => setTimeout(r, 300));
  return { w: dom.window, d: dom.window.document, errors };
};
const cards = d => [...d.querySelectorAll('[data-svc-card]')].filter(c => !c.hidden).map(c => c.getAttribute('data-svc-card')).join();
const offered = d => [...d.querySelectorAll('[data-svc-add]')].filter(c => !c.hidden).map(c => c.getAttribute('data-svc-add')).join();
const shown = d => [...d.querySelectorAll('.settings-section')].filter(x => !x.hidden).map(x => x.getAttribute('data-section')).join();
const needs = (d, n) => { const e = d.querySelector(`[data-needs="${n}"]`); return e && !e.hidden; };

(async () => {
  const backup = fs.existsSync('last-collection.json') ? fs.readFileSync('last-collection.json') : null;

  // defaults (an existing install): Classroom, Canvas and Edpuzzle on, Q off
  render({ email: 'a@b.example', canvas: 'https://x.instructure.com', language: 'en' });
  let { w, d, errors } = await open();
  ok(cards(d) === 'classroom,canvas,edpuzzle', 'defaults: Classroom, Canvas and Edpuzzle cards: ' + cards(d));
  ok(offered(d) === 'q,calendar', '+ Add service offers the rest: ' + offered(d));
  ok(d.getElementById('svc-add-menu').hidden, 'the add menu starts closed');
  const badges = id => [...d.querySelectorAll(`[data-svc-card="${id}"] .svc-badge`)].map(b => [...b.classList].find(c => c.startsWith('icon-'))).join();
  ok(badges('classroom') === 'icon-cloud-polling,icon-browser' && badges('canvas') === 'icon-cloud-polling,icon-browser-question' &&
    badges('edpuzzle') === 'icon-cloud-polling,icon-browser-head' && badges('q') === 'icon-cloud-polling,icon-browser' && badges('calendar') === 'icon-cloud-polling',
    'badges: polling on every card; hidden browser, ? for Canvas, a visible window for Edpuzzle, none for the feed');
  ok([...d.querySelectorAll('.svc-badge')].every(b => b.title), 'every badge says what it means');
  ok(/Not checked yet/.test(d.querySelector('[data-svc-card="classroom"] .svc-status').textContent), 'never checked: says so');
  ok(d.querySelector('[data-key="canvasToken"]').type === 'password' && d.querySelector('[data-key="canvas"]').type === 'password', 'address and token are masked');

  // a card opens its page; back returns to Services
  w.showPage('settings');
  w.showSettingsSection('services');
  d.querySelector('[data-svc-card="classroom"]').click();
  ok(shown(d) === 'svc-classroom' && !!d.querySelector('[data-section="svc-classroom"] [data-key="email"]'), "a card opens its own page, with that service's settings");
  ok(/needs a browser/.test(d.querySelector('[data-section="svc-classroom"] .hint').textContent), 'Classroom says it needs a browser');
  d.querySelector('[data-section="svc-classroom"] .settings-back').click();
  ok(shown(d) === 'services' && d.activeElement === d.querySelector('[data-svc-card="classroom"]'), 'back goes to Services, its card focused');
  d.querySelector('[data-svc-card="canvas"]').click();
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  ok(shown(d) === 'services', 'Esc on a service page goes back to Services too');

  // Canvas: its two ways on its page
  const box = k => d.querySelector(`[data-bool-key="${k}"]`);
  const click = k => { box(k).checked = !box(k).checked; box(k).dispatchEvent(new w.Event('change')); };
  const canvasPage = d.querySelector('[data-section="svc-canvas"]');
  ok(canvasPage.contains(box('canvasSsoEnabled')) && canvasPage.contains(box('canvasApiEnabled')), "Canvas's two ways are switches on its page");
  ok(/fallback/.test(canvasPage.textContent) && /no browser or sign-in/.test(canvasPage.textContent), 'Canvas explains its ways');
  click('canvasApiEnabled');
  ok(!needs(d, 'canvasApi') && cards(d) === 'classroom,canvas,edpuzzle', 'API off: the token hides, the card stays (Google sign-in is on)');
  click('canvasSsoEnabled');
  ok(cards(d) === 'classroom,edpuzzle' && offered(d) === 'canvas,q,calendar', 'both ways off: no Canvas card, and Add offers it again');

  // Turn off and Add
  w.removeService('edpuzzle');
  w.showSettingsSection('svc-classroom');
  d.querySelector('[data-section="svc-classroom"] .svc-off-row button').click();
  ok(shown(d) === 'services' && cards(d) === '' && !d.getElementById('svc-none').hidden, 'Turn off: back to Services, no cards left, and it says so');
  let c = w.collectSettings();
  ok(c.classroomEnabled === false && c.email === 'a@b.example', 'turned off, and what was typed is kept: ' + JSON.stringify({ on: c.classroomEnabled }));
  d.getElementById('svc-add-btn').click();
  ok(!d.getElementById('svc-add-menu').hidden, '+ Add service opens its menu');
  d.querySelector('[data-svc-add="edpuzzle"]').click();
  ok(shown(d) === 'svc-edpuzzle' && cards(d) === 'edpuzzle' && box('edpuzzleEnabled').checked && d.getElementById('svc-add-menu').hidden, 'adding Edpuzzle turns it on and opens its page');
  w.addService('canvas');
  ok(box('canvasSsoEnabled').checked && box('canvasApiEnabled').checked && needs(d, 'canvasApi'), 'adding Canvas turns both its ways on, as a new install has them');
  w.addService('q');
  ok(shown(d) === 'svc-q' && d.querySelector('[data-key="gradesProvider"]').value === 'q' && !d.querySelector('[data-grades-for]').hidden, 'adding Q picks it and shows its sign-in');
  w.removeService('q');
  ok(d.querySelector('[data-key="gradesProvider"]').value === 'none' && !/(^|,)q(,|$)/.test(cards(d)), 'turning Q off unpicks it');
  w.addService('calendar');
  ok(shown(d) === 'calendar', 'the calendar feed is added in Settings → Calendar');
  ok(errors.filter(e => !/Not implemented|live\/(check-run|page-version)/.test(e)).length === 0, 'no page script errors: ' + errors.join('|'));
  w.close();

  // rendering follows the saved state
  render({ email: 'a@b.example', canvas: 'https://x.instructure.com', language: 'en', classroomEnabled: false, canvasSsoEnabled: false, canvasToken: 'T~1' });
  ({ w, d } = await open());
  ok(cards(d) === 'canvas,edpuzzle' && needs(d, 'canvasApi'), 'saved: token-only Canvas and Edpuzzle: ' + cards(d));
  w.close();

  // a calendar feed gets a card that opens Settings → Calendar
  fs.writeFileSync('school-calendar.json', JSON.stringify({ ics: { url: 'https://made-up.example/cal.ics', fetchedAt: new Date().toISOString(), events: [{ start: '2026-12-01', end: '2026-12-02', summary: 'Made-up day off', group: 'made-up day off' }, { start: '2026-12-10', end: '2026-12-11', summary: 'Made-up event', group: 'made-up event' }] } }));
  render({ language: 'en' });
  ({ w, d } = await open());
  const cal = d.querySelector('[data-svc-card="calendar"]');
  ok(!cal.hidden && /2 events/.test(cal.textContent) && cal.querySelector('.svc-status').classList.contains('status-ok') && d.querySelector('[data-svc-add="calendar"]').hidden, 'a feed: its card, its events, not offered again');
  cal.click();
  ok(shown(d) === 'calendar', 'its card opens Settings → Calendar');
  w.close();
  fs.unlinkSync('school-calendar.json');

  // Russian
  const html = render({ language: 'ru' });
  ok(/Canvas — вход через Google/.test(html) && /нужен браузер/.test(html) && /Добавить сервис/.test(html), 'Russian labels render');

  fs.unlinkSync('settings.json');
  if (backup) fs.writeFileSync('last-collection.json', backup);
  console.log(`services: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
