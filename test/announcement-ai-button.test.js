// The AI scan button beside an announcement and the fold-out under it
// (08-page.js, 38-announcement-scan.js's record): shown only with AI on,
// the button scans that one announcement, and the fold-out says what the
// AI found, what became of each item, what it answered and its thinking.
// Made-up announcements and scan records only.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const { JSDOM, VirtualConsole } = T.jsdom();

const posts = [
  { platform: 'Classroom', type: 'announcement', class: 'Made-up Bio', id: 'post-1', author: 'Made-up Teacher', date: 'Oct 5', title: 'Worksheet', text: 'Finish the worksheet by Thursday.', link: 'https://classroom.example/1', sortTime: Date.now() },
  { platform: 'Classroom', type: 'announcement', class: 'Made-up Math', id: 'post-2', author: 'Made-up Teacher', date: 'Oct 4', title: 'Trip', text: 'Great trip today!', link: 'https://classroom.example/2', sortTime: Date.now() - 864e5 },
  { platform: 'Classroom', type: 'announcement', class: 'Made-up Math', id: 'post-3', author: 'Made-up Teacher', date: 'Oct 3', title: 'Old', text: 'Scanned before steps were kept.', link: 'https://classroom.example/3', sortTime: Date.now() - 2 * 864e5 },
];
const scan = {
  known: ['post-1', 'post-2', 'post-3'],
  scanned: {
    'post-1': { at: '2026-10-05T16:00:00.000Z', found: 3, kept: 1, answer: '{"items":[{"title":"Finish the worksheet"}]}', thinking: 'It asks for a worksheet by Thursday.',
      steps: [
        { title: 'Finish the worksheet', due: '2026-10-09T06:59:00.000Z', outcome: 'kept' },
        { title: 'Read chapter 4', due: null, outcome: 'sameWork', match: 'Chapter 4 reading' },
        { title: 'Write a poem', due: null, outcome: 'notInText' },
      ] },
    'post-2': { at: '2026-10-04T16:00:00.000Z', found: 0, kept: 0, answer: '{"items":[]}', steps: [] },
    'post-3': { at: '2026-10-03T16:00:00.000Z', found: 0, kept: 0 },
  },
};

const windows = [];
function open(proj, { bridge = true, before } = {}) {
  T.redraw(proj);
  const posted = [];
  const dom = new JSDOM(fs.readFileSync(path.join(proj, 'summary.html'), 'utf8'), {
    // An http address only so jsdom gives the page sessionStorage (it has
    // none for file:); the apps load it from a file, where it does.
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://classdash.localhost/summary.html', virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      if (bridge) w.webkit = { messageHandlers: { classdash: { postMessage: m => posted.push(m) } } };
      w.Element.prototype.scrollIntoView = function () {};
      w.setTimeout = () => 0;
      if (before) before(w);
    },
  });
  windows.push(dom.window);
  return { w: dom.window, d: dom.window.document, posted };
}

(async () => {
  // ── AI off: nothing new on the cards ──
  {
    const proj = T.makeProject({ 'settings.json': { language: 'en' }, 'messages.json': posts, 'ai-scan.json': scan });
    const { d } = open(proj);
    ok('AI off: no AI scan button and no fold-out', !d.querySelector('.ai-scan-btn') && !d.querySelector('.ai-result'));
    ok('...and the cards are there as before', d.querySelectorAll('.post').length === 3);
  }

  const proj = T.makeProject({ 'settings.json': { language: 'en', aiProvider: 'ollama', aiModel: 'made-up:1b' }, 'messages.json': posts, 'ai-scan.json': scan });
  const { w, d, posted } = open(proj);

  // ── the button ──
  const buttons = [...d.querySelectorAll('.post-row .card-actions .ai-scan-btn')];
  ok('AI on: an AI scan button beside every announcement, in the slide-out', buttons.length === 3 && buttons[0].textContent === 'AI scan' && buttons[0].getAttribute('data-id') === 'post-1');
  ok('...outside the card itself', !d.querySelector('.post .ai-scan-btn'));

  // ── the fold-out ──
  const fold = id => d.querySelector(`.ai-result[data-scan-for="${id}"]`);
  const one = fold('post-1');
  ok('a scanned announcement has a fold-out, closed', !!one && !one.open && one.closest('.post') === d.querySelectorAll('.post')[0]);
  ok('...its summary says how many were added', /^AI: 1 added to reminders/.test(one.querySelector('summary').textContent), one.querySelector('summary').textContent);
  const steps = [...one.querySelectorAll('li')].map(li => li.textContent);
  ok('...each item and what became of it', steps.length === 3 && /Finish the worksheet · due .* — added to reminders/.test(steps[0]) &&
    /Read chapter 4 · no due date — left out: the AI says it's the same as “Chapter 4 reading”/.test(steps[1]) && /Write a poem .* left out: not in the announcement/.test(steps[2]), JSON.stringify(steps));
  const pres = [...one.querySelectorAll('pre')].map(p => p.textContent);
  ok('...what it answered and its thinking', pres.length === 2 && pres[0] === scan.scanned['post-1'].answer && pres[1] === 'It asks for a worksheet by Thursday.');
  const two = fold('post-2');
  ok('nothing found: says so, and that this model sent no thinking', /AI: no homework found/.test(two.textContent) && /found no homework in this one/.test(two.textContent) && /didn't send its thinking/.test(two.textContent) && two.querySelectorAll('pre').length === 1);
  ok('a scan from before steps were kept asks for a new one', /Scan it again to see what the AI answered/.test(fold('post-3').textContent));

  // ── pressing it ──
  buttons[1].click();
  const status = d.querySelectorAll('.ai-post-status')[1];
  ok('pressing it scans that one announcement', posted.length === 1 && posted[0].action === 'aiScan' &&
    JSON.stringify(JSON.parse(Buffer.from(posted[0].arg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())) === '["post-2"]', JSON.stringify(posted));
  ok('...and the last scan\'s fold-out steps aside, so its result isn\'t read as this one\'s', fold('post-2').hidden);
  ok('...says it\'s reading, on the card', buttons[1].disabled && buttons[1].textContent === 'Scanning…' && !status.hidden && /Reading it/.test(status.textContent));
  w.classdashBridgeResult(posted[0].id, { ok: false, why: 'a scan is already running' });
  ok('a scan that didn\'t run says why, and the button is back', /a scan is already running/.test(status.textContent) && !buttons[1].disabled && buttons[1].textContent === 'AI scan');
  ok('...and the last scan\'s fold-out is back', !fold('post-2').hidden);
  buttons[1].click();
  w.classdashBridgeResult(posted[1].id, { ok: true, scanned: 1, kept: [], dropped: 0, failed: 0 });
  ok('one that ran remembers to open its fold-out after the reload', w.sessionStorage.getItem('classdash-open-scan') === 'post-2');

  // ── after the reload ──
  {
    const again = open(proj, { before: w2 => w2.sessionStorage.setItem('classdash-open-scan', 'post-2') });
    const f = again.d.querySelector('.ai-result[data-scan-for="post-2"]');
    ok('after the reload, that fold-out is open and the others aren\'t', f.open && !again.d.querySelector('.ai-result[data-scan-for="post-1"]').open);
    ok('...only once', again.w.sessionStorage.getItem('classdash-open-scan') === '');
  }

  // ── the class filter hides the whole row, button and all ──
  const mathBox = d.querySelector('input[data-group="post-cls"][value="Made-up Math"]');
  mathBox.checked = true; w.filterAnnouncements();
  const rows = [...d.querySelectorAll('.post-row')];
  ok('filtering by class hides the other classes\' rows', rows[0].hidden && !rows[1].hidden && !rows[2].hidden);

  // ── the action redraws after any scan, so the fold-out is filled in ──
  {
    process.chdir(proj);
    const scanner = require(path.join(proj, '38-announcement-scan.js'));
    const real = scanner.scan;
    scanner.scan = async () => ({ ok: true, scanned: 1, kept: [], dropped: 0, failed: 0 });
    const before = fs.statSync(path.join(proj, 'summary.html')).mtimeMs;
    await new Promise(r => setTimeout(r, 20));
    const notifier = require(path.join(proj, '21-notifier-actions.js'));
    const r = await notifier.main('aiScan', Buffer.from('["post-2"]').toString('base64url'));
    scanner.scan = real;
    ok('the aiScan action redraws even when nothing was added', r.ok && fs.statSync(path.join(proj, 'summary.html')).mtimeMs > before, JSON.stringify(r));
  }
  windows.forEach(x => x.close());
})();
