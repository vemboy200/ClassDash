// The teacher a platform reports shows on the page's cards and in the API.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const proj = T.makeProject({ 'settings.json': { language: 'en' } }); process.chdir(proj);
const ok = (n, c, x='') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const now = new Date(2026, 8, 21, 10, 0, 0);
const due = new Date(2026, 8, 24, 10, 0, 0), late = new Date(2026, 8, 19, 10, 0, 0);
fs.writeFileSync('canvas-classes.json', JSON.stringify([{ name: 'English 9', teacher: 'Ms. Kirakosyan' }, { name: 'Shop' }]));
fs.writeFileSync('classes.json', JSON.stringify([{ id: 'x', name: 'Math' }]));

const { writePage, classTeachers } = require(path.join(proj, '08-page.js'));
const { toPublic, HANDLERS } = require(path.join(proj, '17-api.js'));

const item = (id, cls, extra = {}) => ({ id, class: cls, title: 'T ' + id, platform: 'Canvas', type: 'Assignment', link: 'x', ...extra });
const burning = [{ ...item('a', 'English 9'), due_at: due }, { ...item('b', 'Shop'), due_at: due }, { ...item('c', 'Math', { platform: undefined }), due_at: due }];
const overdue = [{ ...item('o', 'English 9'), due_at: late, due: 'Due Sep 19' }];

ok('classTeachers: only classes that have one', [...classTeachers()].join('|') === 'English 9,Ms. Kirakosyan');

writePage({ burning, later: [], undated: [], deferred: [], overdue, gone: [], items: [...burning, ...overdue], freshIds: new Set(), broken: [], now }, 'p.html');
const html = fs.readFileSync('p.html', 'utf8');
const meta = id => { const i = html.indexOf(`<div class="title">T ${id}</div>`); return html.slice(i, html.indexOf('</div>', html.indexOf('class="meta"', i))); };
ok('a due card shows the teacher', /<span class="teacher"[^>]*>Ms\. Kirakosyan<\/span>/.test(meta('a')), meta('a'));
ok('...labelled, for a tooltip', /title="Teacher"/.test(meta('a')));
ok('an overdue card shows it too', /<span class="teacher"[^>]*>Ms\. Kirakosyan<\/span>/.test(meta('o')), meta('o'));
ok('a class with no teacher shows no teacher line', !/class="teacher"/.test(meta('b')) && !/class="teacher"/.test(meta('c')));

const pub = toPublic({ ...burning[0] }, now);
ok('API item carries the teacher', pub.teacher === 'Ms. Kirakosyan', JSON.stringify(pub));
ok('API item for a class without one: null', toPublic({ ...burning[1] }, now).teacher === null);

const roster = HANDLERS['/api/classes']({ burning, later: [], overdue: [], items: [], announcements: [], now });
ok('API roster carries it per class', roster.find(c => c.name === 'English 9').teacher === 'Ms. Kirakosyan' && roster.find(c => c.name === 'Shop').teacher === null, JSON.stringify(roster));

// script still runs (a syntax slip in the page would take every card with it)
{ const { JSDOM, VirtualConsole } = T.jsdom(); const errs = []; const vc = new VirtualConsole(); vc.on('jsdomError', e => { if (!/navigation/.test(e.message)) errs.push(e.message); });
  const d = new JSDOM(html, { runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true, beforeParse(w) { w.Element.prototype.scrollIntoView = function () {}; } });
  setTimeout(() => { ok('the page script runs clean', errs.length === 0, errs.join('|')); d.window.close(); process.exit(process.exitCode || 0); }, 300); }
