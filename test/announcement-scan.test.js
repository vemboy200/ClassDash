// Homework in announcements (38-announcement-scan.js): the model's answer
// read carefully, dates worked out from the announcement's own words,
// invented work and work that's already there dropped, new announcements
// scanned once and the backlog left alone, picked ones scanned on demand,
// and the page showing all of it. A stand-in answers for the model; real
// ones (Apple's, Ollama's) were tried by hand with made-up announcements.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };

const MON = new Date(2026, 9, 5, 9).getTime();   // Monday, Oct 5 2026
const FRI = new Date(2026, 9, 2, 15).getTime();  // Friday, Oct 2 2026
const soon = new Date(2026, 9, 14, 23, 59);       // Problem Set 7's due date
const ann = (id, cls, text, sortTime = Date.now() - 3600e3) => ({ platform: 'Classroom', type: 'Announcement', class: cls, id, author: 'Made-up Teacher', date: 'Oct 5', title: '', text, link: `https://classroom.example/${id}`, sortTime });

const proj = T.makeProject({
  'settings.json': { language: 'en', aiProvider: 'ollama', aiModel: 'm', classLinks: [{ name: 'Made-up Bio', classes: ['Biology Period 2'] }] },
  'classes.json': [{ name: 'Biology Period 2' }, { name: 'Made-up Math' }],
  'last-collection.json': [{ class: 'Made-up Math', id: 'r1', type: 'Assignment', title: 'Problem Set 7', due: null, due_iso: soon.toISOString(), link: 'x' }],
  'messages.json': [ann('old1', 'Made-up Math', 'An old post with homework: read chapter 2 by Friday.', MON)],
});
process.chdir(proj);
const sc = require(path.join(proj, '38-announcement-scan.js'));
const virtual = require(path.join(proj, '24-virtual-assignments.js'));
const write = (f, v) => fs.writeFileSync(path.join(proj, f), JSON.stringify(v, null, 2));

(async () => {
  // ── reading the answer ──
  const posted = new Date(MON);
  const p = (text) => sc.parseItems(text, posted);
  ok('{"items": [...]} as asked', JSON.stringify(p('{"items":[{"title":"Worksheet","when":"Thursday","due":"2026-10-08"}]}').map(i => i.title)) === '["Worksheet"]');
  ok('...or a bare list in a ```json fence', p('```json\n[{"title":"Worksheet","due":"2026-10-8"}]\n```')[0].due.getDate() === 8);
  ok('nothing usable: null, not a guess', p('Sorry, I cannot help.') === null && p('{"items": "none"}') === null);
  ok('empty titles left out, at most five items', p('{"items":[{"title":" "},{"title":"a"},{"title":"b"},{"title":"c"},{"title":"d"},{"title":"e"},{"title":"f"}]}').length === 4);
  ok('a due date far from the posting day (a wrong year) becomes none', p('{"items":[{"title":"x","due":"2027-10-08"}]}')[0].due === null);
  ok('due at the end of that day', (() => { const d = p('{"items":[{"title":"x","due":"2026-10-08"}]}')[0].due; return d.getHours() === 23 && d.getMinutes() === 59; })());

  // ── the words, not the model's arithmetic ──
  const when = (w, from = posted) => { const d = sc.resolveWhen(w, from); return d ? `${d.getMonth() + 1}/${d.getDate()}` : null; };
  ok('tomorrow, today', when('tomorrow') === '10/6' && when('due tonight') === '10/5');
  ok('a weekday is the next one after posting', when('by Thursday') === '10/8' && when('Friday') === '10/9' && when('Monday') === '10/12');
  ok('"next Wednesday" posted on a Friday is five days later', when('next Wednesday', new Date(FRI)) === '10/7');
  ok('month and day, in any common way', when('due Oct 14') === '10/14' && when('October 14th') === '10/14' && when('14 October') === '10/14' && when('10/14') === '10/14');
  ok('a date earlier in the year is next year\'s', sc.resolveWhen('Jan 5', posted).getFullYear() === 2027);
  ok('no date in the words: none', when('soon') === null && when('') === null && when(null) === null);
  ok('the words win over the model\'s date', p('{"items":[{"title":"Quiz","when":"Friday","due":"2026-10-16"}]}')[0].due.getDate() === 9);

  // ── invented work, and work that's already there ──
  ok('work the announcement mentions is kept', sc.grounded('Finish the cell worksheet', 'Please finish the cell worksheet by Thursday'));
  ok('work it doesn\'t mention is dropped', !sc.grounded('Study for the test', 'Great job on the field trip! Grades are posted.') && !sc.grounded('nothing', 'Grades are posted.'));
  ok('"Study for the quiz" is fine when the announcement says it', sc.grounded('Study for the quiz', 'study for the quiz on Friday'));
  ok('similar titles: one inside the other, or most words shared', sc.similar('Problem Set 7', 'problem set 7 (pages 4-6)') && sc.similar('Read chapter 2 notes', 'Chapter 2 notes'));
  ok('...and different work isn\'t', !sc.similar('Problem Set 7', 'Lab report'));
  const day = new Date(2026, 9, 8, 23, 59);
  ok('a conflict: same class and a similar title', sc.conflict({ class: 'Math', title: 'Problem set 7', due: null }, [{ class: 'Math', title: 'Problem Set 7', due: null }]) === 'same title');
  ok('...or the same due day', sc.conflict({ class: 'Math', title: 'Worksheet', due: day }, [{ class: 'Math', title: 'Lab', due: new Date(2026, 9, 8, 9) }]) === 'same due day');
  ok('...never across classes', sc.conflict({ class: 'Math', title: 'Problem set 7', due: day }, [{ class: 'History', title: 'Problem set 7', due: day }]) === null);

  // ── the automatic scan: new ones only, each once ──
  const asked = [];
  const fake = answers => async ({ system, prompt }) => { asked.push(prompt); return answers.shift() || { ok: true, text: '{"items":[]}' }; };

  let r = await sc.scan({ newOnly: true }, { complete: fake([]) });
  ok('AI turned on before this existed: what\'s there is the backlog, nothing read', r.ok && r.scanned === 0 && asked.length === 0 && sc.readState().known.includes('old1'));

  write('messages.json', [ann('old1', 'Made-up Math', 'An old post with homework: read chapter 2 by Friday.', MON),
    ann('n1', 'Biology Period 2', 'Please finish the cell worksheet by Thursday and study for the quiz on Friday.', MON),
    ann('n2', 'Made-up Math', 'Problem set 7 is due Oct 14. Bring a calculator.', MON),
    ann('n3', 'Biology Period 2', 'Great job on the field trip today!', MON)]);
  ok('the ones not yet read are what a check would start a scan for', JSON.stringify(sc.pendingNew()) === '["n1","n2","n3"]');
  r = await sc.scan({ newOnly: true }, { complete: fake([
    { ok: true, text: '{"items":[{"title":"Finish the cell worksheet","when":"Thursday"},{"title":"Study for the quiz","when":"Friday"}]}' },
    { ok: true, text: '{"items":[{"title":"Problem set 7","when":"Oct 14"},{"title":"Bring a calculator","when":null}]}' },
    { ok: true, text: '```json\n[{"title":"Write a poem about volcanoes","when":null}]\n```' },  // invented: nothing due, no date to clash with
  ]) });
  ok('three new ones read, the backlog left alone', r.ok && r.scanned === 3 && asked.length === 3 && !asked.some(q => /chapter 2/.test(q)), JSON.stringify(r));
  ok('the model gets the class, the posting day and the days after, and the text', /Class: Made-up Bio\n/.test(asked[0]) && /Posted: Monday 2026-10-05/.test(asked[0]) && /Thursday 2026-10-08/.test(asked[0]) && /cell worksheet/.test(asked[0]));
  const made = virtual.readAll();
  const titles = made.map(v => v.title).sort();
  ok('kept: the worksheet, the quiz and the calculator', JSON.stringify(titles) === '["Bring a calculator","Finish the cell worksheet","Study for the quiz"]', JSON.stringify(titles));
  ok('dropped: the problem set (already an assignment) and the invented test', r.kept.length === 3 && r.dropped === 2);
  const sheet = made.find(v => v.title === 'Finish the cell worksheet');
  ok('the class is the announcement\'s, as shown (the link\'s name)', sheet.class === 'Made-up Bio');
  ok('...due Thursday at the end of the day', new Date(sheet.due).getDate() === 8 && new Date(sheet.due).getHours() === 23);
  ok('...and it says which announcement it came from', sheet.from && sheet.from.announcement === 'n1' && sheet.from.link === 'https://classroom.example/n1');
  ok('what each scan found is kept, without the text', sc.readState().scanned.n1.kept === 2 && sc.readState().scanned.n3.kept === 0 && !JSON.stringify(sc.readState()).includes('worksheet'));

  asked.length = 0;
  r = await sc.scan({ newOnly: true }, { complete: fake([]) });
  ok('scanned once: the next check reads nothing again', r.scanned === 0 && asked.length === 0 && sc.pendingNew().length === 0);

  // ── picked on purpose ──
  virtual.remove(sheet.id);
  r = await sc.scan({ ids: ['old1', 'n1'] }, { complete: fake([
    { ok: true, text: '{"items":[{"title":"Read chapter 2","when":"by Friday"}]}' },  // Oct 9: no other Math work due
    { ok: true, text: '{"items":[{"title":"Finish the cell worksheet","when":"Thursday"},{"title":"Study for the quiz","when":"Friday"}]}' },
  ]) });
  ok('picked ones are read, backlog or already scanned', r.scanned === 2 && asked.length === 2);
  ok('...a deleted reminder comes back only because it was asked for, and one still there isn\'t doubled', r.kept.length === 2 && r.dropped === 1 &&
    virtual.readAll().filter(v => v.title === 'Study for the quiz').length === 1, JSON.stringify(r));

  // ── failures ──
  write('messages.json', [...JSON.parse(fs.readFileSync(path.join(proj, 'messages.json'), 'utf8')), ann('n4', 'Made-up Math', 'Bring your textbook Monday.')]);
  r = await sc.scan({ newOnly: true }, { complete: fake([{ ok: false, why: 'couldn\'t connect: is its server running?' }]) });
  ok('the model unreachable: recorded as failed, with why', r.ok && r.failed === 1 && /running/.test(r.why) && sc.readState().scanned.n4.error);
  fs.writeFileSync(path.join(proj, 'ai-scan.lock'), String(process.ppid));
  r = await sc.scan({ ids: ['n4'] }, { complete: fake([]) });
  ok('one scan at a time', !r.ok && /already running/.test(r.why));
  fs.unlinkSync(path.join(proj, 'ai-scan.lock'));
  r = await sc.scan({ ids: ['n4'] }, { complete: fake([]), settings: { aiProvider: 'none' } });
  ok('AI off: nothing scanned', !r.ok && /off/.test(r.why));

  // ── turning AI on, and the page's own create ──
  {
    const fresh = T.makeProject({ 'settings.json': { language: 'en' }, 'messages.json': [ann('b1', 'Made-up Math', 'Read chapter 1.')] });
    const enc = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    T.run(fresh, '21-notifier-actions.js', ['config', enc({ aiProvider: 'ollama' })]);
    const state = JSON.parse(fs.readFileSync(path.join(fresh, 'ai-scan.json'), 'utf8'));
    ok('turning AI on records what\'s there as the backlog', JSON.stringify(state.known) === '["b1"]');
    T.run(fresh, '21-notifier-actions.js', ['virtualCreate', enc({ title: 'Mine', from: { announcement: 'b1', link: 'https://evil.example' } })]);
    const mine = JSON.parse(fs.readFileSync(path.join(fresh, 'virtual-assignments.json'), 'utf8'));
    ok('a reminder made on the page can\'t claim to be from an announcement', mine.length === 1 && !mine[0].from);
    const bad = T.run(fresh, '21-notifier-actions.js', ['aiScan', enc([])]);
    ok('scanning nothing picked says so', /no announcements picked/.test(bad.stdout));
  }

  // ── the page ──
  {
    T.redraw(proj);
    const html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
    const { JSDOM, VirtualConsole } = T.jsdom();
    const posted2 = [];
    const dom = new JSDOM(html, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'file:///summary.html', virtualConsole: new VirtualConsole(),
      beforeParse(w) { w.Element.prototype.scrollIntoView = function () {}; w.webkit = { messageHandlers: { classdash: { postMessage: m => posted2.push(m) } } }; w.setTimeout = () => 0; },
    });
    const w = dom.window, d = w.document;
    const from = [...d.querySelectorAll('.reminder-from')];
    ok('a reminder from an announcement links to it', from.length >= 2 && from[0].getAttribute('href').startsWith('https://classroom.example/'));
    ok('the footer says AI reads announcements while it\'s on', /AI only reads announcements/.test(d.querySelector('footer').textContent));
    const rows = [...d.querySelectorAll('#ai-scan-list .ai-scan-row')];
    ok('Settings → AI lists every announcement, newest first, with what its scan found', rows.length === 5 &&
      /· 2 added|· 1 added/.test(d.getElementById('ai-scan-list').textContent) && /nothing found/.test(d.getElementById('ai-scan-list').textContent) && /couldn't be read/.test(d.getElementById('ai-scan-list').textContent));
    ok('...under the class as shown', /Made-up Bio/.test(rows.map(r => r.textContent).join()) && !/Biology Period 2/.test(rows.map(r => r.textContent).join()));
    const button = d.querySelector('#ai-scan .mini-btn');
    w.scanAi(button);
    ok('Scan selected with nothing ticked: asks for some, sends nothing', posted2.length === 0 && /Tick some/.test(d.getElementById('ai-scan-status').textContent));
    rows[0].querySelector('input').checked = true; rows[2].querySelector('input').checked = true;
    w.scanAi(button);
    ok('ticked: saves first', posted2[0] && posted2[0].action === 'config' && button.disabled);
    w.classdashBridgeResult(posted2[0].id, { ok: true, accepted: [], rejected: [] });
    const ids = JSON.parse(Buffer.from(posted2[1].arg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    ok('...then scans exactly the ticked ones', posted2[1].action === 'aiScan' && JSON.stringify(ids) === JSON.stringify([rows[0].querySelector('input').value, rows[2].querySelector('input').value]));
    w.classdashBridgeResult(posted2[1].id, { ok: true, scanned: 2, kept: [{}], dropped: 1, failed: 0, announcements: [{ id: rows[0].querySelector('input').value, scanned: { kept: 3 } }] });
    ok('...and says what happened, updating the list', /Read: 2\. Reminders added: 1\. Already there: 1\./.test(d.getElementById('ai-scan-status').textContent) &&
      /· 3 added/.test(rows[0].textContent) && !rows[0].querySelector('input').checked && !button.disabled, d.getElementById('ai-scan-status').textContent);
    w.close();
  }
  {
    write('settings.json', { language: 'en' });
    T.redraw(proj);
    const html = fs.readFileSync(path.join(proj, 'summary.html'), 'utf8');
    ok('AI off: the footer is the plain one', /no model involved/.test(html) && !/AI only reads/.test(html));
  }

  // ── a check starts the scan ──
  const collector = fs.readFileSync(path.join(T.REPO, 'src/05-playwright-draft.js'), 'utf8');
  ok('a check starts the scan once announcements are saved', /fs\.writeFileSync\(STREAM_FILE[^\n]*\n\s*startAnnouncementScan\(\);\n\}\)\(\);/.test(collector));
  ok('...only with AI on, only when something\'s new, detached', /function startAnnouncementScan\(\) \{[\s\S]{0,200}aiProvider === 'none'\) return;[\s\S]{0,300}pendingNew\(\)\.length\) return;[\s\S]{0,300}detached: true/.test(collector));
})();
