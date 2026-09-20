// Which settings still need a fresh check to take effect (19-settings.js).
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const PROJ = T.makeProject({ 'settings.json': { email: 'me@school.example', canvas: 'https://school.instructure.com', language: 'en', exclusions: [] } });
process.chdir(PROJ);
const S = require(path.join(PROJ, '19-settings.js'));
const applied = path.join(PROJ, 'fetch-applied.json');
try { fs.unlinkSync(applied); } catch {}
const enc = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_');
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(got) + ' != ' + JSON.stringify(want)); if (!ok) process.exitCode = 1; };

eq('no snapshot -> nothing pending (existing install)', S.pendingFetchKeys(), []);
eq('no snapshot -> applied falls back to current', S.appliedFetchSettings().exclusions, []);

// first change seeds the baseline from BEFORE the change
S.applyBatch(enc({ exclusions: ['Math'], language: 'en' }));
eq('snapshot seeded from pre-change file', JSON.parse(fs.readFileSync(applied,'utf8')).exclusions, []);
eq('exclusion added -> pending', S.pendingFetchKeys(), ['exclusions']);
eq('applied still shows the OLD exclusions', S.appliedFetchSettings().exclusions, []);

// put it back -> notice goes away by itself
S.applyBatch(enc({ exclusions: [] }));
eq('reverted -> not pending', S.pendingFetchKeys(), []);

// order and whitespace don't count as changes
S.applyBatch(enc({ exclusions: ['B','A'] }));
S.markApplied({ exclusions: ['A','B'], canvas: S.read().canvas });
eq('same set, different order -> not pending', S.pendingFetchKeys(), []);
S.applyBatch(enc({ canvas: '  https://school.instructure.com ' }));
eq('canvas differing only by whitespace -> not pending', S.pendingFetchKeys(), []);

// canvas change
S.applyBatch(enc({ canvas: 'https://other.instructure.com' }));
eq('canvas changed -> pending', S.pendingFetchKeys(), ['canvas']);
S.applyBatch(enc({ exclusions: ['A'] }));
eq('both changed -> both pending', S.pendingFetchKeys(), ['exclusions', 'canvas']);

// a collection records what it read (its start-of-run values), clears it
S.markApplied({ exclusions: ['A'], canvas: 'https://other.instructure.com' });
eq('after a collection recorded them -> not pending', S.pendingFetchKeys(), []);
// setting changed mid-run stays pending: the run recorded its OWN values
S.applyBatch(enc({ exclusions: ['A','C'] }));
eq('changed after the run started -> still pending', S.pendingFetchKeys(), ['exclusions']);

// non-fetch settings never make anything pending
S.markApplied({ exclusions: ['A','C'], canvas: 'https://other.instructure.com' });
S.applyBatch(enc({ language: 'ru', treatUndatedAsUrgent: false, showEmptyClasses: true }));
eq('display-only settings -> not pending', S.pendingFetchKeys(), []);
S.applyBatch(enc({ language: 'en', treatUndatedAsUrgent: true, showEmptyClasses: false }));
