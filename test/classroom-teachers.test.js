// Classroom teachers: read off each class's People page, looked up once a
// week a few classes per pass, kept in classes.json for the page and the API.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const proj = T.makeProject({ 'settings.json': { language: 'en' } }); process.chdir(proj);
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const { JSDOM } = T.jsdom();

const draft = require(path.join(proj, '05-playwright-draft.js'));
const { teacherNamesFromPeoplePage, classesNeedingTeacher, withKnownTeachers, saveClassroomTeachers } = draft;

// ---- the People page, shaped like the real one (Sep 2026) ----
const teacher = (name, email, removable) => `
  <li><div><div><span><img alt=""></span><span class="sCv5Q">${name}</span></div></div>
    <div><div><button aria-label="Options for teacher ${name}"><span></span><span>more_vert</span></button>
      <span>Email</span>${removable ? '<span>Remove</span>' : ''}</div>
      <div><span><a aria-label="Email ${email}"></a></span><div role="tooltip">Email ${email}</div></div></div>
    <ul role="menu"><li role="menuitem"><a href="mailto:${email}">${email}</a></li><li role="menuitem"><span>Email</span></li></ul></li>`;
const people = (teachers) => `<html><body><nav><h2>Sidebar</h2><ul><li>Home</li></ul></nav><main>
  <div role="region"><div><h2>Teachers</h2><div><span><button aria-label="Invite teachers"><span>add</span></button>
    <div role="tooltip">Invite teachers</div></span></div></div>
    <ul>${teachers}</ul></div>
  <div role="region"><div><h2>Classmates</h2><div>29 students</div></div>
    <ul><li><span>Aaron Alexani</span><span>(invited)</span></li><li><span>Some Student</span></li></ul></div>
</main></body></html>`;
const run = html => {
  const w = new JSDOM(html, { runScripts: 'outside-only' }).window;
  return w.eval(`(${teacherNamesFromPeoplePage.toString()})()`);
};

{
  const names = run(people(teacher('Aurora Barboza Flores', 'a@x', false) + teacher('Narine Gabuchian', 'n@x', true)));
  ok('reads every teacher, in order', JSON.stringify(names) === '["Aurora Barboza Flores","Narine Gabuchian"]', JSON.stringify(names));
}
ok('never picks up classmates, buttons, tooltips or the options menu', !JSON.stringify(run(people(teacher('A B', 'a@x')))).match(/Aaron|Invite|Email|more_vert|Remove|@/), JSON.stringify(run(people(teacher('A B', 'a@x')))));
{
  const bare = `<html><body><main><div role="region"><h2>Teachers</h2><ul><li><span>teacher@school.org</span><span>Real Name</span></li></ul></div></main></body></html>`;
  ok('an email is never taken as a name', JSON.stringify(run(bare)) === '["Real Name"]', JSON.stringify(run(bare)));
}
ok('a page without the People layout gives null (so it is retried, not saved as "no teacher")',
  run('<html><body><main><p>Something went wrong</p></main></body></html>') === null);

// ---- which classes get looked up this pass ----
const now = Date.parse('2026-09-24T12:00:00Z');
const day = 864e5;
const list = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B', teacher: 'Ms. B', teacherAt: new Date(now - 2 * day).toISOString() },
  { id: 'c', name: 'C', teacher: 'Mr. C', teacherAt: new Date(now - 8 * day).toISOString() },
  { id: 'd', name: 'D' }, { id: 'e', name: 'E' },
];
const due = classesNeedingTeacher(list, now).map(c => c.id);
ok('never looked up, or over a week ago; at most 3 a pass', due.join('') === 'acd', due.join(''));
ok('a class looked up this week is left alone', !due.includes('b'));

// ---- a fresh class list keeps what's known ----
const merged = withKnownTeachers([{ id: 'b', name: 'B renamed' }, { id: 'z', name: 'New' }], list);
ok('matched by id, so a renamed class keeps its teacher', merged[0].teacher === 'Ms. B' && merged[0].name === 'B renamed', JSON.stringify(merged[0]));
ok('a new class has nothing yet', !('teacher' in merged[1]));

// ---- saving, and the page/API reading it back ----
fs.writeFileSync('classes.json', JSON.stringify([{ id: 'a', name: 'Math' }, { id: 'b', name: 'History', teacher: 'Old', teacherAt: '2026-09-01T00:00:00.000Z' }]));
saveClassroomTeachers(new Map([['a', 'Aurora Barboza Flores, Narine Gabuchian']]), new Date(now));
const saved = JSON.parse(fs.readFileSync('classes.json', 'utf8'));
ok('saved with the time it was looked up', saved[0].teacher === 'Aurora Barboza Flores, Narine Gabuchian' && saved[0].teacherAt === new Date(now).toISOString());
ok('other classes untouched', saved[1].teacher === 'Old' && saved[1].teacherAt === '2026-09-01T00:00:00.000Z');
const { classTeachers } = require(path.join(proj, '08-page.js'));
ok('the page and API pick it up', classTeachers().get('Math') === 'Aurora Barboza Flores, Narine Gabuchian');

process.exit(process.exitCode || 0);
