// The page written while a check runs keeps a failed source's assignments (assignmentsForProgress).
const T = require('./helpers');
const path = require('path');
const proj = T.makeProject({ 'settings.json': { language: 'en' } }); process.chdir(proj);
const ok = (n, c, x='') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const { assignmentsForProgress } = require(path.join(proj, '05-playwright-draft.js'));

const memory = [
  { id: 'c1', class: 'Math',        title: 'Worksheet' },                                   // Classroom
  { id: 'c2', class: 'Science',     title: 'Lab report' },
  { id: 'n1', class: 'English 9',   platform: 'Canvas', title: 'Essay' },                   // Canvas: class is the course
  { id: 'n2', class: 'App Comptr',  platform: 'Canvas', title: 'Chapter 5 Discussion' },
];
const ids = list => list.map(x => x.id).sort().join();
const copy = JSON.stringify(memory);

// nothing has reported in yet: the page is memory
ok('nothing read yet -> all of memory', ids(assignmentsForProgress(memory, [], [], [])) === 'c1,c2,n1,n2');

// Canvas read fine and returned one assignment: memory's Canvas rows are replaced, not doubled
{
  const fresh = [{ id: 'n1', class: 'English 9', platform: 'Canvas', title: 'Essay' }];
  const out = assignmentsForProgress(memory, fresh, ['Canvas'], []);
  ok('a source that read fine replaces its memory (Canvas gave n1 only)', ids(out) === 'c1,c2,n1', ids(out));
  ok('...and nothing is listed twice', new Set(out.map(x => x.id)).size === out.length);
}

// THE BUG: Canvas reported in but failed -> its assignments must stay
{
  const out = assignmentsForProgress(memory, [], ['Canvas'], ['Canvas']);
  ok('Canvas failed -> its assignments stay on the page', ids(out) === 'c1,c2,n1,n2', ids(out));
}
{
  const out = assignmentsForProgress(memory, [], ['Math'], ['Math']);
  ok('a Classroom class failed -> its assignments stay', ids(out) === 'c1,c2,n1,n2', ids(out));
}

// a mix: Math read fine (and is now empty), Canvas failed, Science not reported yet
{
  const out = assignmentsForProgress(memory, [], ['Math', 'Canvas'], ['Canvas']);
  ok('a class that read fine and came back empty is really empty', !out.some(x => x.id === 'c1'), ids(out));
  ok('...while the failed source and the unread class keep theirs', ids(out) === 'c2,n1,n2', ids(out));
}

ok('memory is not modified', JSON.stringify(memory) === copy);
ok('everything empty -> empty, no crash', assignmentsForProgress([], [], [], []).length === 0);

// ---- the page itself: "Nothing due and nothing new. You can relax." is only said about a finished read ----
{
  const fs = require('fs');
  const { writePage } = require(path.join(proj, '08-page.js'));
  const page = path.join(proj, 'empty-test.html');
  const write = extra => { writePage({ burning: [], later: [], undated: [], deferred: [], overdue: [], gone: [], items: [],
    freshIds: new Set(), broken: [], now: new Date(2026, 8, 21, 10, 0, 0), ...extra }, page); return fs.readFileSync(page, 'utf8'); };
  ok('a finished read with nothing due says so', /<div class="empty">Nothing due and nothing new/.test(write({})));
  ok('a page written mid-check does not (nothing due YET is not nothing due)',
    !/<div class="empty">/.test(write({ reading: ['Canvas'], progress: { done: 3, total: 8 } })));
  ok('...but still says it is still reading', /Still reading/.test(write({ reading: ['Canvas'], progress: { done: 3, total: 8 } })));
}
