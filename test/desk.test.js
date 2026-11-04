// The workspace's desk (50-desk.js): what may be saved as its layout, the
// actions that keep it, and the page: panes split, closed and changed, at
// most five and one AI; a PDF pane's messages passed on and answered; the
// last saves on close; web panes laid out for the app to draw (with their
// bookmarks and the app's news coming back); and the main
// page putting the desk's boxes where they are in the window. jsdom has no
// layout, so the desk's size and its web boxes are made up here.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const { JSDOM, VirtualConsole } = T.jsdom();
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proj = T.makeProject({ 'settings.json': { language: 'en', email: 'a@b', canvas: '' }, 'last-collection.json': [] });
process.chdir(proj);
const D = require(path.join(proj, '50-desk.js'));
const act = (action, arg = '') => JSON.parse(T.run(proj, '21-notifier-actions.js', [action, arg]).stdout.trim().split('\n').pop());
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const panesOf = (n, out = []) => { if (n.pane) out.push(n); else n.kids.forEach(k => panesOf(k, out)); return out; };

(async () => {
  // ── what may be saved ──
  const first = act('workspaceDesk').desk;
  ok('at first: a PDF pane with the AI beside it, and the starting bookmarks', first.layout.split === 'row' && panesOf(first.layout).map(p => p.kind).join() === 'pdf,ai' &&
    first.bookmarks.some(b => /docs\.google\.com/.test(b.url)) && first.bookmarks.some(b => /desmos/.test(b.url)), JSON.stringify(first));
  const messy = {
    layout: { split: 'col', sizes: [3, 1], kids: [
      { split: 'row', sizes: [1, 1, 1], kids: [{ pane: 'a', kind: 'pdf', doc: '0123456789abcdef' }, { pane: 'b', kind: 'ai' }, { pane: 'c', kind: 'ai' }] },
      { split: 'row', kids: [{ pane: 'd', kind: 'web', url: 'javascript:alert(1)' }, { pane: 'e', kind: 'web', url: 'https://www.desmos.com/calculator' }, { pane: 'f', kind: 'pdf' }, { pane: 'a', kind: 'pdf' }, { pane: 'BAD!', kind: 'pdf' }, { pane: 'g', kind: 'shell' }] },
    ] },
    focus: 'nope',
    bookmarks: [{ title: '', url: 'https://example.test/x' }, { title: 'Evil', url: 'file:///etc/passwd' }],
  };
  ok('saving cleans it first', act('workspaceDeskSave', b64(messy)).ok);
  const saved = act('workspaceDesk').desk;
  const kinds = panesOf(saved.layout);
  ok('...at most five panes, one AI, known kinds and ids, each pane once', kinds.length === 5 && kinds.map(p => p.pane).join() === 'a,b,d,e,f' && kinds.filter(p => p.kind === 'ai').length === 1, JSON.stringify(kinds));
  ok('...only web addresses for web panes, real ids for PDF panes', !('url' in kinds[2]) && kinds[3].url === 'https://www.desmos.com/calculator' && kinds[0].doc === '0123456789abcdef');
  ok('...sizes that add up, a focus that exists', saved.layout.sizes.join() === '0.75,0.25' && saved.focus === 'a');
  ok('...and bookmarks that are web addresses, named after their site if they had no name', saved.bookmarks.length === 1 && saved.bookmarks[0].title === 'example.test', JSON.stringify(saved.bookmarks));
  ok('nothing that isn\'t JSON gets saved', act('workspaceDeskSave', 'not json!!').ok === false && act('workspaceDesk').desk.focus === 'a');
  ok('webCaps: only the Mac app draws web panes, and answers that itself', act('webCaps').web === false);
  fs.rmSync(path.join(proj, 'workspace', 'desk.json'));

  // ── the page ──
  ok('workspacePage writes the desk too', act('workspacePage').ok && fs.existsSync(D.PAGE));
  const html = fs.readFileSync(D.PAGE, 'utf8');

  async function openDesk({ web = false } = {}) {
    const posted = [];
    const errors = [];
    const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(String(e.message)));
    const dom = new JSDOM(html, { url: 'https://app.test/workspace.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(w) {
        Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { get() { return this.id === 'panes' ? 1200 : 0; } });
        Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { get() { return this.id === 'panes' ? 800 : 0; } });
        const real = w.HTMLElement.prototype.getBoundingClientRect;
        w.HTMLElement.prototype.getBoundingClientRect = function () {
          const pane = this.closest('.pane');
          if (this.classList.contains('web-box') && pane) { const x = parseFloat(pane.style.left) || 0, y = parseFloat(pane.style.top) || 0; return { left: x + 2, top: y + 70, width: 300, height: 200, right: x + 302, bottom: y + 270 }; }
          if (this.classList.contains('menu') && pane) { const x = parseFloat(pane.style.left) || 0, y = parseFloat(pane.style.top) || 0; return { left: x + 6, top: y + 30, width: 150, height: 90, right: x + 156, bottom: y + 120 }; }
          return real.call(this);
        };
        const parent = { postMessage(m) {
          posted.push(m);
          if (m.type !== 'action' || m.id === 'flush') return;
          const reply = result => { const e = new w.Event('message'); Object.assign(e, { data: { cd: 'ws', type: 'result', id: m.id, result } }); Object.defineProperty(e, 'source', { value: parent }); w.dispatchEvent(e); };
          if (m.action === 'workspaceDesk' || m.action === 'workspaceDeskSave') setTimeout(() => reply(act(m.action, m.arg)), 0);
          else if (m.action === 'webCaps') setTimeout(() => reply({ ok: true, web }), 0);
          else if (/\|/.test(m.id)) parent.pending = { m, reply };
          else setTimeout(() => reply({ ok: true }), 0);
        } };
        Object.defineProperty(w, 'parent', { value: parent });
      } });
    await sleep(500);
    const w = dom.window;
    const fromMain = data => { const e = new w.Event('message'); Object.assign(e, { data: Object.assign({ cd: 'ws' }, data) }); Object.defineProperty(e, 'source', { value: w.parent }); w.dispatchEvent(e); };
    return { dom, w, d: w.document, posted, errors, fromMain };
  }

  {
    const { dom, w, d, posted, errors, fromMain } = await openDesk();
    const panes = () => [...d.querySelectorAll('.pane')].map(p => p.dataset.id + ':' + p.querySelector('.kind').textContent.replace(' ▾', ''));
    ok('the desk opens with its saved layout', panes().join() === 'p1:PDF,p2:AI', panes().join());
    ok('...side by side, the panes and the divider filling it', d.querySelector('.pane[data-id="p1"]').style.width && d.querySelectorAll('.divider').length === 1 &&
      Math.round(parseFloat(d.querySelector('.pane[data-id="p1"]').style.width) + parseFloat(d.querySelector('.pane[data-id="p2"]').style.width) + 6) === 1200);
    const gate = d.querySelector('.pane[data-id="p2"] .ai-gate');
    ok('the AI pane starts with the warning: the sign, what it\'s for, what it won\'t do, the guide', gate && /^data:image\/png;base64,iVBOR/.test(gate.querySelector('img').src) &&
      gate.querySelectorAll('li').length === 4 && /never writes in work you turn in/.test(gate.textContent) && /docs\/ai-use\.md$/.test(gate.querySelector('a').href) && gate.querySelector('a').target === '_blank');
    gate.querySelector('.ok').click();
    ok('...gone after "I understand"', !d.querySelector('.ai-gate'));
    d.querySelector('.pane[data-id="p1"] .split-d').click();
    ok('splitting a PDF pane down adds a pane under it (a web pane can\'t be had here, so a PDF)', panes().join() === 'p1:PDF,p2:AI,p3:PDF', panes().join());
    const p1 = d.querySelector('.pane[data-id="p1"]'), p3 = d.querySelector('.pane[data-id="p3"]');
    ok('...half each, one above the other', p1.style.left === p3.style.left && parseFloat(p3.style.top) > parseFloat(p1.style.top) && p1.style.height === p3.style.height, [p1.style.cssText, p3.style.cssText].join(' / '));
    const frame1 = d.querySelector('.pane[data-id="p1"] iframe');
    const top = id => parseFloat(d.querySelector(`.pane[data-id="${id}"]`).style.top);
    const ways = id => [...d.querySelectorAll(`.pane[data-id="${id}"] .move.can`)].map(b => b.dataset.way).join();
    ok('arrows only the ways there\'s a pane to go: p1 (top left) right and down, p3 (bottom left) right and up, the AI left', ways('p1') === 'right,down' && ways('p3') === 'right,up' && ways('p2') === 'left', [ways('p1'), ways('p3'), ways('p2')].join(' | '));
    ok("each arrow is the user's arrow icon, with its name as the tooltip, no text", [...d.querySelectorAll('.pane[data-id="p1"] .move')].every(b => b.querySelector('i') && !b.textContent.trim() && b.title) &&
      d.documentElement.outerHTML.includes('.move[data-way="left"] i { transform: rotate(270deg); }'));
    d.querySelector('.pane[data-id="p3"] .move[data-way="up"]').click();
    ok('...↑ puts the lower pane on top, without reloading either', top('p3') < top('p1') && d.querySelector('.pane[data-id="p1"] iframe') === frame1);
    await sleep(500);
    ok('...and it\'s kept', JSON.stringify(act('workspaceDesk').desk.layout).indexOf('"p3"') < JSON.stringify(act('workspaceDesk').desk.layout).indexOf('"p1"'));
    d.querySelector('.pane[data-id="p2"] .move[data-way="left"]').click();
    ok('...← with two stacked on the left: trades places with one of them, taking its spot and size', parseFloat(d.querySelector('.pane[data-id="p2"]').style.left) === 0 && top('p2') === 0 &&
      parseFloat(d.querySelector('.pane[data-id="p3"]').style.left) > 0 && d.querySelector('.pane[data-id="p1"] iframe') === frame1, d.querySelector('.pane[data-id="p2"]').style.cssText);
    d.querySelector('.pane[data-id="p2"] .move[data-way="right"]').click();
    d.querySelector('.pane[data-id="p3"] .move[data-way="down"]').click();
    d.querySelector('.pane[data-id="p2"] .split-r').click();
    d.querySelector('.pane[data-id="p2"] .split-r').click();
    ok('five panes at most: then splitting is off', panes().length === 5 && d.querySelector('.pane[data-id="p1"] .split-r').disabled, panes().join());
    ok('...and a PDF pane next to all that was never reloaded', d.querySelector('.pane[data-id="p1"] iframe') === frame1);
    // The kind menu: the AI is taken, web panes are the Mac app's.
    d.querySelector('.pane[data-id="p3"] .kind').click();
    const menu = d.querySelector('.menu');
    const items = menu ? [...menu.querySelectorAll('button')] : [];
    ok('the pane menu: PDF, AI (taken), Web (not here)', items.map(b => b.textContent + (b.disabled ? '-' : '+')).join() === 'PDF+,AI-,Web-' && /Mac app/.test(menu.textContent), items.map(b => b.textContent + b.disabled).join());
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok('Escape shuts the menu first, not the workspace', !d.querySelector('.menu') && !posted.some(m => m.type === 'close'));
    d.querySelector('.pane[data-id="p4"] .shut').click();
    d.querySelector('.pane[data-id="p5"] .shut').click();
    ok('closing panes gives their room back', panes().join() === 'p1:PDF,p2:AI,p3:PDF' && !d.querySelector('.pane[data-id="p1"] .split-r').disabled, panes().join());

    // A PDF pane's frame: its actions go on with the pane's id, answers come back to it.
    const fw = frame1.contentWindow;
    const got = [];
    fw.postMessage = m => got.push(m);
    const fromFrame = data => { const e = new w.Event('message'); Object.assign(e, { data: Object.assign({ cd: 'ws' }, data) }); Object.defineProperty(e, 'source', { value: fw }); w.dispatchEvent(e); };
    fromFrame({ type: 'action', id: 'w1', action: 'workspaceList', arg: '' });
    const pending = w.parent.pending;
    ok('a PDF pane\'s action goes on to the main page, its pane in front of its id', pending && pending.m.id === 'p1|w1' && pending.m.action === 'workspaceList');
    pending.reply({ ok: true, docs: [] });
    ok('...and the answer goes back to that frame with its own id', got.length === 1 && got[0].type === 'result' && got[0].id === 'w1' && got[0].result.ok);
    fromFrame({ type: 'pdf', doc: '0123456789abcdef', title: 'Made-up Reading', page: 3 });
    ok('the pane shows the PDF\'s name', d.querySelector('.pane[data-id="p1"] .pane-title').textContent === 'Made-up Reading');
    fromFrame({ type: 'close' });
    ok('Escape in a PDF closes the workspace, as before', posted.some(m => m.type === 'close'));
    // Closing: every PDF frame saves, then the desk, then the main page hears.
    got.length = 0;
    fromMain({ type: 'flush' });
    ok('closing asks every PDF pane for its last save', got.some(m => m.type === 'flush'));
    ok('...and waits for them', !posted.some(m => m.type === 'flushed'));
    fromFrame({ type: 'flushed' });
    const fw3 = d.querySelector('.pane[data-id="p3"] iframe').contentWindow;
    const e3 = new w.Event('message'); Object.assign(e3, { data: { cd: 'ws', type: 'flushed' } }); Object.defineProperty(e3, 'source', { value: fw3 }); w.dispatchEvent(e3);
    await sleep(100);
    ok('...then saves the desk and says it\'s done', posted.some(m => m.type === 'flushed'));
    const kept = act('workspaceDesk').desk;
    ok('the layout is kept, with the PDF each pane had open', panesOf(kept.layout).map(p => p.pane + ':' + p.kind + (p.doc ? ':' + p.doc : '')).join() === 'p1:pdf:0123456789abcdef,p3:pdf,p2:ai', JSON.stringify(kept.layout));
    ok('..."I understand" is kept, so the warning shows once', !isNaN(Date.parse(kept.aiOk)));
    ok('...and the AI pane got back the room the panes split from it had', kept.layout.sizes.join() === '0.68,0.32', JSON.stringify(kept.layout.sizes));
    ok('the page script runs clean', errors.length === 0, errors.join('\n'));
    dom.window.close();
  }

  // ── web panes, where the app draws them ──
  {
    const { dom, w, d, posted, errors, fromMain } = await openDesk({ web: true });
    const webOps = () => posted.filter(m => m.action === 'webPane').map(m => JSON.parse(m.arg));
    d.querySelector('.pane[data-id="p3"] .kind').click();
    [...d.querySelectorAll('.menu button')].find(b => b.textContent === 'Web').click();
    await sleep(50);
    const pane = d.querySelector('.pane[data-id="p3"]');
    const marks = [...pane.querySelectorAll('.mark > button:first-child')];
    ok('a new web pane shows the bookmarks', marks.length >= 7 && /Google Docs/.test(marks[0].textContent));
    let last = webOps().filter(o => o.op === 'layout').pop();
    ok('...with nothing for the app to draw yet', last && last.panes.length === 1 && last.panes[0].id === 'p3' && last.panes[0].show === false, JSON.stringify(last));
    marks.find(b => /Desmos/.test(b.textContent)).click();
    await sleep(20);
    const load = webOps().filter(o => o.op === 'load').pop();
    last = webOps().filter(o => o.op === 'layout').pop();
    ok('picking one has the app load it...', load && load.id === 'p3' && load.url === 'https://www.desmos.com/calculator');
    ok('...and draw it over the pane\'s box', last.panes[0].show === true && last.panes[0].w === 300 && last.panes[0].h === 200 && last.panes[0].start === load.url, JSON.stringify(last));
    // Something drawn over a web pane would end up under the app's view.
    d.querySelector('.pane[data-id="p3"] .kind').click();
    last = webOps().filter(o => o.op === 'layout').pop();
    ok('a menu over a web pane hides its page while it\'s open', last.panes[0].show === false);
    d.body.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
    last = webOps().filter(o => o.op === 'layout').pop();
    ok('...and shows it again after', last.panes[0].show === true);
    pane.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
    ok('the web pane in front: the AI pane says it can\'t see web pages', d.getElementById('ai-web-note') && !d.getElementById('ai-web-note').hidden && /can't see this web page/.test(d.getElementById('ai-web-note').textContent));
    d.querySelector('.pane[data-id="p1"]').dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
    ok('...and not once a PDF pane is', d.getElementById('ai-web-note').hidden);

    // What the AI may see of it: Off until set, three levels, each explained.
    const see = pane.querySelector('.see-btn');
    ok('a web page\'s AI button starts Off', see && see.textContent === 'AI: Off ▾');
    see.click();
    const seeMenu = pane.querySelector('.see-menu');
    ok('...its menu: Off, Text, Image, each with what it means', seeMenu && [...seeMenu.querySelectorAll('button')].map(b => b.textContent).join() === 'Off,Text,Image' &&
      seeMenu.querySelectorAll('.note').length === 3 && /can't see this page/.test(seeMenu.querySelectorAll('.note')[0].textContent) && /Works with every AI/.test(seeMenu.querySelectorAll('.note')[1].textContent) &&
      /picture of what's showing/.test(seeMenu.querySelectorAll('.note')[2].textContent));
    ok('...Image greyed out while the AI picked can\'t see images, saying why', [...seeMenu.querySelectorAll('button')][2].disabled && !([...seeMenu.querySelectorAll('button')][1].disabled) &&
      /can't see images: pick one that can/.test(seeMenu.querySelectorAll('.note')[2].textContent));
    ok('...and the page is hidden while the menu\'s over it', webOps().filter(o => o.op === 'layout').pop().panes[0].show === false);
    [...seeMenu.querySelectorAll('button')].find(b => b.textContent === 'Text').click();
    ok('Text: the button says so', see.textContent === 'AI: Text ▾');
    await sleep(500);
    ok('...and it\'s kept with the pane', JSON.stringify(act('workspaceDesk').desk.layout).includes('"ai":"text"'));
    pane.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
    ok('the AI pane\'s note now says it can look at this page', /can look at this web page/.test(d.getElementById('ai-web-note').textContent));
    posted.length = 0;
    d.getElementById('ai-q').value = 'Is this graph right?';
    d.getElementById('ai-ask').click();
    await sleep(50);
    const capture = posted.find(m => m.action === 'webCapture');
    const asking = posted.find(m => m.action === 'workspaceAsk');
    ok('asking: the app saves that page first, text only, then the question says which pane', capture && JSON.stringify(JSON.parse(capture.arg)) === '{"panes":[{"id":"p3","image":false}]}' &&
      asking && JSON.stringify(JSON.parse(Buffer.from(asking.arg, 'base64url').toString('utf8')).web) === '[{"pane":"p3","image":false}]' && posted.indexOf(capture) < posted.indexOf(asking), JSON.stringify(posted.map(m => m.action)));
    fromMain({ type: 'web', web: { id: 'p3', url: 'https://www.desmos.com/calculator/abc123', title: 'Made-up graph', loading: false, back: true, forward: false } });
    ok('the app\'s news shows in the pane: the title, back', pane.querySelector('.pane-title').textContent === 'Made-up graph' && !pane.querySelector('.back').disabled && pane.querySelector('.fwd').disabled);
    ok('...and there\'s no address bar: the bookmarks are the way in', !pane.querySelector('.web-bar input'));
    pane.querySelector('.back').click();
    ok('Back asks the app to go back', webOps().pop().op === 'nav' && webOps().pop().cmd === 'back');
    pane.querySelector('.marks-btn').click();
    const add = pane.querySelector('.web-home .add');
    ok('the bookmarks again hide the page, and offer to keep this one', webOps().filter(o => o.op === 'layout').pop().panes[0].show === false && add);
    add.click();
    ok('...which joins them', [...pane.querySelectorAll('.mark > button:first-child')].some(b => /Made-up graph/.test(b.textContent)));
    // The one place an address is typed: a new bookmark.
    const form = pane.querySelector('.new-mark');
    const loads = webOps().filter(o => o.op === 'load').length;
    form.querySelector('.mark-url').value = 'cell organelles';
    form.dispatchEvent(new w.Event('submit', { cancelable: true }));
    ok('a new bookmark needs a web address, not words', /doesn't look like a web address/.test(form.querySelector('.why').textContent) && !act('workspaceDesk').desk.bookmarks.some(b => /organelles/.test(b.url)));
    form.querySelector('.mark-name').value = 'Flashcards';
    form.querySelector('.mark-url').value = 'quizlet.com';
    fromMain({ type: 'web', web: { id: 'p3', title: 'Made-up graph again', loading: true } });
    ok('...what\'s being typed survives the page\'s news coming in', form.querySelector('.mark-url').value === 'quizlet.com' && pane.querySelector('.new-mark') === form);
    form.dispatchEvent(new w.Event('submit', { cancelable: true }));
    const quiz = [...pane.querySelectorAll('.mark > button:first-child')].find(b => /Flashcards/.test(b.textContent));
    ok('...an address gets https:// put in front, and it joins them without opening anything', quiz && quiz.title === 'https://quizlet.com/' && !form.querySelector('.why').textContent &&
      webOps().filter(o => o.op === 'load').length === loads && form.querySelector('.mark-url').value === '');
    quiz.click();
    ok('...then picking it opens it', webOps().filter(o => o.op === 'load').pop().url === 'https://quizlet.com/');
    fromMain({ type: 'web', web: { id: 'p3', downloaded: 'Made-up notes.pdf' } });
    ok('a download says where it went', /Downloads: Made-up notes\.pdf/.test(pane.querySelector('.web-said').textContent));
    fromMain({ type: 'flush' });
    const e1 = new w.Event('message'); Object.assign(e1, { data: { cd: 'ws', type: 'flushed' } }); Object.defineProperty(e1, 'source', { value: d.querySelector('.pane[data-id="p1"] iframe').contentWindow }); w.dispatchEvent(e1);
    await sleep(100);
    const kept = act('workspaceDesk').desk;
    ok('the web pane and its page are kept, and the new bookmark', panesOf(kept.layout).find(p => p.pane === 'p3').url === 'https://quizlet.com/' && kept.bookmarks.some(b => b.url === 'https://quizlet.com/'), JSON.stringify(kept));
    d.querySelector('.pane[data-id="p3"] .shut').click();
    ok('closing a web pane leaves it out of the layout the app gets, so its page goes', webOps().filter(o => o.op === 'layout').pop().panes.length === 0);
    ok('the page script runs clean', errors.length === 0, errors.join('\n'));
    dom.window.close();
  }

  // ── the main page: the desk's boxes are in its frame; the app wants the window ──
  T.redraw(proj);
  const sent = [];
  const main = new JSDOM(fs.readFileSync(path.join(proj, 'summary.html'), 'utf8'), { url: 'file:///project/summary.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
    beforeParse(mw) { mw.Element.prototype.scrollIntoView = function () {}; mw.webkit = { messageHandlers: { classdash: { postMessage(b) { sent.push(b); } } } }; } });
  await sleep(200);
  const mw = main.window, md = mw.document;
  md.getElementById('workspace-button').click();
  mw.classdashBridgeResult(sent[0].id, { ok: true });
  const frame = md.getElementById('workspace-frame');
  frame.getBoundingClientRect = () => ({ left: 0, top: 28, width: 1200, height: 800 });
  const toFrame = [];
  Object.defineProperty(frame, 'contentWindow', { value: { postMessage: m => toFrame.push(m) } });
  const fake = data => { const e = new mw.Event('message'); Object.assign(e, { data: Object.assign({ cd: 'ws' }, data) }); Object.defineProperty(e, 'origin', { value: 'classdash-ws://app' }); Object.defineProperty(e, 'source', { value: frame.contentWindow }); mw.dispatchEvent(e); };
  fake({ type: 'action', id: 'flush', action: 'webPane', arg: JSON.stringify({ op: 'layout', panes: [{ id: 'p3', x: 10, y: 40, w: 300, h: 200, show: true, start: 'https://www.desmos.com/calculator' }] }) });
  const op = JSON.parse(sent.slice(-1)[0].arg);
  ok('the main page moves the desk\'s boxes by where its frame is', sent.slice(-1)[0].action === 'webPane' && op.panes[0].x === 10 && op.panes[0].y === 68 && op.panes[0].w === 300, JSON.stringify(op));
  mw.classdashWebPane({ id: 'p3', title: 'Made-up graph' });
  ok('...and passes the app\'s news about a page on to the desk', toFrame.some(m => m.type === 'web' && m.web.title === 'Made-up graph'));
  fake({ type: 'close' });
  fake({ type: 'flushed' });
  const hide = sent.filter(b => b.action === 'webPane').pop();
  ok('closing the workspace has the app close the web panes\' pages (nothing left running)', md.getElementById('workspace-panel').hidden && JSON.parse(hide.arg).op === 'closeAll');
  main.window.close();
})().catch(e => ok('ran without throwing', false, e.stack));
