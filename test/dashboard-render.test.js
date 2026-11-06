// The cards the page draws from /api/dashboard's data are the cards on disk: one
// renderer, and it has to work with nothing but what the page gives it.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), vm = require('vm');
const day = 86400000;
const item = (id, title, days, extra = {}) => ({ platform: 'Canvas', class: 'Made-up Biology', id, type: 'Assignment', title, link: `https://canvas.demo.test/${id}`, due_iso: new Date(Date.now() + days * day).toISOString(), due: null, posted: new Date().toISOString(), ...extra });
for (const language of ['en', 'ru']) {
  const proj = T.makeProject({
    'settings.json': { language, classroomEnabled: true },
    'last-collection.json': [
      item('a1', 'Worksheet <b>about</b> cells', 1, { description: 'See https://demo.test/x' }),
      item('a2', 'Sneaky <!--/dash--> title', 20),
      item('o1', 'Late lab report', -3),
    ],
    'messages.json': [{ id: 'p1', class: 'Made-up Biology', author: 'Made-up Teacher', date: 'Nov 1', text: 'Bring a notebook <!--/dash-->', link: 'https://classroom.demo.test/p1', attachments: [{ title: 'Sheet', link: 'https://demo.test/sheet', kind: 'pdf' }] }],
  });
  process.chdir(proj);
  T.redraw(proj);
  const whole = fs.readFileSync('summary.html', 'utf8');
  const shell = fs.readFileSync('page-shell.html', 'utf8');
  T.ok(`${language}: what looks like the end of a data block can't cut the page short`, !shell.includes('Sneaky') && !shell.includes('Bring a notebook'));

  // The done and hidden reminder groups are .dash-rows, folded away with [hidden]: a display on that class alone would beat it.
  T.ok(`${language}: a folded group of cards stays folded`, /\.dash-rows:not\(\[hidden\]\) \{ display: contents/.test(whole) && /\.dash-rows\[hidden\] \{ display: none/.test(whole));

  // display: contents would take away the announcements' own scroll area.
  T.ok(`${language}: announcements keep their scroll area`, /<div class="feed" data-rows="announcements">/.test(whole));

  const { JSDOM } = T.jsdom();
  const page = new JSDOM(whole, { runScripts: 'dangerously', pretendToBeVisual: true });
  const doc = page.window.document;
  const errors = doc.getElementById('script-error');
  T.ok(`${language}: the page's script runs`, !errors, errors && errors.textContent);

  // The words: the renderer gets them from the page, functions and all.
  const render = page.window.Dash || vm.runInContext('Dash', page.getInternalVMContext());
  const now = new Date();
  const line = render.row('dueSoon', { id: 'x', title: 'T', class: 'C', dueAt: new Date(now.getTime() + 3 * day).toISOString(), partsDone: 1, partsTotal: 2, parts: [], locked: { why: 'module', module: 'M' } }, now, {});
  T.ok(`${language}: words with numbers in them work on the page`, !/inDays|partsDone|lockedModule|undefined/.test(line), line);
  const overdue = render.row('overdue', { id: 'y', title: 'T', class: 'C', dueAt: new Date(now.getTime() - 3 * day).toISOString() }, now, {});
  T.ok(`${language}: ...and late ones`, !/lateByDays|undefined/.test(overdue), overdue);

  // Every row on the disk copy is what the page draws from the same data.
  process.env.CLASSDASH_TEST = '1';
  const { dashboardView, gradeHistoryChart } = require(path.join(proj, '08-page.js'));
  const points = [{ at: '2026-03-01T12:00:00Z', percent: 80 }, { at: '2026-03-08T12:00:00Z', percent: 85 }];
  T.ok(`${language}: a grade chart doesn't move during the day`, gradeHistoryChart(points, new Date(2026, 2, 10, 8, 0)) === gradeHistoryChart(points, new Date(2026, 2, 10, 21, 0)));
  T.ok(`${language}: ...but does the next day`, gradeHistoryChart(points, new Date(2026, 2, 10, 8, 0)) !== gradeHistoryChart(points, new Date(2026, 2, 11, 8, 0)));
  const api = require(path.join(proj, '05-playwright-draft.js'));
  const items = JSON.parse(fs.readFileSync('last-collection.json', 'utf8'));
  const buckets = api.sortIntoBuckets(items, now, api.readMutedIds(), api.readHiddenIds());
  const view = JSON.parse(JSON.stringify(dashboardView({ ...buckets, items, announcements: JSON.parse(fs.readFileSync('messages.json', 'utf8')), freshIds: new Set(), now })));
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const clean = text => { const box = doc.createElement('div'); box.innerHTML = text; return norm(box.innerHTML); };
  for (const list of ['dueSoon', 'ahead', 'overdue']) {
    const rows = doc.querySelectorAll(`[data-rows="${list}"] > .row`);
    T.ok(`${language}: ${list} has its rows on disk`, rows.length === view.lists[list].length && rows.length > 0, `${rows.length}`);
    view.lists[list].forEach((x, i) => {
      if (!rows[i]) return;
      const wanted = clean(render.row(list, x, now, view));
      const on = rows[i].cloneNode(true);
      on.classList.remove('filtered-out', 'shown');
      if (!on.getAttribute('class')) on.removeAttribute('class');
      T.ok(`${language}: ${list} row ${x.id} comes out the same both ways`, norm(on.outerHTML) === wanted, `${norm(on.outerHTML).slice(0, 400)}\n${wanted.slice(0, 400)}`);
    });
  }
  page.window.close();
  // Back out of this project for the next language's.
  for (const key of Object.keys(require.cache)) if (key.startsWith(proj)) delete require.cache[key];
}
T.done();
