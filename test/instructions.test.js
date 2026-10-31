// Assignment instructions: Classroom's, read by opening each Classwork item
// in place (readInstructionsInPage, here on a made-up copy of Classwork's
// markup in jsdom, shaped like the real one as seen on 2026-10-30); which
// ones get read each pass and what's kept between them (readInstructions);
// and the Instructions drop-down under a card, for Canvas's and Classroom's.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const { JSDOM } = T.jsdom();
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };

const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@b', canvas: '' }, 'last-collection.json': [] });
process.chdir(proj);
const { readInstructions, readInstructionsInPage } = require(path.join(proj, '05-playwright-draft.js'));

// One Classwork item: a header that opens it, and an opened part filled in
// a moment after (the instructions, then widgets: attachments, the View link).
function classwork(items) {
  const dom = new JSDOM('<ol></ol>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const d = dom.window.document;
  for (const it of items) {
    const li = d.createElement('li');
    li.setAttribute('data-stream-item-id', it.id);
    li.innerHTML = `<div jsaction="click:x" jscontroller="c1"><div role="button" tabindex="0" aria-expanded="false"><span>${it.title}</span></div></div>`;
    const header = li.querySelector('[role="button"]');
    header.addEventListener('click', () => {
      const open = header.getAttribute('aria-expanded') === 'true';
      header.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (open) { li.querySelector('[jsname="drawer"]').remove(); return; }
      const drawer = d.createElement('div');
      drawer.setAttribute('jsname', 'drawer');
      drawer.innerHTML = '<div expanded-item-id="x"></div>';
      li.appendChild(drawer);
      setTimeout(() => {
        drawer.firstChild.innerHTML = `<div><div><span>${it.body}</span></div></div>` +
          '<div jscontroller="att"><span>Made-up attachment.pdf</span></div><div jscontroller="v"><a href="https://classroom.example.test/x" aria-label="View"><span>View assignment</span></a></div>';
      }, 50);
    });
    d.querySelector('ol').appendChild(li);
  }
  return dom;
}
// What page.evaluate does, for the reader running "in the page".
const pageOf = dom => ({
  evaluate: (fn, arg) => {
    const w = dom.window;
    return w.eval(`(${fn.toString()})`)(arg);
  },
});

(async () => {
  // ── reading one in the page ──
  const dom = classwork([
    { id: '101', title: 'Worksheet', body: 'Answer questions 1-6.<br>Use the <a href="https://docs.example.test/reading">chapter 3 reading</a>.<ul><li>Show your work</li><li>Turn in a PDF</li></ul>' },
    { id: '102', title: 'No instructions', body: 'Posted Oct 12' },
    { id: '103', title: 'Bare link', body: 'See https://example.test/rubric' },
  ]);
  const page = pageOf(dom);
  const one = await page.evaluate(readInstructionsInPage, '101');
  ok('an item opens in place and its instructions are read, line breaks and lists kept', one.ok && one.text.startsWith('Answer questions 1-6.\nUse the chapter 3 reading') && /- Show your work\n+- Turn in a PDF/.test(one.text), JSON.stringify(one));
  ok('...a link kept as its words and its address', one.text.includes('chapter 3 reading (https://docs.example.test/reading)'));
  ok('...not the attachments or the View link', !/attachment|View assignment/.test(one.text));
  ok('...and it\'s closed again after', dom.window.document.querySelector('li[data-stream-item-id="101"] [role="button"]').getAttribute('aria-expanded') === 'false');
  const none = await page.evaluate(readInstructionsInPage, '102');
  ok('with no instructions, the "Posted" line isn\'t taken for them', none.ok && none.text === null, JSON.stringify(none));
  ok('an item that isn\'t there isn\'t read', (await page.evaluate(readInstructionsInPage, '999')).ok === false);

  // ── which get read, and what's kept ──
  const cls = 'Made-up Biology';
  const item = (id, extra = {}) => ({ class: cls, id, type: 'Assignment', title: 'T' + id, ...extra });
  const now = Date.parse('2026-10-30T12:00:00Z');
  const longAgo = new Date(now - 5 * 86400000).toISOString(), lately = new Date(now - 3600000).toISOString();
  const previous = [
    item('101', { description: 'Old text', descriptionAt: longAgo }),
    item('102', { description: null, descriptionAt: lately }),
    item('103', { type: 'Completed Assignment', description: 'Kept', descriptionAt: longAgo }),
    { ...item('101'), platform: 'Canvas', description: 'not Classroom\'s', descriptionAt: lately },
  ];
  const calls = [];
  const fake = { evaluate: async (fn, id) => { calls.push(id); return { ok: true, text: 'Read now ' + id }; } };
  const got = await readInstructions(fake, [item('101'), item('102'), { ...item('103'), type: 'Completed Assignment' }, item('104')], previous, now);
  const by = id => got.find(x => x.id === id);
  ok('read: the new one and the one gone stale, not one read lately or turned-in work', calls.sort().join() === '101,104', calls.join());
  ok('...those get what was read now', by('101').description === 'Read now 101' && by('104').description === 'Read now 104' && by('104').descriptionAt === new Date(now).toISOString());
  ok('...the rest keep what they had, "none" included', by('102').description === null && by('102').descriptionAt === lately && by('103').description === 'Kept');
  const many = Array.from({ length: 20 }, (_, i) => item('2' + i));
  calls.length = 0;
  await readInstructions(fake, [...many, { ...item('300'), type: 'Completed Assignment' }], [], now);
  ok('at most 12 a class a pass, turned-in work last', calls.length === 12 && !calls.includes('300'));
  calls.length = 0;
  const failing = { evaluate: async (fn, id) => { calls.push(id); return { ok: false }; } };
  const kept = await readInstructions(failing, [item('105')], [], now);
  ok('one that wouldn\'t open is tried again next pass', !kept[0].descriptionAt);

  // ── the drop-down under a card ──
  const soon = new Date(Date.now() + 86400000).toISOString();
  fs.writeFileSync(path.join(proj, 'last-collection.json'), JSON.stringify([
    { platform: 'Canvas', class: 'Made-up History', id: 'canvas-1', type: 'Assignment', title: 'Essay', link: 'https://canvas.example.test/1', due_iso: soon, due: null, description: 'Write 2 pages <b>with sources</b>.\nRubric: https://example.test/rubric' },
    { class: cls, id: '401', type: 'Assignment', title: 'Worksheet', link: 'https://classroom.example.test/1', due: 'Due tomorrow', description: 'Questions 1-6.', descriptionAt: new Date().toISOString() },
    { class: cls, id: '402', type: 'Assignment', title: 'Quiz prep', link: 'https://classroom.example.test/2', due: 'Due tomorrow', description: null, descriptionAt: new Date().toISOString() },
  ]));
  T.redraw(proj);
  const html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
  const main = new JSDOM(html, { url: 'https://app.test/summary.html' }).window.document;
  const block = id => main.querySelector(`.row[data-id="${id}"] .instructions`);
  ok('a card with instructions gets the drop-down, closed, outside the card\'s link', block('canvas-1') && !block('canvas-1').open && !block('canvas-1').closest('a') &&
    block('canvas-1').querySelector('summary').textContent === 'Instructions');
  ok('...its text as text (markup in it isn\'t markup), and a web address in it a link', block('canvas-1').querySelector('.instructions-text').textContent.includes('<b>with sources</b>') &&
    block('canvas-1').querySelector('.instructions-text a').getAttribute('href') === 'https://example.test/rubric' && block('canvas-1').querySelector('.instructions-text a').target === '_blank');
  ok('Classroom\'s get it too', block('401') && block('401').textContent.includes('Questions 1-6.'));
  ok('one without instructions has none', main.querySelector('.row[data-id="402"]') && !block('402'));
})().catch(e => ok('ran without throwing', false, e.stack));
