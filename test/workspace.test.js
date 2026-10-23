// The PDF workspace: adding a PDF, the list, removing one, the actions the
// app calls, the page's list view (talking through the main page), and the
// main page's Workspace panel passing those messages on.
// Drawing and exporting need a real browser engine (PDF.js draws on a
// canvas, which jsdom doesn't have), so those were checked in WebKit and
// Chromium instead. The PDF is made up, made here with pdf-lib.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const { JSDOM, VirtualConsole } = T.jsdom();
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@b', canvas: '' }, 'last-collection.json': [] });
process.chdir(proj);
const W = require(path.join(proj, '46-workspace.js'));
const act = (action, arg = '') => JSON.parse(T.run(proj, '21-notifier-actions.js', [action, arg]).stdout.trim().split('\n').pop());

(async () => {
  const { PDFDocument } = require(path.join(proj, 'pdf-lib.min.js'));
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  const pdfFile = path.join(proj, 'Made-up Worksheet.pdf');
  fs.writeFileSync(pdfFile, await doc.save());
  const notPdf = path.join(proj, 'notes.txt');
  fs.writeFileSync(notPdf, 'just some text');

  // ── adding, listing, removing ──
  const first = act('workspaceImport', encodeURIComponent(pdfFile));
  ok('a PDF is added, with an id and its name as the title', first.ok && W.isId(first.id) && first.title === 'Made-up Worksheet', JSON.stringify(first));
  const dir = path.join(W.DIR, first.id);
  ok('...as an untouched copy, beside what it is', fs.readFileSync(path.join(dir, 'source.pdf')).equals(fs.readFileSync(pdfFile)) &&
    JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).fileName === 'Made-up Worksheet.pdf');
  ok('a file that isn\'t a PDF is refused', act('workspaceImport', encodeURIComponent(notPdf)).why === 'notPdf');
  ok('so is one that isn\'t there', act('workspaceImport', encodeURIComponent(path.join(proj, 'gone.pdf'))).why === 'notFound');

  const second = W.importPdf(pdfFile, new Date(Date.now() - 60000));
  fs.writeFileSync(path.join(dir, 'ink.json'), JSON.stringify({ version: 1, pageCount: 2, pages: { 1: [{ id: 'a', type: 'pen', color: '#000', width: 2, points: [[1, 2], [3, 4]] }] } }));
  let list = act('workspaceList').docs;
  ok('the list: the one last written on first, with its page count', list.length === 2 && list[0].id === first.id && list[0].pageCount === 2 && list[0].editedAt && !list[1].editedAt, JSON.stringify(list));
  fs.mkdirSync(path.join(W.DIR, 'not-an-id'));
  fs.mkdirSync(path.join(W.DIR, '0123456789abcdef'));
  ok('...leaving out folders that aren\'t a PDF of its own', act('workspaceList').docs.length === 2);
  ok('removing one takes its folder away', act('workspaceRemove', second.id).ok && !fs.existsSync(path.join(W.DIR, second.id)));
  ok('...and nothing outside the workspace, whatever it\'s asked', act('workspaceRemove', '../settings').why === 'badId' && fs.existsSync(path.join(proj, 'settings.json')));

  // ── the page ──
  ok('workspacePage writes it', act('workspacePage').ok && fs.existsSync(W.PAGE));
  const html = fs.readFileSync(W.PAGE, 'utf8');
  ok('...in the current language', /<title>Workspace<\/title>/.test(html) && html.includes('Export PDF'));
  ok('...loading its scripts only from the workspace address\'s own paths', html.includes('<script src="pdf-lib.min.js">') && html.includes("import('./pdfjs/pdf.min.mjs')"));

  // The list view, in a stand-in for the main page it's a frame of.
  const posted = [];
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(String(e.message)));
  let closed = false;
  const dom = new JSDOM(html, { url: 'https://app.test/workspace.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      const parent = { postMessage(m) {
        if (m.type === 'close') closed = true;
        if (m.type !== 'action') return;
        posted.push(m.action);
        const result = m.action === 'workspaceList' ? act('workspaceList') : { ok: true };
        setTimeout(() => {
          const e = new w.Event('message');
          Object.assign(e, { data: { cd: 'ws', type: 'result', id: m.id, result } });
          Object.defineProperty(e, 'source', { value: parent });
          w.dispatchEvent(e);
        }, 0);
      } };
      Object.defineProperty(w, 'parent', { value: parent });
    } });
  await sleep(500);
  const d = dom.window.document;
  const rows = [...d.querySelectorAll('.doc-row')];
  ok('the list view asks for the list', posted[0] === 'workspaceList');
  ok('...and shows each PDF with what it is', rows.length === 1 && rows[0].querySelector('b').textContent === 'Made-up Worksheet' && /2 pages · edited /.test(rows[0].textContent), rows.map(r => r.textContent).join('|'));
  const remove = rows[0].querySelector('.remove');
  remove.click();
  ok('Remove asks first', remove.textContent === 'Sure? Remove' && !posted.includes('workspaceRemove'));
  d.getElementById('home-close').click();
  ok('Close asks the main page to close the panel', closed);
  ok('the page script runs clean', errors.length === 0, errors.join('\n'));
  dom.window.close();

  // ── the main page's panel ──
  T.redraw(proj);
  const mainHtml = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
  for (const bridge of [false, true]) {
    const sent = [];
    const main = new JSDOM(mainHtml, { url: 'https://app.test/summary.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
      beforeParse(w) {
        w.Element.prototype.scrollIntoView = function () {};
        if (bridge) w.webkit = { messageHandlers: { classdash: { postMessage(b) { sent.push(b); } } } };
      } });
    await sleep(200);
    const mw = main.window, md = mw.document;
    const button = md.getElementById('workspace-button');
    if (!bridge) ok('no Workspace button in a plain browser', button && button.style.display === 'none');
    else {
      button.click();
      const panel = md.getElementById('workspace-panel'), frame = md.getElementById('workspace-frame');
      ok('in the app it shows, and opens the panel, writing the page first', button.style.display === '' && !panel.hidden && sent.map(b => b.action).join() === 'workspacePage', JSON.stringify(sent.map(b => b.action)));
      mw.classdashBridgeResult(sent[0].id, { ok: true });
      ok('...then loads the workspace from its own address', frame.getAttribute('src') === 'classdash-ws://app/workspace.html');
      // Messages as the frame would send them: only its, and only these actions.
      const fake = (data, origin = 'classdash-ws://app', source = frame.contentWindow) => {
        const e = new mw.Event('message');
        Object.assign(e, { data: Object.assign({ cd: 'ws' }, data) });
        Object.defineProperty(e, 'origin', { value: origin });
        Object.defineProperty(e, 'source', { value: source });
        mw.dispatchEvent(e);
      };
      fake({ type: 'action', id: 'a1', action: 'wsSave', arg: '{"doc":"x"}' });
      fake({ type: 'action', id: 'a2', action: 'config', arg: '{}' });
      fake({ type: 'action', id: 'a3', action: 'wsSave', arg: '{}' }, 'https://elsewhere.test');
      fake({ type: 'action', id: 'a4', action: 'wsSave', arg: '{}' }, 'classdash-ws://app', mw);
      ok('the frame\'s workspace actions go on to the app, nothing else and from nowhere else', sent.slice(1).map(b => b.action).join() === 'wsSave' && sent[1].arg === '{"doc":"x"}', JSON.stringify(sent.slice(1)));
      fake({ type: 'doc', doc: '0123456789abcdef' });
      ok('it remembers the PDF that was open', mw.eval('workspaceDoc') === '0123456789abcdef');
      fake({ type: 'close' });
      ok('Close waits for the last save...', !panel.hidden);
      fake({ type: 'flushed' });
      ok('...then hides the panel', panel.hidden);
    }
    main.window.close();
  }
})();
