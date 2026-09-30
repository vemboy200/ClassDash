// Turned-in Classroom work that reads as not turned in (Sep 30th: it
// showed up as overdue on some passes). The reader waits for the cards'
// text to settle, a batch that flips gets a second read, and whatever
// still flips stays turned in until 3 reads in a row agree.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const proj = T.makeProject({ 'settings.json': { language: 'en' } }); process.chdir(proj);
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };

const draft = require(path.join(proj, '05-playwright-draft.js'));
const { flippedFromTurnedIn, looksMisread, keepTurnedIn, scrapeClassChecked, sortIntoBuckets,
        TURNED_IN_THRESHOLD, TURNED_IN_LOG } = draft;

// Made-up class and assignments.
const cls = { id: 'Y2xhc3M', name: 'Made-up Biology' };
const done = (id, title) => ({ class: cls.name, id, type: 'Completed Assignment', title, due: 'Due Sep 29' });
const open = (id, title) => ({ class: cls.name, id, type: 'Assignment', title, due: 'Due Sep 29' });
const before = [done('1', 'Cell worksheet'), done('2', 'Lab report'), done('3', 'Reading'), open('4', 'Quiz prep')];

// ---- the detector ----
ok('nothing flipped: nothing to do', flippedFromTurnedIn(before, before).length === 0);
ok('a batch flipping is caught', looksMisread([open('1', 'a'), open('2', 'b'), done('3', 'c'), open('4', 'd')], before, cls.name));
ok('one flip out of several is left to the backstop, no re-read',
  !looksMisread([open('1', 'a'), done('2', 'b'), done('3', 'c'), open('4', 'd')], before, cls.name));
{
  const onlyOne = [done('1', 'a'), open('4', 'd')];
  ok('the only turned-in one flipping counts as "all"', looksMisread([open('1', 'a'), open('4', 'd')], onlyOne, cls.name));
}
ok('Canvas/Edpuzzle items are never compared',
  flippedFromTurnedIn([{ ...open('1', 'a'), platform: 'Canvas' }], [{ ...done('1', 'a'), platform: 'Canvas' }]).length === 0);

// ---- the backstop ----
{
  let mem = before;
  const misread = [open('1', 'a'), done('2', 'b'), done('3', 'c'), open('4', 'd')];
  for (let pass = 1; pass < TURNED_IN_THRESHOLD; pass++) {
    const r = keepTurnedIn(misread, mem);
    ok(`pass ${pass}: kept as turned in`, r.held === 1 && /^Completed/.test(r.items[0].type) && r.items[0].turnedInMisses === pass,
      JSON.stringify(r.items[0]));
    mem = r.items;
  }
  const last = keepTurnedIn(misread, mem);
  ok(`${TURNED_IN_THRESHOLD} reads in a row: really not turned in any more (unsubmitted)`,
    last.released === 1 && last.items[0].type === 'Assignment' && !('turnedInMisses' in last.items[0]), JSON.stringify(last.items[0]));

  const one = keepTurnedIn(misread, before).items;
  const back = keepTurnedIn(before, one).items;
  ok('reading "Completed" again resets the count', !('turnedInMisses' in back[0]));
}
{
  const r = keepTurnedIn([open('4', 'd')], before);
  ok('work that was never turned in is untouched', r.held === 0 && r.items[0].type === 'Assignment');
}
{
  const now = new Date('2026-09-30T12:00:00Z');
  const kept = keepTurnedIn([open('1', 'a')], [done('1', 'a')]).items;
  const b = sortIntoBuckets(kept, now);
  ok('a kept one lands in done, not overdue', b.done.length === 1 && b.overdue.length === 0, JSON.stringify({ done: b.done.length, overdue: b.overdue.length }));
}

// ---- the reader, against a fake page ----
// scrapeClass calls page.evaluate(fn) with no argument while waiting for
// the cards to settle, then once with an argument to read them.
function fakePage(settleTexts, reads) {
  const calls = { settle: 0, reads: 0 };
  let i = 0;
  const page = {
    calls,
    goto: async () => { i = 0; },
    url: () => 'https://classroom.google.com/u/0/w/x/t/all',
    waitForSelector: async () => {},
    waitForTimeout: async () => {},
    evaluate: async (fn, arg) => {
      if (arg === undefined) {
        // Run the real settle check against a stand-in document: one
        // card whose text is settleTexts[i] on the i-th look.
        calls.settle++;
        const text = settleTexts[Math.min(i++, settleTexts.length - 1)];
        global.document = { querySelectorAll: () => [{ innerText: text }] };
        return fn();
      }
      return reads[calls.reads++];
    },
  };
  return page;
}

(async () => {
  {
    // The count stays the same while "Completed" fills in: the old
    // count-only wait stopped after 4 looks, too early.
    const page = fakePage(['Assignment', 'Assignment', 'Completed Assignment', 'Completed Assignment', 'Completed Assignment', 'Completed Assignment'],
                          [[done('1', 'a')]]);
    await scrapeClassChecked(page, cls, 1000, []);
    ok('waits until the cards\' text stops changing, not just their number', page.calls.settle === 6, `looked ${page.calls.settle} times`);
  }
  try { fs.unlinkSync(TURNED_IN_LOG); } catch {}
  {
    const page = fakePage(['x'], [[open('1', 'a'), open('2', 'b'), open('3', 'c'), open('4', 'd')], before]);
    const items = await scrapeClassChecked(page, cls, 1000, before);
    ok('a flipped batch is read again, and the better read is used', page.calls.reads === 2 && items.every((x, n) => x.type === before[n].type && !('turnedInMisses' in x)),
      JSON.stringify(items.map(x => x.type)));
    const log = fs.readFileSync(TURNED_IN_LOG, 'utf8');
    ok('the re-read is logged with counts', /3 turned-in read as not turned in, re-read says 0 \(using the re-read\)/.test(log), log);
    ok('the log never has assignment titles', !/Cell worksheet|Lab report|Reading/.test(log));
  }
  {
    const page = fakePage(['x'], [[open('1', 'a'), open('2', 'b'), open('3', 'c'), open('4', 'd')],
                                  [open('1', 'a'), open('2', 'b'), open('3', 'c'), open('4', 'd')]]);
    const items = await scrapeClassChecked(page, cls, 1000, before);
    ok('when the re-read agrees, the backstop still keeps them turned in',
      items.slice(0, 3).every(x => /^Completed/.test(x.type) && x.turnedInMisses === 1), JSON.stringify(items.map(x => x.type)));
    ok('and that is logged', /kept 3 as turned in/.test(fs.readFileSync(TURNED_IN_LOG, 'utf8')));
  }
  {
    const page = fakePage(['x'], [before]);
    await scrapeClassChecked(page, cls, 1000, before);
    ok('a normal read is read once', page.calls.reads === 1);
  }
})();
