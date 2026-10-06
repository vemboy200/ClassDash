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

  // ── no date given: the night before the class next meets ──
  {
    const schedule = require(path.join(proj, '35-school-schedule.js'));
    const cal = require(path.join(proj, '33-school-calendar.js')).readCalendar();
    const oddEven = { type: 'oddEven', classes: [{ class: 'Made-up Math', period: 1, days: 'A' }, { class: 'Made-up Art', period: 2, days: 'B' }], flips: [] };
    const daily = { type: 'daily', classes: [{ class: 'Made-up Math', period: 1, days: 'all' }], flips: [] };
    const next = (names, from, sched) => { const d = sc.nextMeetingDue(names, from, { schedule, sched, cal }); return d ? `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes()}` : null; };
    ok('odd/even: posted Mon the 5th, odd-day class next meets Wed the 7th, so due Tue night', next(['Made-up Math'], posted, oddEven) === '10/6 23:59');
    ok('...an even-day class meets Tue the 6th, so due the night it was posted', next(['Made-up Art'], posted, oddEven) === '10/5 23:59');
    ok('every day: posted on a Friday, due Sunday night before Monday\'s class', next(['Made-up Math'], new Date(FRI), daily) === '10/4 23:59');
    ok('...by its shown name or its own', next(['Made-up Bio', 'Made-up Math'], posted, daily) === '10/5 23:59');
    ok('a class not in the schedule, or no schedule: no date', next(['Made-up History'], posted, daily) === null && next(['Made-up Math'], posted, { type: 'none', classes: [] }) === null);
  }

  // ── invented work, and work that's already there ──
  ok('work the announcement mentions is kept', sc.grounded('Finish the cell worksheet', 'Please finish the cell worksheet by Thursday'));
  ok('work it doesn\'t mention is dropped', !sc.grounded('Study for the test', 'Great job on the field trip! Grades are posted.') && !sc.grounded('nothing', 'Grades are posted.'));
  ok('"Study for the quiz" is fine when the announcement says it', sc.grounded('Study for the quiz', 'study for the quiz on Friday'));
  ok('similar titles: one inside the other, or most words shared', sc.similar('Problem Set 7', 'problem set 7 (pages 4-6)') && sc.similar('Read chapter 2 notes', 'Chapter 2 notes'));
  ok('...and different work isn\'t', !sc.similar('Problem Set 7', 'Lab report'));
  const day = new Date(2026, 9, 8, 23, 59);
  ok('a conflict: same class and a similar title', sc.conflict({ class: 'Math', title: 'Problem set 7', due: null }, [{ class: 'Math', title: 'Problem Set 7', due: null }]) === 'same title');
  ok('...but not different work due the same day', sc.conflict({ class: 'Math', title: 'Worksheet', due: day }, [{ class: 'Math', title: 'Lab', due: new Date(2026, 9, 8, 9) }]) === null);
  ok('...never across classes', sc.conflict({ class: 'Math', title: 'Problem set 7', due: day }, [{ class: 'History', title: 'Problem set 7', due: day }]) === null);

  {
    const at = (m, d) => new Date(2026, m, d, 23, 59);
    const others = [{ class: 'Math', title: 'Far', due: at(10, 20) }, { class: 'Math', title: 'Undated', due: null }, { class: 'Math', title: 'Near', due: at(9, 9) },
      { class: 'History', title: 'Other class', due: at(9, 9) }, ...Array.from({ length: 12 }, (_, i) => ({ class: 'Math', title: `Soon ${i}`, due: at(9, 12) }))];
    const list = sc.compareList({ class: 'Math', title: 'x', due: at(9, 8) }, others, posted).map(o => o.title);
    ok('a draft is compared with its class\'s work, due nearest it first, at most 10', list.length === 10 && list[0] === 'Near' && !list.includes('Other class') && !list.includes('Far'));
    ok('...undated ones after the dated ones', JSON.stringify(sc.compareList({ class: 'Math', title: 'x', due: null }, others.slice(0, 3), posted).map(o => o.title)) === '["Near","Far","Undated"]');
    const pairs = [];
    const says = text => async ({ system, prompt }) => { pairs.push(prompt); return system === sc.SAME_SYSTEM ? { ok: true, text } : { ok: false }; };
    const draft = { class: 'Math', title: 'Bring your safety glasses', due: at(9, 6) };
    const goggles = { class: 'Math', title: 'Lab goggles', due: null };
    ok('the model says it\'s the same work: that one', await sc.sameWork(draft, [goggles], posted, says('Yes.')) === goggles && pairs[0] === 'New: Bring your safety glasses\nOn the list: Lab goggles');
    ok('...no, or an answer that isn\'t yes: none', await sc.sameWork(draft, [goggles], posted, says('No')) === null && await sc.sameWork(draft, [goggles], posted, says('yesterday')) === null);
    ok('...the model unreachable: none, so nothing is left out', await sc.sameWork(draft, [goggles], posted, async () => ({ ok: false, why: 'x' })) === null);
  }

  // ── the automatic scan: new ones only, each once ──
  const asked = [];
  const compared = [];
  let sameAs = [];  // [new title, title on the list] pairs the stand-in calls the same work
  const fake = answers => async ({ system, prompt }) => {
    if (system === sc.SAME_SYSTEM) {
      compared.push(prompt);
      const [, a, b] = prompt.match(/^New: (.*)\nOn the list: (.*)$/);
      return { ok: true, text: sameAs.some(([x, y]) => x === a && y === b) ? 'yes' : 'no' };
    }
    asked.push(prompt); return answers.shift() || { ok: true, text: '{"items":[]}' };
  };
  let r = await sc.scan({ newOnly: true }, { now: MON + 3600e3, complete: fake([]) });
  ok('AI turned on before this existed: what\'s there is the backlog, nothing read', r.ok && r.scanned === 0 && asked.length === 0 && sc.readState().known.includes('old1'));

  write('messages.json', [ann('old1', 'Made-up Math', 'An old post with homework: read chapter 2 by Friday.', MON),
    ann('n1', 'Biology Period 2', 'Please finish the cell worksheet by Thursday and study for the quiz on Friday.', MON),
    ann('n2', 'Made-up Math', 'Problem set 7 is due Oct 14. Bring a calculator.', MON),
    ann('n3', 'Biology Period 2', 'Great job on the field trip today!', MON)]);
  ok('the ones not yet read are what a check would start a scan for', JSON.stringify(sc.pendingNew(MON + 3600e3)) === '["n1","n2","n3"]');
  r = await sc.scan({ newOnly: true }, { now: MON + 3600e3, complete: fake([
    { ok: true, text: '{"items":[{"title":"Finish the cell worksheet","when":"Thursday"},{"title":"Study for the quiz","when":"Friday"}]}' },
    { ok: true, text: '{"items":[{"title":"Problem set 7","when":"Oct 14"},{"title":"Bring a calculator","when":null}]}' },
    { ok: true, text: '```json\n[{"title":"Write a poem about volcanoes","when":null}]\n```' },  // invented: nothing due, no date to clash with
  ]) });
  ok('three new ones read, the backlog left alone', r.ok && r.scanned === 3 && asked.length === 3 && !asked.some(q => /chapter 2/.test(q)), JSON.stringify(r));
  ok('the model gets the class, the posting day and the days after, and the text', /Class: Made-up Bio\n/.test(asked[0]) && /Posted: Monday 2026-10-05/.test(asked[0]) && /Thursday 2026-10-08/.test(asked[0]) && /cell worksheet/.test(asked[0]));
  ok('each draft left is compared with its own class\'s list only', compared.includes('New: Study for the quiz\nOn the list: Finish the cell worksheet') && !compared.some(q => /Problem Set 7/.test(q) && /Bio|cell|quiz/.test(q)));
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
  r = await sc.scan({ newOnly: true }, { now: MON + 3600e3, complete: fake([]) });
  ok('scanned once: the next check reads nothing again', r.scanned === 0 && asked.length === 0 && sc.pendingNew(MON + 3600e3).length === 0);

  // ── picked on purpose ──
  virtual.remove(sheet.id);
  r = await sc.scan({ ids: ['old1', 'n1'] }, { complete: fake([
    { ok: true, text: '{"items":[{"title":"Read chapter 2","when":"by Friday"}]}' },  // Oct 9: no other Math work due
    { ok: true, text: '{"items":[{"title":"Finish the cell worksheet","when":"Thursday"},{"title":"Study for the quiz","when":"Friday"}]}' },
  ]) });
  ok('picked ones are read, backlog or already scanned', r.scanned === 2 && asked.length === 2);
  ok('...a deleted reminder comes back only because it was asked for, and one still there isn\'t doubled', r.kept.length === 2 && r.dropped === 1 &&
    virtual.readAll().filter(v => v.title === 'Study for the quiz').length === 1, JSON.stringify(r));

  // ── the same work worded differently ──
  virtual.create({ title: 'Lab goggles', class: 'Made-up Math', due: null });
  write('messages.json', [...JSON.parse(fs.readFileSync(path.join(proj, 'messages.json'), 'utf8')), ann('n5', 'Made-up Math', 'Bring your safety glasses Wednesday, and do the chapter 3 problems.', MON)]);
  sameAs = [['Bring your safety glasses', 'Lab goggles']];
  compared.length = 0;
  r = await sc.scan({ ids: ['n5'] }, { complete: fake([{ ok: true, text: '{"items":[{"title":"Bring your safety glasses","when":"Wednesday"},{"title":"Chapter 3 problems","when":null}]}' }]) });
  ok('a reminder already there in other words isn\'t doubled; the new work is kept', r.dropped === 1 && JSON.stringify(r.kept.map(k => k.title)) === '["Chapter 3 problems"]' &&
    virtual.readAll().filter(v => /goggles|glasses/i.test(v.title)).length === 1, JSON.stringify(r));
  ok('...asked one pair at a time, its own class only', compared.includes('New: Bring your safety glasses\nOn the list: Lab goggles') && !compared.some(q => /cell worksheet|quiz/.test(q)));
  sameAs = [];

  // ── the schedule fills in a missing date ──
  write('messages.json', [...JSON.parse(fs.readFileSync(path.join(proj, 'messages.json'), 'utf8')), ann('n6', 'Made-up Math', 'Bring a protractor.', MON)]);
  r = await sc.scan({ ids: ['n6'] }, { sched: { type: 'daily', classes: [{ class: 'Made-up Math', period: 1, days: 'all' }], flips: [] },
    complete: fake([{ ok: true, text: '{"items":[{"title":"Bring a protractor","when":null}]}' }]) });
  const protractor = virtual.readAll().find(v => v.title === 'Bring a protractor');
  ok('homework with no date is due the night before the next class', r.kept.length === 1 && protractor && new Date(protractor.due).getDate() === 5 && new Date(protractor.due).getHours() === 23, JSON.stringify(r));

  // ── failures ──
  write('messages.json', [...JSON.parse(fs.readFileSync(path.join(proj, 'messages.json'), 'utf8')), ann('n4', 'Made-up Math', 'Bring your textbook Monday.')]);
  r = await sc.scan({ newOnly: true }, { now: MON + 3600e3, complete: fake([{ ok: false, why: 'couldn\'t connect: is its server running?' }]) });
  ok('the model unreachable: recorded as failed, with why', r.ok && r.failed === 1 && /running/.test(r.why) && sc.readState().scanned.n4.error);
  fs.writeFileSync(path.join(proj, 'ai-scan.lock'), String(process.ppid));
  r = await sc.scan({ ids: ['n4'] }, { complete: fake([]) });
  ok('one scan at a time', !r.ok && /already running/.test(r.why));
  fs.unlinkSync(path.join(proj, 'ai-scan.lock'));
  r = await sc.scan({ ids: ['n4'] }, { complete: fake([]), settings: { aiProvider: 'none' } });
  ok('AI off: nothing scanned', !r.ok && /off/.test(r.why));

  // ── the backlog stays the backlog ──
  {
    const DAY = 864e5;
    const many = Array.from({ length: 30 }, (_, i) => ann(`m${i}`, 'Made-up Math', `Read section ${i + 1}.`, MON - i * 3600e3));
    const fresh = T.makeProject({ 'settings.json': { language: 'en', aiProvider: 'ollama', aiModel: 'm' }, 'messages.json': many });
    const scanner = require(path.join(fresh, '38-announcement-scan.js'));
    const here = process.cwd(); process.chdir(fresh);
    let calls = 0;
    const count = async ({ system }) => { if (system !== scanner.SAME_SYSTEM) calls++; return { ok: true, text: '{"items":[]}' }; };
    await scanner.scan({ ids: ['m0'] }, { complete: count });
    ok('a forced scan on an install with no record yet records the rest as known first', calls === 1 && scanner.readState().known.length === 30);
    r = await scanner.scan({ newOnly: true }, { now: MON + 3600e3, complete: count });
    ok('...so the next check reads none of them', r.scanned === 0 && calls === 1 && scanner.pendingNew(MON + 3600e3).length === 0);
    const state = scanner.readState(); state.known = []; state.scanned = {};
    fs.writeFileSync(scanner.STATE_FILE, JSON.stringify(state));
    ok('if "new" is ever wrong: only the last week\'s posts count', scanner.pendingNew(MON + 3600e3).length === 30 && scanner.pendingNew(MON + 8 * DAY).length === 0);
    calls = 0;
    r = await scanner.scan({ newOnly: true }, { now: MON + 3600e3, complete: count });
    ok('...at most ten a run, newest first, the rest left for the next check', r.scanned === 10 && calls === 10 && scanner.readState().scanned.m0 && !scanner.readState().scanned.m10 && scanner.pendingNew(MON + 3600e3).length === 20);
    process.chdir(here);
  }

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
    ok('Settings → AI lists every announcement, newest first, with what its scan found', rows.length === 7 &&
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
