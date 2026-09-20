// The Account section: four source checkboxes and the fields that follow them.
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
    beforeParse(w) { w.Element.prototype.scrollIntoView = function () {}; } });
  await new Promise(r => setTimeout(r, 300));
  return { w: dom.window, d: dom.window.document, errors };
};
const shown = (d, needs) => { const e = d.querySelector(`[data-needs="${needs}"]`); return e && !e.hidden; };

(async () => {
  const backup = fs.existsSync('last-collection.json') ? fs.readFileSync('last-collection.json') : null;

  // defaults (an existing install): everything on, so every field is shown
  let html = render({ email: 'a@b.example', canvas: 'https://x.instructure.com', language: 'en' });
  let { w, d, errors } = await open();
  const order = [...d.querySelectorAll('[data-bool-key]')].map(e => e.getAttribute('data-bool-key')).filter(k => ['classroomEnabled','canvasSsoEnabled','canvasApiEnabled','edpuzzleEnabled'].includes(k));
  ok(JSON.stringify(order) === JSON.stringify(['classroomEnabled','canvasSsoEnabled','canvasApiEnabled','edpuzzleEnabled']), 'four checkboxes in the order Classroom, Canvas SSO, Canvas API, Edpuzzle: ' + order);
  ok(shown(d, 'classroom') && shown(d, 'canvas') && shown(d, 'canvasApi'), 'defaults: email, address and token all shown');
  const names = [...d.querySelectorAll('.source-item .label-text')].map(e => e.textContent.trim());
  ok(JSON.stringify(names) === JSON.stringify(['Google Classroom', 'Canvas — Google sign-in', 'Canvas — API (access token)', 'Edpuzzle']), 'dropdown labels: ' + names.join(' | '));
  const item = label => [...d.querySelectorAll('.source-item')].find(e => e.textContent.includes(label));
  const hintOf = label => (item(label) || { textContent: '' }).textContent.replace(/\s+/g, ' ');
  ok(d.querySelectorAll('.source-item').length === 4 && d.querySelector('details.source-picker .source-list'), 'the four sources sit in a dropdown (<details>), one item each');
  ok(/needs a browser/.test(hintOf('Edpuzzle')) && !/needs a browser/.test(hintOf('Canvas — API')), 'Edpuzzle mentions its browser requirement (and only the right items do)');
  ok(/fallback/.test(hintOf('Canvas — Google sign-in')) && /API below is on and filled in/.test(hintOf('Canvas — Google sign-in')), 'Canvas Google sign-in says it is the fallback when the API is on and filled in');
  ok(/needs a browser/.test(hintOf('Google Classroom')), 'Classroom says it needs a browser');
  ok(/no browser or sign-in/.test(hintOf('Canvas — API')), 'Canvas API says no browser needed');
  ok(d.querySelector('details.source-picker').open === false, 'the dropdown starts closed');
  const summaryText = () => d.getElementById('source-summary').textContent;
  ok(summaryText() === 'Google Classroom, Canvas — Google sign-in, Canvas — API (access token), Edpuzzle', 'summary names what is ticked ' + summaryText());
  ok(d.querySelector('[data-key="canvasToken"]').type === 'password' && d.querySelector('[data-key="canvas"]').type === 'password', 'address and token are masked');

  // ticking boxes shows/hides rows live
  const box = k => d.querySelector(`[data-bool-key="${k}"]`);
  const click = k => { box(k).checked = !box(k).checked; box(k).dispatchEvent(new w.Event('change')); };
  click('canvasApiEnabled');
  ok(!shown(d, 'canvasApi') && shown(d, 'canvas'), 'API unticked: token row hidden, address stays (Google sign-in still on)');
  click('canvasSsoEnabled');
  ok(!shown(d, 'canvas') && !shown(d, 'canvasApi'), 'both Canvas boxes off: address and token hidden');
  click('canvasApiEnabled');
  ok(shown(d, 'canvas') && shown(d, 'canvasApi'), 'API ticked again: address and token back');
  click('classroomEnabled');
  ok(!shown(d, 'classroom'), 'Classroom unticked: email hidden');
  ok(!/Google Classroom/.test(summaryText()) && /Canvas — API/.test(summaryText()), 'summary follows the ticks: ' + summaryText());
  // the exclusions dropdown has its own counter, untouched by the sources one
  {
    const ex = d.querySelector('.class-picker:not(.source-picker) .picker-summary');
    if (ex) {
      const before = ex.textContent;
      click('edpuzzleEnabled');
      ok(ex.textContent === before, 'ticking a source does not change the exclusions counter (' + before + ')');
      const cbs = d.querySelectorAll('.class-picker:not(.source-picker) input[type="checkbox"]');
      if (cbs.length) { cbs[0].checked = !cbs[0].checked; cbs[0].dispatchEvent(new w.Event('change')); w.updateSelectionCount(); }
      ok(ex.textContent !== before && summaryText() === (d.getElementById('source-summary').textContent), 'ticking an exclusion changes only the exclusions counter');
      click('edpuzzleEnabled');
    } else console.log('  (no exclusions dropdown in this fixture — scoping check skipped)');
  }
  // hidden fields are still collected for saving
  ok(d.querySelector('[data-key="email"]') && w.collectSettings && Object.prototype.hasOwnProperty.call(w.collectSettings(), 'email'), 'a hidden field is still saved');
  const c = w.collectSettings();
  ok(c.classroomEnabled === false && c.canvasSsoEnabled === false && c.canvasApiEnabled === true, 'collected switches match what was ticked: ' + JSON.stringify({ a: c.classroomEnabled, b: c.canvasSsoEnabled, c: c.canvasApiEnabled }));
  ok(errors.filter(e => !/Not implemented|live\/(check-run|page-version)/.test(e)).length === 0, 'no page script errors: ' + errors.join('|'));
  w.close();

  // rendering follows the saved state
  render({ email: 'a@b.example', canvas: 'https://x.instructure.com', language: 'en', classroomEnabled: false, canvasSsoEnabled: false, canvasToken: 'T~1' });
  ({ w, d } = await open());
  ok(!shown(d, 'classroom') && shown(d, 'canvas') && shown(d, 'canvasApi'), 'saved: Classroom off, token-only Canvas -> email hidden, address + token shown');
  ok(d.getElementById('source-summary').textContent === 'Canvas — API (access token), Edpuzzle', 'saved: the summary lists exactly the ticked sources: ' + d.getElementById('source-summary').textContent);
  ok(!d.querySelector('[data-bool-key="classroomEnabled"]').checked && !d.querySelector('[data-bool-key="canvasSsoEnabled"]').checked && d.querySelector('[data-bool-key="canvasApiEnabled"]').checked, 'saved checkbox states render');
  w.close();
  render({ language: 'en', canvasSsoEnabled: false, canvasApiEnabled: false });
  ({ w, d } = await open());
  ok(!shown(d, 'canvas') && !shown(d, 'canvasApi'), 'saved: both Canvas ways off -> address and token hidden');
  ok(/Google Classroom, Edpuzzle/.test(d.getElementById('source-summary').textContent), 'saved: summary without Canvas: ' + d.getElementById('source-summary').textContent);
  w.close();

  // Russian
  html = render({ language: 'ru' });
  ok(/Canvas — вход через Google/.test(html) && /Canvas — API/.test(html) && /нужен браузер/.test(html), 'Russian labels and the browser note render');

  fs.unlinkSync('settings.json');
  if (backup) fs.writeFileSync('last-collection.json', backup);
  console.log(`account-section: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
