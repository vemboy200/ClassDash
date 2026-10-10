// Grades from Aequitas Q (40-grades.js, Settings → Grades, /api/grades):
// the address, reading the Assignments fragment, where the password goes,
// when a check signs in, the page and the API. Made-up classes, names and
// passwords only, and never the real keychain (CLASSDASH_GRADES_STORE=file).
process.env.CLASSDASH_GRADES_STORE = 'file';
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const { JSDOM, VirtualConsole } = T.jsdom();

// The Assignments fragment the way Q sends it, cut down: one table per class.
const FRAGMENT = `<div id="SP_Assignments"><input id="schedreccount" type="hidden">
<table id="tblAssign_1" class="txtin3 displaytbl tblassign">
  <caption id="capPer_1" class="mediumHighlight"><span>Per</span>: 1 <b>Made-up Biology (1111A1)</b></caption>
  <thead><tr class="tblhdr2 mediumHighlight"><td colspan="8">B+  (88.4%)<b>1st Semester : <span>Current</span> <span>Grade</span></b><a href="javascript:OpenProgress(1);"><img></a></td>
    <td colspan="3"><b>: <span>Teacher</span></b> <a href="mailto:t@example.com">Teacher, Made-up</a></td></tr>
  <tr><th>Detail</th><th>Date Due</th><th>Assigned</th><th>Assignment</th><th>Pts Possible</th><th>Score</th></tr></thead>
  <tbody><tr><td></td><td>10/01/2026</td><td>09/28/2026</td><td>Made-up Lab</td><td>10</td><td>9</td></tr></tbody>
</table>
<table id="tblAssign_3" class="txtin3 displaytbl tblassign">
  <caption id="capPer_3" class="mediumHighlight"><span>Per</span>: 3 <b>Made-up History 9 (2222B)</b></caption>
  <thead><tr class="tblhdr2 mediumHighlight"><td colspan="7"></td><td colspan="3"><b>: <span>Teacher</span></b></td></tr></thead>
  <tbody></tbody>
</table>
<table id="tblAssign_5" class="txtin3 displaytbl tblassign">
  <caption id="capPer_5" class="mediumHighlight"><span>Per</span>: 5 <b>Made-up Math</b></caption>
  <thead><tr class="tblhdr2 mediumHighlight"><td colspan="8">A  (100%)<b>1st Quarter : <span>Current</span> <span>Grade</span></b></td></tr></thead>
</table>
<table id="tblAssign_6" class="txtin3 displaytbl tblassign">
  <caption id="capPer_6" class="mediumHighlight"><span>Per</span>: 6 <b>Made-up Art (3333C)</b></caption>
  <thead><tr class="tblhdr2 mediumHighlight"><td colspan="8">P<b>1st Semester : <span>Current</span> <span>Grade</span></b></td></tr></thead>
</table></div>`;

(async () => {
  const proj = T.makeProject({ 'settings.json': { language: 'en' } });
  process.chdir(proj);
  const grades = require(path.join(proj, '40-grades.js'));
  const settings = require(path.join(proj, '19-settings.js'));

  // ── the address ──
  const pb = raw => grades.portalBase(raw);
  ok('a schemeless address gets https, and the path stays', pb('q.made-up.example/Production/StudentPortal').base === 'https://q.made-up.example/Production/StudentPortal');
  ok('the page someone was on is cut back to the portal', pb('https://q.made-up.example/Production/StudentPortal/Home/PortalMainPage?x=1#top').base === 'https://q.made-up.example/Production/StudentPortal');
  ok('a trailing slash goes', pb('https://q.made-up.example/StudentConnect/').base === 'https://q.made-up.example/StudentConnect');
  ok('just the host is "bare", for the warning', pb('q.made-up.example').bare === true && pb('q.made-up.example/x').bare === false);
  ok('not an address: null', pb('') === null && pb('not an address') === null && pb('ftp://q.made-up.example/x') === null);
  ok('settings refuse a non-address but take empty', !settings.validate('gradesAddress', 'nope').ok && settings.validate('gradesAddress', '').ok);
  ok('only q or none as a provider', settings.validate('gradesProvider', 'q').ok && !settings.validate('gradesProvider', 'powerschool').ok);

  // ── reading the fragment ──
  const doc = new JSDOM(FRAGMENT).window.document;
  const read = grades.parseAssignments(doc);
  ok('one entry per class table', read.length === 4, JSON.stringify(read));
  ok('grade, percent, period, course code and term', JSON.stringify({ ...read[0], assignments: undefined }) === JSON.stringify({ period: '1', class: 'Made-up Biology', code: '1111A1', grade: 'B+', percent: 88.4, term: '1st Semester', progressId: '1' }), JSON.stringify(read[0]));
  ok('...the printer button\'s id, only where there is one (for the progress report)', !('progressId' in read[1]));
  ok('a teacher hiding the grade: no grade, no percent, no term', read[1].class === 'Made-up History 9' && read[1].grade === null && read[1].percent === null && read[1].term === null && read[1].period === '3', JSON.stringify(read[1]));
  ok('no course code and 100%', read[2].class === 'Made-up Math' && read[2].code === null && read[2].percent === 100 && read[2].term === '1st Quarter');
  ok('a mark with no percent', read[3].grade === 'P' && read[3].percent === null);
  ok('the parser stands on its own, for running inside the page', (0, eval)('(' + grades.parseAssignments.toString() + ')')(doc).length === 4);

  // ── where the password goes ──
  const calls = [];
  const fake = (bin, args, opts) => { calls.push({ bin, args, input: opts && opts.input }); return Buffer.from('made-up pass\n'); };
  const kc = grades.keychainStore(fake);
  kc.set('made "up" \\ pass');
  ok('the keychain gets it on stdin, never as an argument', calls[0].bin === '/usr/bin/security' && calls[0].args.join(' ') === '-i' &&
    calls[0].input === 'add-generic-password -U -s "ClassDash Q grades" -a "q-password" -w "made \\"up\\" \\\\ pass"\n', JSON.stringify(calls[0]));
  ok('...and comes back without the newline', kc.get() === 'made-up pass');
  const secret = path.join(proj, 'grades-secret.json');
  grades.fileStore(secret).set('made-up-pass');
  ok('elsewhere it\'s a file only this user can read', (fs.statSync(secret).mode & 0o777) === 0o600 && grades.fileStore(secret).get() === 'made-up-pass');
  ok('a line break is refused', !grades.savePassword('made\nup').ok);
  ok('saving one: saved, and not in settings.json', grades.savePassword('made-up-pass').ok && grades.hasPassword() && !fs.readFileSync(path.join(proj, 'settings.json'), 'utf8').includes('made-up-pass'));

  // ── when a check signs in ──
  const on = { gradesProvider: 'q', gradesAddress: 'q.made-up.example/Production/StudentPortal', gradesUsername: 'made-up-user' };
  const now = Date.parse('2026-10-09T15:00:00Z');
  ok('off: not due', grades.due(now, { s: { gradesProvider: 'none' }, password: 'p', saved: {} }).why === 'off');
  ok('no address / username / password: says which', grades.due(now, { s: { ...on, gradesAddress: '' }, password: 'p', saved: {} }).why === 'address' &&
    grades.due(now, { s: { ...on, gradesUsername: ' ' }, password: 'p', saved: {} }).why === 'username' && grades.due(now, { s: on, password: '', saved: {} }).why === 'password');
  ok('all there and never tried: due', grades.due(now, { s: on, password: 'p', saved: {} }).due);
  ok('tried 59 minutes ago: not yet', grades.due(now, { s: on, password: 'p', saved: { triedAt: new Date(now - 59 * 60000).toISOString() } }).why === 'recent');
  ok('an hour on: due', grades.due(now, { s: on, password: 'p', saved: { triedAt: new Date(now - 60 * 60000).toISOString() } }).due);
  ok('Check now skips the hour', grades.due(now, { force: true, s: on, password: 'p', saved: { triedAt: new Date(now - 60000).toISOString() } }).due);

  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ language: 'en', ...on }));
  const seen = [];
  const good = async args => { seen.push(args); return grades.parseAssignments(doc); };
  let r = await grades.check({ now: new Date(now), reader: good });
  ok('a check reads with the portal base, username and saved password', r.ok && r.classes === 4 && seen[0].base === 'https://q.made-up.example/Production/StudentPortal' && seen[0].username === 'made-up-user' && seen[0].password === 'made-up-pass');
  const file = path.join(proj, 'grades.json');
  ok('...and saves the grades, without the password', JSON.parse(fs.readFileSync(file, 'utf8')).classes.length === 4 && !fs.readFileSync(file, 'utf8').includes('made-up-pass'));
  r = await grades.check({ now: new Date(now + 60000), reader: good });
  ok('a minute later, the next check doesn\'t sign in', r.skipped === 'recent' && seen.length === 1);

  r = await grades.check({ force: true, now: new Date(now + 120000), reader: async () => { throw new Error('Q answered 500 for Assignments'); } });
  const afterFail = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok('a failed check keeps the last grades and says why', !r.ok && afterFail.classes.length === 4 && afterFail.why === 'Q answered 500 for Assignments');

  r = await grades.check({ force: true, now: new Date(now + 180000), reader: async () => { throw new grades.Rejected('Invalid PIN or password'); } });
  ok('Q turning the password down is remembered', !r.ok && !!JSON.parse(fs.readFileSync(file, 'utf8')).rejected);
  r = await grades.check({ force: true, now: new Date(now + 4 * 3600000), reader: good });
  ok('...and not even Check now, hours later, tries it again', r.skipped === 'rejected' && seen.length === 1);
  grades.savePassword('made-up-pass-2');
  r = await grades.check({ force: true, now: new Date(now + 4 * 3600000), reader: good });
  ok('a new password tries again, and clears it', r.ok && seen.length === 2 && !JSON.parse(fs.readFileSync(file, 'utf8')).rejected);

  // ── the page ──
  const windows = [];
  const open = () => {
    T.redraw(proj);
    const w = new JSDOM(fs.readFileSync(path.join(proj, 'summary.html'), 'utf8'), { runScripts: 'dangerously', virtualConsole: new VirtualConsole(), beforeParse(win) { win.setTimeout = () => 0; win.setInterval = () => 0; } }).window;
    windows.push(w);
    return w.document;
  };
  let d = open();
  const section = d.querySelector('[data-section="grades"]');
  ok('Settings has a Grades section, Q picked, its rows shown', !!section && d.querySelector('[data-key="gradesProvider"]').value === 'q' && !section.querySelector('[data-grades-for]').hidden);
  const pw = d.getElementById('grades-password');
  ok('the password field is empty, has no data-key, and says one is saved', pw.value === '' && !pw.hasAttribute('data-key') && /Saved/.test(pw.placeholder));
  ok('the password is nowhere in the page', !fs.readFileSync(path.join(proj, 'summary.html'), 'utf8').includes('made-up-pass'));
  const rows = [...d.querySelectorAll('#grades-section .grade-row')].map(li => li.textContent.replace(/\s+/g, ' ').trim());
  ok('the page lists each class with its grade', rows.length === 4 && rows[0] === '1 Made-up Biology B+ 88.4%' && /Made-up History 9 not shown/.test(rows[1]) && rows[3] === '6 Made-up Art P', JSON.stringify(rows));
  ok('...as of when it was read', /^As of /.test(d.querySelector('#grades-section .hint').textContent));

  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ language: 'en', ...on, gradesAddress: 'q.made-up.example' }));
  d = open();
  ok('just the host: the warning shows', !d.getElementById('grades-bare').hidden);

  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ language: 'en' }));
  d = open();
  ok('grades off: no list on the page, the Q rows hidden', !d.getElementById('grades-section') && d.querySelector('[data-grades-for]').hidden);

  // ── the API ──
  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ language: 'en', ...on }));
  const api = require(path.join(proj, '17-api.js'));
  const view = api.HANDLERS['/api/grades']();
  ok('/api/grades: provider, when, and each class', view.provider === 'q' && view.ok === true && view.classes.length === 4 &&
    JSON.stringify(view.classes[0]) === JSON.stringify({ source: 'q', period: '1', class: 'Made-up Biology', grade: 'B+', percent: 88.4, term: '1st Semester', estimate: null }), JSON.stringify(view));
  ok('...nothing in it that isn\'t a grade', !JSON.stringify(view).includes('made-up-pass') && !('code' in view.classes[0]));

  // ── Q's status dot ──
  {
    const status = require(path.join(proj, '25-check-status.js'));
    fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ language: 'en', ...on }));
    const q = status.checkStatus().q;
    ok('Q has a status like the other platforms, from the last sign-in', q.status === 'ok' && q.detail === '4 classes' && !!q.at, JSON.stringify(q));
    await grades.check({ force: true, now: new Date(now + 5 * 3600000), reader: async () => { throw new Error('made-up timeout'); } });
    ok('...a problem when it failed, with why', status.checkStatus().q.status === 'problem' && status.checkStatus().q.detail === 'made-up timeout');
    d = open();
    ok('...and a fourth dot in the header', d.querySelectorAll('.check-status .status-dot').length === 4 && /Aequitas Q: Problem/.test(d.querySelectorAll('.check-status .status-dot')[3].title), d.querySelectorAll('.check-status .status-dot')[3] && d.querySelectorAll('.check-status .status-dot')[3].title);
    fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ language: 'en' }));
    ok('Q off: unknown, like a platform that\'s off', status.checkStatus().q.status === 'unknown');
    await grades.check({ force: true, now: new Date(now + 6 * 3600000), reader: good });
  }

  // ── hiding the grades ──
  {
    fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ language: 'en', ...on }));
    const posted = [];
    T.redraw(proj);
    const w = new JSDOM(fs.readFileSync(path.join(proj, 'summary.html'), 'utf8'), { runScripts: 'dangerously', virtualConsole: new VirtualConsole(),
      beforeParse(win) { win.setTimeout = () => 0; win.setInterval = () => 0; win.webkit = { messageHandlers: { classdash: { postMessage: m => posted.push(m) } } }; } }).window;
    windows.push(w);
    const sec = w.document.getElementById('grades-section'), btn = sec.querySelector('.grades-toggle');
    ok('grades shown by default, with a Hide button', !sec.classList.contains('grades-hidden') && btn.textContent === 'Hide');
    btn.click();
    const sent = posted.find(m => m.action === 'config');
    ok('Hide masks them at once and saves just that setting', sec.classList.contains('grades-hidden') && btn.textContent === 'Show' &&
      sent && Buffer.from(sent.arg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString() === '{"gradesHidden":true}', JSON.stringify(posted));
    ok('...a setting the settings file takes', settings.validate('gradesHidden', true).ok);
    fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ language: 'en', ...on, gradesHidden: true }));
    d = open();
    ok('saved hidden: the next page starts hidden, class names still there', d.getElementById('grades-section').classList.contains('grades-hidden') &&
      d.querySelector('.grades-toggle').textContent === 'Show' && d.querySelectorAll('#grades-section .grade-class').length === 4);
    ok('...and the API still has them', require(path.join(proj, '40-grades.js')).gradesView().classes[0].grade === 'B+');
  }

  // ── Canvas grades ──
  ok('a Canvas score and letter from the student enrollment', JSON.stringify(grades.canvasGrade({ enrollments: [{ type: 'teacher' }, { type: 'student', computed_current_score: 77.25, computed_current_grade: 'C+' }] })) === '{"grade":"C+","percent":77.25}');
  ok('...a score with no letter, and nothing at all', grades.canvasGrade({ enrollments: [{ type: 'student', computed_current_score: 50 }] }).grade === null && grades.canvasGrade({ enrollments: [{ type: 'student' }] }) === null && grades.canvasGrade({}) === null);
  grades.saveCanvasGrades([
    { name: 'Made-up Canvas Bio', enrollments: [{ type: 'student', computed_current_score: 93, computed_current_grade: 'A' }] },
    { name: 'Made-up Canvas Club Per 7', enrollments: [{ type: 'student' }] },
    { name: 'Made-up Skipped', enrollments: [{ type: 'student', computed_current_score: 10 }] },
    { name: 'Made-up Quiet', enrollments: [{ type: 'student', computed_current_score: 70 }] },
    { name: 'Made-up Never Posted', enrollments: [{ type: 'student', computed_current_score: 80 }] },
  ], new Date(now));
  fs.writeFileSync(path.join(proj, 'class-activity.json'), JSON.stringify({ 'Made-up Quiet': Date.now() - 400 * 864e5 }));
  fs.writeFileSync(path.join(proj, 'school-schedule.json'), JSON.stringify({ type: 'daily', classes: [{ class: 'Made-up Biology Linked', period: 2, days: 'all' }] }));
  const withCanvas = { language: 'en', ...on, canvas: 'https://made-up.instructure.example', canvasToken: 'made-up-token', exclusions: ['Made-up Skipped'],
    skipStaleClasses: true, staleMonths: 3, classLinks: [{ name: 'Made-up Biology Linked', classes: ['Made-up Canvas Bio'] }] };
  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify(withCanvas));
  let both = grades.gradesView();
  const canvasRows = both.classes.filter(c => c.source === 'canvas');
  ok('Canvas grades join Q\'s by linked name, without excluded or stale ones', both.classes.filter(c => c.source === 'q').length === 4 &&
    JSON.stringify(canvasRows.map(c => c.class)) === JSON.stringify(['Made-up Biology Linked', 'Made-up Canvas Club Per 7', 'Made-up Never Posted']), JSON.stringify(canvasRows.map(c => c.class)));
  ok('...a period from Settings → Schedule, else from the name, else none', canvasRows[0].period === '2' && canvasRows[1].period === '7' && canvasRows[2].period === null);
  ok('...sorted by period with Q\'s, no period last', JSON.stringify(both.classes.map(c => c.period)) === JSON.stringify(['1', '2', '3', '5', '6', '7', null]), JSON.stringify(both.classes.map(c => c.period)));
  ok('...and the shape', JSON.stringify(canvasRows[0]) === JSON.stringify({ source: 'canvas', period: '2', class: 'Made-up Biology Linked', sourceClass: 'Made-up Canvas Bio', grade: 'A', percent: 93, term: null, estimate: null }));
  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ ...withCanvas, skipStaleClasses: false }));
  ok('skip inactive classes off: the quiet one is back', grades.gradesView().classes.some(c => c.class === 'Made-up Quiet'));
  fs.writeFileSync(path.join(proj, 'messages.json'), JSON.stringify([{ class: 'Made-up Biology Linked', id: 'made-up-post' }]));
  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ ...withCanvas, hideInactiveClasses: true }));
  ok('hide inactive classes on: only ones that ever had something stay', JSON.stringify(grades.gradesView().classes.filter(c => c.source === 'canvas').map(c => c.class)) === JSON.stringify(['Made-up Biology Linked']));
  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify(withCanvas));
  d = open();
  const tags = [...d.querySelectorAll('#grades-section .grade-source')].map(x => x.textContent);
  ok('the page tags each with where it\'s from when there are both', tags.length === 7 && tags.filter(x => x === 'Canvas').length === 3 && tags[1] === 'Canvas', JSON.stringify(tags));
  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ ...withCanvas, gradesProvider: 'none' }));
  d = open();
  ok('Canvas only: the list is there, without tags or Q\'s setup note', d.querySelectorAll('#grades-section .grade-row').length === 3 && !d.querySelector('#grades-section .grade-source') &&
    /^As of /.test(d.querySelector('#grades-section .hint').textContent));
  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ ...withCanvas, gradesProvider: 'none', canvas: '' }));
  ok('Canvas off: its old grades aren\'t shown', grades.gradesView().classes.length === 0);

  // ── the actions ──
  const notifier = require(path.join(proj, '21-notifier-actions.js'));
  const res = await notifier.main('saveGradesPassword', Buffer.from(JSON.stringify('made-up-pass-3')).toString('base64url'));
  const log = fs.readFileSync(path.join(proj, 'notifier-log.txt'), 'utf8');
  ok('saving the password from the page works', res.ok && grades.fileStore(secret).get() === 'made-up-pass-3');
  ok('...and the log never has it, not even encoded', !log.includes('made-up-pass-3') && !log.includes(Buffer.from(JSON.stringify('made-up-pass-3')).toString('base64url')) && /saveGradesPassword \(payload not logged\)/.test(log));
  fs.writeFileSync(path.join(proj, 'settings.json'), JSON.stringify({ language: 'en', ...on, gradesUsername: '' }));
  const check = await notifier.main('checkGrades', '');
  ok('Check now with something missing says what, in words', !check.ok && check.why === 'Add your username first.', JSON.stringify(check));
  windows.forEach(w => w.close());
})().catch(e => { console.log('FAIL crashed', e.stack); process.exitCode = 1; });
