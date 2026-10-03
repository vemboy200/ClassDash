// Each /api/classes entry says which platform its class is on, with the same
// strings assignments carry: for every class, empty and announcement-only
// ones too, and a list for a link across platforms.
const T = require('./helpers');
const path = require('path');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };

const soon = n => new Date(Date.now() + n * 864e5).toISOString();
const proj = T.makeProject({
  'settings.json': {
    language: 'en', email: 'a@b', canvas: '', showEmptyClasses: true, edpuzzleEnabled: true,
    classLinks: [{ name: 'Made-up History', classes: ['History CR', 'History Canvas'] }, { name: 'Two Canvas', classes: ['Canvas A', 'Canvas B'] }],
  },
  'classes.json': [{ id: 'h', name: 'History CR' }, { id: 'e', name: 'Empty Classroom' }, { id: 'n', name: 'News Only' }, { id: 's', name: 'Shared Name' }],
  'canvas-classes.json': [{ name: 'History Canvas' }, { name: 'Canvas Only' }, { name: 'Canvas A' }, { name: 'Canvas B' }, { name: 'Shared Name' }],
  'edpuzzle-classes.json': [{ name: 'Video Class' }],
  'last-collection.json': [
    { class: 'Canvas Only', id: 'c1', type: 'Assignment', title: 'Essay', due: null, due_iso: soon(2), link: 'x', platform: 'Canvas' },
    { class: 'Left Classroom', id: 'o1', type: 'Assignment', title: 'Old one', due: null, due_iso: soon(3), link: 'x' },
    { class: 'Left Canvas', id: 'o2', type: 'Assignment', title: 'Old two', due: null, due_iso: soon(3), link: 'x', platform: 'Canvas' },
  ],
  'messages.json': [{ id: 'p1', class: 'News Only', text: 'Quiz Friday', date: 'Sep 24', sortTime: Date.now(), link: 'x', platform: 'Classroom' }],
});
process.chdir(proj);
const api = require(path.join(proj, '17-api.js'));
const roster = () => api.HANDLERS['/api/classes'](api.gather());
const platformOf = name => { const c = roster().find(x => x.name === name); return c ? c.platform : 'missing'; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

ok('a Classroom class with nothing due: "Google Classroom"', platformOf('Empty Classroom') === 'Google Classroom', platformOf('Empty Classroom'));
ok('an announcement-only class', platformOf('News Only') === 'Google Classroom', platformOf('News Only'));
ok('a Canvas class with work', platformOf('Canvas Only') === 'Canvas', platformOf('Canvas Only'));
ok('an Edpuzzle class', platformOf('Video Class') === 'Edpuzzle', platformOf('Video Class'));
ok('a class no list has any more, from its items (Classroom by default)', platformOf('Left Classroom') === 'Google Classroom', platformOf('Left Classroom'));
ok('...or the platform its items say', platformOf('Left Canvas') === 'Canvas', platformOf('Left Canvas'));
ok('a link across platforms: a list', same(platformOf('Made-up History'), ['Google Classroom', 'Canvas']), JSON.stringify(platformOf('Made-up History')));
ok('a link within one platform: that platform', platformOf('Two Canvas') === 'Canvas', JSON.stringify(platformOf('Two Canvas')));
ok('one name on two platforms: both', same(platformOf('Shared Name'), ['Google Classroom', 'Canvas']), JSON.stringify(platformOf('Shared Name')));
ok('every entry has the field', roster().every(c => 'platform' in c));
ok('the strings match the ones on assignments', api.HANDLERS['/api/due-soon'](api.gather()).find(x => x.title === 'Essay').platform === platformOf('Canvas Only'));

// Edpuzzle switched off: its classes aren't in the roster at all, and a
// leftover Edpuzzle item doesn't bring one back with a platform.
const fs = require('fs');
const s = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
fs.writeFileSync('settings.json', JSON.stringify({ ...s, edpuzzleEnabled: false }));
ok('Edpuzzle off: no Edpuzzle class', platformOf('Video Class') === 'missing', JSON.stringify(platformOf('Video Class')));
