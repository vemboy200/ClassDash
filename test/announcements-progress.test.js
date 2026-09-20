// Announcements stay on the page while a check runs (announcementsForProgress).
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const proj = T.makeProject({ 'settings.json': { language: 'en', exclusions: ['Excluded Class'] } }); process.chdir(proj);
const ok = (n, c, x='') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };
const { announcementsForProgress } = require(path.join(proj, '05-playwright-draft.js'));
const { writePage } = require(path.join(proj, '08-page.js'));
const now = new Date(2026, 8, 19, 10, 0, 0);

const memory = [
  { id: 'a', class: 'Math',           text: 'old text',  date: 'Sep 1',  sortTime: new Date(2026, 8, 1).getTime() },
  { id: 'b', class: 'Excluded Class', text: 'zzz-excluded-marker',      date: 'Sep 5',  sortTime: new Date(2026, 8, 5).getTime() },
  { id: 'c', class: 'History',        text: 'kept',      date: 'Sep 10', sortTime: new Date(2026, 8, 10).getTime() },
];
const memoryCopy = JSON.stringify(memory);
const fresh = [
  { id: 'a', class: 'Math',    text: 'NEW text', date: 'Sep 1' },          // same id: the fresh copy wins; no sortTime yet
  { id: 'd', class: 'Science', text: 'brand new', date: 'Sep 18' },        // new post, no sortTime yet
];
const out = announcementsForProgress(memory, fresh, now);

ok('memory posts for classes not yet read are kept', out.some(p => p.id === 'c'));
ok('a post from an excluded class is dropped', !out.some(p => p.id === 'b'));
ok('a freshly read post overrides the remembered copy of the same id', out.find(p => p.id === 'a').text === 'NEW text');
ok('no duplicates', new Set(out.map(p => p.id)).size === out.length, out.map(p => p.id).join());
ok('every post has a real sortTime (no NaN)', out.every(p => Number.isFinite(p.sortTime)), JSON.stringify(out.map(p => p.sortTime)));
ok('newest first: d (Sep 18), c (Sep 10), a (Sep 1)', out.map(p => p.id).join() === 'd,c,a', out.map(p => p.id).join());
ok('the remembered list itself is not modified', JSON.stringify(memory) === memoryCopy);
ok('an existing sortTime is never recomputed', out.find(p => p.id === 'c').sortTime === new Date(2026, 8, 10).getTime());
ok('empty memory + nothing read yet -> empty (not a crash)', announcementsForProgress([], [], now).length === 0);
ok('memory only (nothing read yet) -> all of it, minus excluded', announcementsForProgress(memory, [], now).map(p => p.id).join() === 'c,a');
ok('a January post read in September is not sorted into next January', (() => {
  const r = announcementsForProgress([], [{ id: 'j', class: 'X', text: 't', date: 'Jan 13' }], new Date(2026, 8, 19));
  return r[0].sortTime < new Date(2026, 8, 19).getTime(); })());

// end to end through the page: an in-progress write now has the announcements column
const page = path.join(proj, 'progress-test.html');
writePage({ burning: [], later: [], undated: [], deferred: [], overdue: [], gone: [], items: [], freshIds: new Set(), broken: [],
  reading: ['Science'], progress: { done: 5, total: 8 }, now, announcements: out }, page);
const html = fs.readFileSync(page, 'utf8');
ok('page shows the announcements column instead of "Nothing yet"', !html.includes('Nothing yet') && /announcements-count">3</.test(html));
ok('...with each post as a card', ['NEW text', 'brand new', 'kept'].every(t => html.includes(t)));
ok('...the excluded class\'s post is not there', !html.includes('zzz-excluded-marker'));
const bare = path.join(proj, 'progress-test2.html');
writePage({ burning: [], later: [], undated: [], deferred: [], overdue: [], gone: [], items: [], freshIds: new Set(), broken: [], reading: ['Science'], progress: { done: 5, total: 8 }, now }, bare);
ok('(control) without announcements the old empty state still renders', fs.readFileSync(bare, 'utf8').includes('Nothing yet'));
fs.unlinkSync(page); fs.unlinkSync(bare);
process.exit(process.exitCode || 0);
