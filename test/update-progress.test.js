// A download records how far along it is, so the apps can show a progress bar.
const T = require('./helpers');
const path = require('path'), fs = require('fs'), https = require('https');
const { PassThrough } = require('stream');
const EventEmitter = require('events');
const PROJ = T.makeProject(); process.chdir(PROJ);
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const FILE = path.join(PROJ, 'update-status.json');
const put = o => fs.writeFileSync(FILE, JSON.stringify(o, null, 2));
const get = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const U = require(path.join(PROJ, '26-update-check.js'));

// A fake GitHub: one redirect, then the file in four chunks a bit apart,
// with or without a content-length.
function fakeServer({ size, sendLength, failAfter }) {
  https.get = (url, cb) => {
    const req = new EventEmitter();
    setImmediate(() => {
      if (!String(url).includes('s3')) {
        const res = new PassThrough();
        res.statusCode = 302; res.headers = { location: 'https://s3.example/file.exe' };
        cb(res); res.end();
        return;
      }
      const res = new PassThrough();
      res.statusCode = 200;
      res.headers = sendLength ? { 'content-length': String(size) } : {};
      cb(res);
      const chunk = Buffer.alloc(size / 4, 1);
      let sent = 0;
      const next = () => {
        if (failAfter && sent === failAfter) { req.emit('error', new Error('connection reset')); return; }
        if (sent === 4) { res.end(); return; }
        sent++; res.write(chunk); setTimeout(next, 300);
      };
      next();
    });
    return req;
  };
}

(async () => {
  const base = { currentVersion: '1.0.0', latestVersion: '2.0.0', checkedAt: '2026-10-14T00:00:00Z', updateAvailable: true, downloadURL: 'https://github.example/ClassDash-v2.0.0.exe' };

  // ── with a size: fractions along the way, then cleared ──
  put(base);
  fakeServer({ size: 4000, sendLength: true });
  ok(U.downloadUpdate().started === true, 'the download starts');
  ok(get().downloadedBytes === 0 && get().downloading === true, 'starts at 0 bytes, downloading');
  await wait(500);
  let mid = U.readUpdateStatus();
  ok(mid.totalBytes === 4000 && mid.downloadedBytes > 0 && mid.downloadedBytes < 4000, 'part way: bytes so far and the total are on file: ' + mid.downloadedBytes + '/' + mid.totalBytes);
  ok(mid.progress > 0 && mid.progress < 1 && mid.status === 'downloading', 'progress is a fraction between 0 and 1: ' + mid.progress);
  await wait(1200);
  let done = get();
  ok(done.readyToInstall === true && done.readyVersion === '2.0.0' && done.downloading === false, 'finished: ready to install');
  ok(!('downloadedBytes' in done) && !('totalBytes' in done), 'finished: the progress fields are gone');
  ok(U.readUpdateStatus().progress === null, 'finished: progress reads null');
  ok(fs.statSync(done.downloadedPath).size === 4000, 'the whole file was written');

  // ── no size from the server: bytes only, progress null ──
  put(base);
  fakeServer({ size: 4000, sendLength: false });
  U.downloadUpdate();
  await wait(500);
  mid = U.readUpdateStatus();
  ok(mid.downloadedBytes > 0 && !('totalBytes' in mid) && mid.progress === null, 'no content-length: bytes counted, progress null');
  await wait(1200);

  // ── a failed download clears the progress too ──
  put(base);
  fakeServer({ size: 4000, sendLength: true, failAfter: 2 });
  U.downloadUpdate();
  await wait(1000);
  const failed = get();
  ok(failed.downloading === false && failed.error === 'connection reset' && !failed.readyToInstall, 'failed: not downloading, error recorded: ' + JSON.stringify({ d: failed.downloading, e: failed.error, r: failed.readyToInstall }));
  ok(!('downloadedBytes' in failed) && !('totalBytes' in failed), 'failed: the progress fields are gone');

  console.log(`update-progress: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
})();
