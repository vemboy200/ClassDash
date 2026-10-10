// The Grades center (41-grades-center.js, the panel in 08-page.js): every
// assignment's score from Q and Canvas, and the AI sidebar. Made-up classes,
// scores and comments; the AI is a stand-in, never a real model.
process.env.CLASSDASH_GRADES_STORE = 'file';
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const { JSDOM, VirtualConsole } = T.jsdom();

// Shaped like Q's real Assignments fragment: a Detail cell, ids on the date
// and title cells, columns that vary, a red row for missing work.
const FRAGMENT = `<table class="txtin3 displaytbl tblassign"><caption id="capPer_1"><span>Per</span>: 1 <b>Made-up Biology (1111A)</b></caption>
<thead><tr class="tblhdr2"><td colspan="8">B  (85%)<b>1st Semester : <span>Current</span> <span>Grade</span></b></td></tr>
<tr><th><span>Detail</span></th><th><span>Date Due</span></th><th><span>Assigned</span></th><th><span>Assignment</span></th><th><span>Pts<br>Possible</span></th><th><span>Score</span></th><th><span>Pct<br>Score</span></th><th><span>Scored As</span></th><th><span>Not<br>Graded</span></th><th><span>Comments</span></th></tr></thead>
<tbody><tr class=""><td rowspan="1"></td><td id="ddate11">10/01/2026</td><td id="dateassigned11">09/28/2026</td><td id="descript11">Made-up Lab</td><td>10</td><td>9</td><td>90%</td><td>Points</td><td></td><td>Made-up nice work</td></tr>
<tr class="altRow" style="color:red"><td rowspan="1"></td><td id="ddate12">10/03/2026</td><td id="dateassigned12">10/01/2026</td><td id="descript12">Made-up Quiz &lt;b&gt;</td><td>20</td><td></td><td></td><td></td><td></td><td>Missing</td></tr>
<tr><td rowspan="1"></td><td id="ddate13">10/08/2026</td><td id="dateassigned13">10/06/2026</td><td id="descript13">Made-up Test</td><td>50</td><td>40</td><td>80%</td><td></td><td></td><td></td></tr></tbody></table>`;

const windows = [];
function open(proj, posted) {
  T.redraw(proj);
  const w = new JSDOM(fs.readFileSync(path.join(proj, 'summary.html'), 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://classdash.localhost/summary.html', virtualConsole: new VirtualConsole(),
    beforeParse(win) { win.setTimeout = () => 0; win.setInterval = () => 0; if (posted) win.webkit = { messageHandlers: { classdash: { postMessage: m => posted.push(m) } } }; } }).window;
  windows.push(w);
  return w;
}

(async () => {
  const on = { language: 'en', gradesProvider: 'q', gradesAddress: 'q.made-up.example/Production/StudentPortal', gradesUsername: 'made-up-user',
    canvas: 'https://made-up.instructure.example', canvasToken: 'made-up-token', aiProvider: 'ollama', aiModel: 'made-up:1b' };
  const proj = T.makeProject({ 'settings.json': on });
  process.chdir(proj);
  const grades = require(path.join(proj, '40-grades.js'));
  const center = require(path.join(proj, '41-grades-center.js'));

  // ── reading every assignment ──
  const q = grades.parseAssignments(new JSDOM(FRAGMENT).window.document);
  const a = q[0].assignments;
  ok('Q: each assignment row, with its columns found by header', a.length === 3 && a[0].title === 'Made-up Lab' && a[0].due === '2026-10-01' && a[0].assigned === '2026-09-28' &&
    a[0].possible === 10 && a[0].score === 9 && a[0].percent === 90 && a[0].comment === 'Made-up nice work' && a[0].extra['Scored As'] === 'Points', JSON.stringify(a[0]));
  ok('...a red row is missing, with no score', a[1].missing && a[1].score === null && a[1].possible === 20 && !a[0].missing);
  const c = grades.canvasAssignment({ id: 5, name: 'Made-up Essay', due_at: '2026-10-02T06:59:00Z', points_possible: 40, html_url: 'https://made-up.instructure.example/a/5', submission: { score: 34, grade: '34', late: true } });
  ok('Canvas: score, out of, percent, late and the link', c.score === 34 && c.possible === 40 && c.percent === 85 && c.late && !c.missing && c.link.endsWith('/a/5') && c.scoreText === null);
  ok('...excused and missing', grades.canvasAssignment({ id: 6, name: 'x', points_possible: 5, submission: { excused: true } }).scoreText === 'EX' &&
    grades.canvasAssignment({ id: 7, name: 'y', points_possible: 5, submission: { missing: true } }).missing);

  // ── estimating a grade from Canvas's categories ──
  const wt = grades.canvasWeighting({ apply_assignment_group_weights: true }, [
    { id: 1, name: 'Made-up Tests', group_weight: 60, rules: {} },
    { id: 2, name: 'Made-up Homework', group_weight: 40, rules: { drop_lowest: 1, never_drop: [24] } },
    { id: 3, name: 'Made-up Final', group_weight: 20 },
  ]);
  ok('weighting kept: weighted, weights, drop rules', wt.weighted && wt.groups[1].weight === 40 && wt.groups[1].dropLowest === 1 && wt.groups[1].neverDrop[0] === '24' && wt.groups[2].dropLowest === 0);
  const ca = (id, group, score, possible, more = {}) => ({ ...grades.canvasAssignment({ id, name: 'Made-up ' + id, points_possible: possible, assignment_group_id: group, submission: score === null ? {} : { score } }), ...more });
  const work = [ca(10, 1, 45, 50), ca(20, 2, 2, 10), ca(21, 2, 10, 10), ca(22, 2, 8, 10), ca(23, 2, 0, 10, { excused: true }), ca(24, 2, 1, 10), ca(30, 3, null, 100)];
  let est = grades.estimateGrade({ weighting: wt, assignments: work });
  // Tests 45/50 = 90%. Homework: excused one out, never-drop 24 stays, the lowest other (2/10) dropped: 19/30. The Final has nothing graded, so 60+40 rescale.
  ok('weighted: drops, excused, never-drop, and an ungraded group rescaled away', Math.abs(est.percent - (0.6 * 90 + 0.4 * 19 / 30 * 100)) < 0.01, JSON.stringify(est));
  ok('...each group\'s numbers', est.groups[1].earned === 19 && est.groups[1].possible === 30 && est.groups[1].dropped === 1 && est.groups[2].percent === null && est.groups[0].percent === 90);
  est = grades.estimateGrade({ weighting: { ...wt, weighted: false }, assignments: work });
  ok('not weighted: all the points together', Math.abs(est.percent - 64 / 80 * 100) < 0.01 && !est.weighted, JSON.stringify(est));
  ok('...omitted and not-graded work doesn\'t count', grades.canvasAssignment({ id: 1, omit_from_final_grade: true }).omitted && grades.canvasAssignment({ id: 2, grading_type: 'not_graded' }).omitted &&
    grades.estimateGrade({ weighting: wt, assignments: [ca(10, 1, 45, 50), ca(11, 1, 0, 50, { omitted: true })] }).percent === 90);
  ok('...nothing to go on: no estimate', grades.estimateGrade({ weighting: wt, assignments: [] }) === null && grades.estimateGrade({ assignments: work }) === null);
  ok('...drops never take every last one', grades.estimateGrade({ weighting: { weighted: false, groups: [{ id: '2', weight: 0, dropLowest: 5, dropHighest: 0, neverDrop: [] }] }, assignments: [ca(20, 2, 2, 10)] }).percent === 20);

  // Saved the way a Q check and a Canvas check save them.
  fs.writeFileSync(path.join(proj, 'grades.json'), JSON.stringify({ ok: true, triedAt: new Date().toISOString(), checkedAt: new Date().toISOString(), classes: q }));
  grades.saveCanvasGrades([{ name: 'Made-up Canvas Art Per 4', enrollments: [{ type: 'student', computed_current_score: 85, computed_current_grade: 'B' }] }],
    { 'Made-up Canvas Art Per 4': [c] });

  // ── what the center shows ──
  const data = center.centerData();
  ok('both sources, by period, newest work first', data.length === 2 && data[0].class === 'Made-up Biology' && data[1].period === '4' &&
    JSON.stringify(data[0].assignments.map(x => x.title)) === JSON.stringify(['Made-up Test', 'Made-up Quiz <b>', 'Made-up Lab']));
  ok('points added up over graded work, missing counted', JSON.stringify(data[0].totals) === JSON.stringify({ graded: 2, earned: 49, possible: 60, percent: 81.67, missing: 1 }), JSON.stringify(data[0].totals));
  const text = center.gradesText(data);
  ok('the model reads totals, scores, missing work and comments', /Totals over graded work: 49\/60 points = 81\.67%/.test(text) && /Made-up Quiz <b>: not graded, out of 20 \[MISSING\]/.test(text) &&
    /Made-up Lab: 9\/10 \(90%\) — teacher: "Made-up nice work"/.test(text) && /Made-up Essay: 34\/40 \(85%\) \[late\]/.test(text), text);
  ok('the API stays small: no assignments in /api/grades', !('assignments' in grades.gradesView().classes[0]));

  // ── who can be asked ──
  ok('no AI: off', center.canAsk({ aiProvider: 'none' }).why === 'off');
  ok('a local AI: fine', center.canAsk({ aiProvider: 'ollama' }).ok && center.canAsk({ aiProvider: 'ollama' }).local);
  ok('a cloud AI: not until its grades box is ticked', center.canAsk({ aiProvider: 'openai', aiAgreed: ['openai'] }).why === 'agree' &&
    center.canAsk({ aiProvider: 'openai', gradesAiAgreed: ['openai'] }).ok);

  // ── asking ──
  const asks = [];
  const fake = async ask => { asks.push(ask); return { ok: true, text: `Made-up answer ${asks.length}` }; };
  let r = await center.ask('  How am I doing in Made-up Biology?  ', { complete: fake, now: new Date('2026-10-09T12:00:00Z') });
  ok('a question is answered, and the chat saved', r.ok && r.answer === 'Made-up answer 1' && center.readChat().length === 2 && center.readChat()[0].text === 'How am I doing in Made-up Biology?');
  ok('...the prompt has the grades, today, and the system note', asks[0].system === center.SYSTEM && /Today is 2026-10-09/.test(asks[0].prompt) && /THE GRADES/.test(asks[0].prompt) && /Student: How am I doing/.test(asks[0].prompt) && !/CONVERSATION/.test(asks[0].prompt));
  r = await center.ask('And Art?', { complete: fake });
  ok('the next question carries the conversation so far', /THE CONVERSATION SO FAR[\s\S]*Student: How am I doing[\s\S]*You: Made-up answer 1[\s\S]*Student: And Art\?$/.test(asks[1].prompt) && r.messages.length === 4);
  ok('empty and too long: refused, not sent', (await center.ask('   ', { complete: fake })).why === 'empty' && (await center.ask('x'.repeat(2001), { complete: fake })).why === 'long' && asks.length === 2);
  const thinker = await center.ask('Made-up thinking?', { complete: async a => { asks.push(a); return { ok: true, text: 'Made-up thought answer', thinking: 'Made-up reasoning' }; } });
  ok('its thinking is asked for and saved with the answer', asks[2].think === true && thinker.messages.slice(-1)[0].thinking === 'Made-up reasoning' && center.readChat().slice(-1)[0].thinking === 'Made-up reasoning');
  await center.ask('And next?', { complete: async a => { asks.push(a); return { ok: true, text: 'x' }; } });
  ok('...but never sent back to the model with later questions', !/Made-up reasoning/.test(asks[3].prompt) && /Made-up thought answer/.test(asks[3].prompt) && !('thinking' in center.readChat().slice(-1)[0]));
  const local = async s => { let sent; await center.ask('Made-up?', { s, complete: async a => { sent = a; return { ok: true, text: 'x' }; } }); return sent.think; };
  const base = require(path.join(proj, '19-settings.js')).read();
  ok('thinking: on for a local AI unless switched off, always on for a cloud one', await local({ ...base, aiProvider: 'ollama' }) === true && await local({ ...base, aiProvider: 'ollama', aiThinking: false }) === false &&
    await local({ ...base, aiProvider: 'anthropic', aiThinking: false, gradesAiAgreed: ['anthropic'] }) === true);
  center.clearChat(); await center.ask('How am I doing in Made-up Biology?', { complete: async () => ({ ok: true, text: 'Made-up answer 1' }) }); await center.ask('And Art?', { complete: async () => ({ ok: true, text: 'Made-up answer 2' }) });
  // ── the answer shown as it's written ──
  {
    const liveFile = center.LIVE_FILE;
    let during = null;
    const streamer = async a => {
      a.onPart({ thinking: 'Made-up working', text: '' });
      await new Promise(r => setTimeout(r, 300));
      during = fs.existsSync(liveFile) ? fs.readFileSync(liveFile, 'utf8') : null;
      a.onPart({ thinking: 'Made-up working', text: 'Made-up live answer' });
      return { ok: true, text: 'Made-up live answer', thinking: 'Made-up working' };
    };
    await center.ask('Made-up live?', { complete: streamer, live: 'abc123' });
    ok('while it answers: the answer so far, tagged with the page\'s id', during && /^window\.classdashGradesLive = /.test(during) && JSON.parse(during.replace(/^window\.classdashGradesLive = |;\s*$/g, '')).id === 'abc123' && /Made-up working/.test(during), during);
    ok('...and gone once it\'s in', !fs.existsSync(liveFile));
    let gotPart = null;
    await center.ask('Made-up?', { complete: async a => { gotPart = a.onPart; return { ok: true, text: 'x' }; }, live: '../../evil' });
    ok('...an id that isn\'t plain letters and numbers: nothing written', gotPart === undefined && !fs.existsSync(liveFile));
    await center.ask('Made-up?', { complete: async a => { a.onPart({ thinking: '', text: 'x' }); await new Promise(r => setTimeout(r, 250)); throw new Error('made-up crash'); }, live: 'abc124' }).catch(() => {});
    ok('...gone even when the AI fails', !fs.existsSync(liveFile));
    center.clearChat(); await center.ask('How am I doing in Made-up Biology?', { complete: async () => ({ ok: true, text: 'Made-up answer 1' }) }); await center.ask('And Art?', { complete: async () => ({ ok: true, text: 'Made-up answer 2' }) });
  }
  ok('the AI failing: says so, saves nothing', (await center.ask('Made-up?', { complete: async () => ({ ok: false, why: 'made-up refusal' }) })).detail === 'made-up refusal' && center.readChat().length === 4);

  // ── the page ──
  const posted = [];
  let w = open(proj, posted), d = w.document;
  const panel = d.getElementById('grades-center');
  ok('a closed Grades center, opened from the Grades list', panel && panel.hidden && !!d.querySelector('#grades-section .grades-center-open'));
  d.querySelector('#grades-section .grades-center-open').click();
  ok('...opening it', !panel.hidden);
  const classes = [...panel.querySelectorAll('.gc-class')];
  ok('one fold-out per class, each with its grade', classes.length === 2 && /Made-up Biology\s*Q/.test(classes[0].querySelector('summary').textContent) && /B\s*85%/.test(classes[0].querySelector('summary').textContent));
  ok('...open from the start, so the assignments show without a click', classes.every(c => c.open));
  ok('...Score and % headers sit on the same side as their numbers', [...classes[0].querySelectorAll('thead th')].slice(2).every(th => th.classList.contains('gc-score') || th.classList.contains('gc-pct')));
  const rows = [...classes[0].querySelectorAll('tbody tr')];
  ok('assignment rows: date, title, score/out of, percent; missing in red', rows.length === 3 && /Made-up Test/.test(rows[0].textContent) && /40\/50/.test(rows[0].textContent) && /80%/.test(rows[0].textContent) &&
    rows[1].classList.contains('gc-missing') && /missing/.test(rows[1].textContent) && /—\/20/.test(rows[1].textContent));
  ok('...titles are text, never markup', !rows[1].querySelector('td b') && /Made-up Quiz <b>/.test(rows[1].textContent));
  ok('...Canvas work links to Canvas', classes[1].querySelector('tbody a').href === 'https://made-up.instructure.example/a/5' && /late/.test(classes[1].textContent));
  const msgs = [...d.querySelectorAll('#gc-chat .gc-msg')];
  ok('the saved chat is drawn', msgs.length === 4 && msgs[0].classList.contains('user') && msgs[1].textContent === 'Made-up answer 1');
  ok('a local AI: says the grades stay here, and the box is open', /stay here/.test(d.querySelector('.gc-ai-who').textContent) && !d.getElementById('gc-question').disabled);

  d.getElementById('gc-question').value = 'What about <img src=x onerror=alert(1)>?';
  d.getElementById('gc-ask').click();
  const sent = posted.find(m => m.action === 'gradesAsk');
  ok('Ask sends the question, shows it at once with Thinking…', sent && JSON.parse(Buffer.from(sent.arg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).question === 'What about <img src=x onerror=alert(1)>?' &&
    /Thinking/.test(d.querySelector('#gc-chat .gc-msg.pending').textContent) && !d.querySelector('#gc-chat img'));
  ok('...with an id for showing the answer as it\'s written', /^[a-z0-9]+$/.test(JSON.parse(Buffer.from(sent.arg, 'base64url').toString()).live));
  {
    // The page loads chat-live/answer.js on a timer while it waits: run that
    // timer by hand, and answer the script load ourselves.
    const timers = [];
    w.setTimeout = fn => { timers.push(fn); return timers.length; };
    w.clearTimeout = () => {};
    const liveId = JSON.parse(Buffer.from(sent.arg, 'base64url').toString()).live;
    const load = live => { timers.splice(0).forEach(fn => fn()); const tag = [...d.head.querySelectorAll('script')].pop(); w.classdashGradesLive = live; tag.onload(); };
    // the watch started before this override; one tick of it is already queued only in the old stub, so start a fresh one the way the page does
    w.watchGradesAnswer(liveId, 'What about <img src=x onerror=alert(1)>?');
    load({ id: liveId, thinking: 'Made-up <i>first</i> step', text: '' });
    let liveMsg = d.querySelector('#gc-chat .gc-msg.gc-live');
    ok('as it thinks: the thinking shows, open, with Thinking… under it', liveMsg && liveMsg.querySelector('details.gc-thought').open && liveMsg.querySelector('.gc-thought > div').textContent === 'Made-up <i>first</i> step' &&
      liveMsg.classList.contains('pending') && /Thinking/.test(liveMsg.querySelector('.gc-said').textContent) && !d.querySelector('#gc-chat i'));
    liveMsg.querySelector('details').open = false;
    load({ id: liveId, thinking: 'Made-up <i>first</i> step, then more', text: 'Made-up par' });
    liveMsg = d.querySelector('#gc-chat .gc-msg.gc-live');
    ok('...then the answer as it\'s written; the thinking stays closed once closed', liveMsg.querySelector('.gc-said').textContent === 'Made-up par' && !liveMsg.classList.contains('pending') && !liveMsg.querySelector('details').open);
    {
      // jsdom has no layout: give the thinking box and the chat a size by hand.
      const sized = (el, height, client) => { Object.defineProperty(el, 'scrollHeight', { value: height, configurable: true }); Object.defineProperty(el, 'clientHeight', { value: client, configurable: true }); };
      const msgBefore = d.querySelector('#gc-chat .gc-msg.gc-live');
      const thought = msgBefore.querySelector('.gc-thought > div');
      const chat = d.getElementById('gc-chat');
      sized(thought, 500, 100); sized(chat, 900, 300);
      thought.scrollTop = 0; chat.scrollTop = 0;   // scrolled up to read
      load({ id: liveId, thinking: 'Made-up <i>first</i> step, then more, and more', text: 'Made-up parti' });
      ok('...updated in place, not rebuilt, and scrolled up stays scrolled up', d.querySelector('#gc-chat .gc-msg.gc-live') === msgBefore && msgBefore.querySelector('.gc-thought > div') === thought &&
        thought.scrollTop === 0 && chat.scrollTop === 0 && msgBefore.querySelector('.gc-said').textContent === 'Made-up parti');
      thought.scrollTop = 400; chat.scrollTop = 600;   // back at the bottom
      load({ id: liveId, thinking: 'Made-up <i>first</i> step, then more, and more, and the end', text: 'Made-up partial' });
      ok('...and at the bottom, it follows the newest words', thought.scrollTop === 500 && chat.scrollTop === 900, `${thought.scrollTop} ${chat.scrollTop}`);
    }
    load({ id: 'someone-else', thinking: 'Not this one', text: 'Other answer' });
    ok('...another question\'s answer is never shown', d.querySelector('#gc-chat .gc-msg.gc-live .gc-said').textContent === 'Made-up partial');
  }
  w.classdashBridgeResult(sent.id, { ok: true, answer: '<b>bold?</b>', messages: [...center.readChat(), { role: 'user', text: 'What about <img src=x onerror=alert(1)>?' }, { role: 'ai', text: '<b>bold?</b>', thinking: '<i>Made-up adding up</i>' }] });
  const last = d.querySelectorAll('#gc-chat .gc-msg')[5];
  ok('the finished answer replaces the live one, and the watch stops', !d.querySelector('#gc-chat .gc-msg.gc-live') && w.gradesLiveTimer === null);
  ok('the answer is drawn as text', d.querySelectorAll('#gc-chat .gc-msg').length === 6 && !d.querySelector('#gc-chat b') && last.lastChild.textContent === '<b>bold?</b>' && d.getElementById('gc-question').value === '');
  ok('...with its thinking folded up above it, as text too', last.querySelector('details.gc-thought') && !last.querySelector('details').open && /Its thinking/.test(last.querySelector('summary').textContent) &&
    last.querySelector('.gc-thought > div').textContent === '<i>Made-up adding up</i>' && !d.querySelector('#gc-chat i') && !d.querySelectorAll('#gc-chat .gc-msg')[1].querySelector('details'));
  d.querySelector('.gc-ai-buttons .mini-btn:nth-child(2)').click();
  ok('Clear chat empties it and tells the app', d.querySelectorAll('#gc-chat .gc-msg').length === 0 && posted.some(m => m.action === 'gradesChatClear'));

  // a cloud AI without the box ticked
  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ ...on, aiProvider: 'openai', aiAgreed: ['openai'] }));
  const posted2 = [];
  w = open(proj, posted2); d = w.document;
  ok('a cloud AI: the notice and its box, and asking is off until it\'s ticked', /go to OpenAI/.test(d.querySelector('.gc-agree').textContent) && d.getElementById('gc-question').disabled);
  const box = d.getElementById('gc-agree-box');
  box.checked = true; box.dispatchEvent(new w.Event('change'));
  const agreed = posted2.find(m => m.action === 'config');
  ok('...ticking it saves gradesAiAgreed only', agreed && Buffer.from(agreed.arg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString() === '{"gradesAiAgreed":["openai"]}');
  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ ...on, aiProvider: 'none' }));
  d = open(proj).document;
  ok('no AI: says where to turn it on', /Settings → AI/.test(d.querySelector('.gc-ai-who').textContent) && d.getElementById('gc-question').disabled);

  // ── the actions ──
  // An address nothing listens on: no real AI is ever contacted.
  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ ...on, aiLocalUrl: 'http://127.0.0.1:9/v1' }));
  const notifier = require(path.join(proj, '21-notifier-actions.js'));
  const res = await notifier.main('gradesAsk', Buffer.from(JSON.stringify({ question: 'Made-up secret question' })).toString('base64url'));
  ok('asking with no AI reachable: a reason in words', !res.ok && /the AI didn't answer/.test(res.why), JSON.stringify(res));
  const log = fs.readFileSync(path.join(proj, 'notifier-log.txt'), 'utf8');
  ok('...and the log never has the question', !log.includes('Made-up secret question') && !log.includes(Buffer.from(JSON.stringify({ question: 'Made-up secret question' })).toString('base64url')) && /gradesAsk \(payload not logged\)/.test(log));
  await notifier.main('gradesChatClear', '');
  ok('Clear removes the saved chat', !fs.existsSync(center.CHAT_FILE));
  // ── a Canvas teacher who hides the overall grade ──
  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify(on));
  grades.saveCanvasGrades([{ name: 'Made-up Canvas Art Per 4', enrollments: [{ type: 'student' }] }], { 'Made-up Canvas Art Per 4': work }, new Date(), { 'Made-up Canvas Art Per 4': wt });
  const hiddenView = grades.gradesView().classes.find(x => x.source === 'canvas');
  ok('the estimate is in /api/grades, the grade itself still null', hiddenView.percent === null && hiddenView.grade === null && Math.abs(hiddenView.estimate.percent - 79.33) < 0.01, JSON.stringify(hiddenView));
  d = open(proj).document;
  const listMark = [...d.querySelectorAll('#grades-section .grade-row')].find(r => /Canvas Art/.test(r.textContent)).querySelector('.grade-mark');
  ok('the Grades list shows it with a ~, and says it\'s an estimate', /^~79\.33%$/.test(listMark.textContent.trim()) && /estimate/.test(listMark.querySelector('.grade-estimate').title), listMark.textContent);
  const artBlock = [...d.querySelectorAll('.gc-class')].find(x => /Canvas Art/.test(x.textContent));
  ok('the Grades center: the estimate, each category, and each assignment\'s category', /estimate: 79\.33% from Canvas's category weights/.test(artBlock.querySelector('.gc-estimate').textContent) &&
    /Made-up Homework \(40%\): 63\.33%/.test(artBlock.querySelector('.gc-categories').textContent) && /Made-up Final \(20%\): nothing graded yet/.test(artBlock.textContent) && /Made-up Tests/.test(artBlock.querySelector('.gc-cat').textContent));
  const aiText = center.gradesText(center.centerData());
  ok('the AI reads the weights and the estimate', /Categories \(weighted\): Made-up Tests weight 60%: 45\/50 = 90%; Made-up Homework weight 40%: 19\/30 = 63\.33%, 1 lowest\/highest dropped/.test(aiText) &&
    /estimate of the grade from these: 79\.33%/.test(aiText) && /Made-up 10 \[Made-up Tests\]: 45\/50/.test(aiText), aiText);
  const shownCanvas = grades.gradesView().classes.find(x => x.source === 'canvas');
  ok('a posted grade isn\'t replaced: the ~ only shows when the percent is hidden', (() => {
    grades.saveCanvasGrades([{ name: 'Made-up Canvas Art Per 4', enrollments: [{ type: 'student', computed_current_score: 80, computed_current_grade: 'B-' }] }], { 'Made-up Canvas Art Per 4': work }, new Date(), { 'Made-up Canvas Art Per 4': wt });
    const m = [...open(proj).document.querySelectorAll('#grades-section .grade-row')].find(r => /Canvas Art/.test(r.textContent)).querySelector('.grade-mark');
    return !m.querySelector('.grade-estimate') && /B-\s*80%/.test(m.textContent);
  })() && shownCanvas.estimate);
  windows.forEach(x => x.close());
})().catch(e => { console.log('FAIL crashed', e.stack); process.exitCode = 1; });
