/**
 * Home API: serves what's been collected over the local network, like an
 * ordinary web API.
 *
 * ── Why ──
 *
 * Right now the data lives in two places: JSON files and the
 * `summary.html` page. Only the script itself and a person's own eyes can
 * read them. The API opens them up for ANYTHING: a phone, a watch, a
 * second computer, someone else's program, a smart home setup.
 *
 * No collecting happens here. The server only reads files the main script
 * already collected, and sorts them with the same `sortIntoBuckets()`
 * function the summary page uses. The logic is deliberately not
 * duplicated: it would drift apart on the first edit, and "due soon" is
 * the single most important word in the whole thing.
 *
 * ── Running it ──
 *
 *   node 17-api.js               this computer only (127.0.0.1:8734)
 *   node 17-api.js --network     visible to the whole home network
 *   node 17-api.js --port 9000   a different port
 *
 * ── READ THIS BEFORE USING "--network" ──
 *
 * By default the server listens on 127.0.0.1 — meaning "only me". No one
 * on the network can reach it, not even from the computer next door.
 *
 * The --network flag lifts that restriction, and then homework, teacher
 * announcements, and email-bearing links become visible to ANY device on
 * the network — including a school wifi, if the laptop ever ends up
 * there. There's no password here.
 *
 * That's why localhost is the default and not the other way around:
 * opening it wider should be a deliberate choice, and accidentally
 * broadcasting your own schedule to the whole class shouldn't happen on
 * its own.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  sortIntoBuckets, readMutedIds, readHiddenIds,
} = require('./05-playwright-draft.js');
const { t, currentLanguage } = require('./18-language.js');
// The calendar-day counter lives in 08-page: no circular dependency,
// 17 already pulls in 05, and 05 pulls in 08.
const { daysUntil } = require('./08-page.js');

const STATE_FILE = path.join(__dirname, 'last-collection.json');
const STREAM_FILE = path.join(__dirname, 'messages.json');
const CLASSES_FILE = path.join(__dirname, 'classes.json');

const DEFAULT_PORT = require('./19-settings.js').read().apiPort;

/** Reads a json file. Missing or broken — an empty list, not a crash. */
function readJson(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

/**
 * Prepares the response: the same buckets as on the summary page.
 *
 * Files are read on EVERY request, not once at startup. Collection runs
 * every ten minutes and rewrites them; a server that cached data at
 * startup would keep serving yesterday's and never admit it.
 */
function gather() {
  const items = readJson(STATE_FILE);
  const announcements = readJson(STREAM_FILE);
  const now = new Date();

  const { burning, later, undated, deferred, overdue, gone } =
    sortIntoBuckets(items, now, readMutedIds(), readHiddenIds());

  // The last-collection timestamp comes from the file's own mtime, not
  // this process's clock: if the script has been silent for three days,
  // that needs to be visible from outside.
  const collectedAt = fs.existsSync(STATE_FILE)
    ? fs.statSync(STATE_FILE).mtime
    : null;

  return { items, announcements, burning, later, undated, deferred,
           overdue, gone, now, collectedAt };
}

/** An assignment, outward-facing: no internal fields, plus days-until-due. */
function toPublic(x, now) {
  return {
    id: x.id,
    title: x.title,
    class: x.class,
    platform: x.platform || 'Google Classroom',
    type: x.type || null,
    link: x.link || null,
    due: x.due_at ? x.due_at.toISOString() : null,
    daysUntilDue: x.due_at ? daysUntil(now, x.due_at) : null,
    // note is stored as a key ("noDueDateNote"), given out as text.
    note: x.note ? t(x.note) : null,
  };
}

const HANDLERS = {
  '/api/status': (d) => ({
    collectedAt: d.collectedAt ? d.collectedAt.toISOString() : null,
    minutesAgo: d.collectedAt ? Math.round((d.now - d.collectedAt) / 60000) : null,
    classes: readJson(CLASSES_FILE).length,
    total: d.items.length,
    dueSoon: d.burning.length,
    overdue: d.overdue.filter(x => !x.hidden).length,
    ahead: d.later.length,
    announcements: d.announcements.length,
    removed: d.gone.length,
    language: currentLanguage(),
  }),

  '/api/due-soon': (d) => d.burning.map(x => toPublic(x, d.now)),
  '/api/ahead': (d) => d.later.map(x => toPublic(x, d.now)),
  '/api/overdue': (d) =>
    d.overdue.filter(x => !x.hidden).map(x => toPublic(x, d.now)),

  '/api/assignments': (d) => [...d.burning, ...d.later, ...d.overdue]
    .map(x => toPublic(x, d.now)),

  '/api/announcements': (d) => d.announcements.map(p => ({
    id: p.id,
    class: p.class,
    author: p.author || null,
    date: p.date || null,
    title: p.title || null,
    text: p.text || null,
    link: p.link || null,
  })),

  // Removed by the teacher — its own handle, not part of the general
  // list: these aren't about what needs doing, they're about what happened.
  '/api/removed': (d) => d.gone.map(x => ({
    ...toPublic(x, d.now),
    removedAt: x.removedAt || null,
  })),

  '/api/classes': () => readJson(CLASSES_FILE),
};

/** Root: a list of handles, so no one has to dig through the source for addresses. */
function index() {
  return {
    what: 'School digest home API',
    handles: Object.keys(HANDLERS),
    note: 'Read-only. Collection runs separately, every 10 minutes.',
  };
}

function start() {
  const args = process.argv;
  const onNetwork = args.includes('--network');
  const portIndex = args.indexOf('--port');
  const port = portIndex !== -1 && args[portIndex + 1]
    ? Number(args[portIndex + 1]) : DEFAULT_PORT;
  const host = onNetwork ? '0.0.0.0' : '127.0.0.1';

  const server = http.createServer((req, res) => {
    // Strip "?whatever": an address with a query string should still work.
    //
    // And DECODE IT. Handles are named in Latin now, but this used to
    // matter a lot back when they were Russian: over the network the
    // address arrives percent-encoded. Without decodeURIComponent no
    // handle would ever match — confirmed on a live server right after
    // writing this. The same trap that bit the id in the old
    // "not-urgent.txt" file.
    const raw = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
    let urlPath = raw;
    try { urlPath = decodeURIComponent(raw); } catch { /* broken encoding — look up as-is */ }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Allow reading this from pages in a browser: without it, a page of
    // your own on your phone would run into the cross-origin block.
    res.setHeader('Access-Control-Allow-Origin', '*');

    const respond = (status, body) =>
      res.writeHead(status).end(JSON.stringify(body, null, 2));

    if (urlPath === '/') return respond(200, index());

    const handler = HANDLERS[urlPath];
    if (!handler) {
      return respond(404, { error: 'no such handle', handles: Object.keys(HANDLERS) });
    }

    try {
      respond(200, handler(gather()));
    } catch (e) {
      // One handle crashing shouldn't take the server down: it runs for
      // hours at a time, and an error might come from a broken file that
      // the next collection will overwrite anyway.
      console.error(`error on ${urlPath}: ${e.message}`);
      respond(500, { error: e.message });
    }
  });

  // A port already in use is usually a forgotten previous run. Print one
  // clear line instead of a twenty-line stack: whoever sees it should
  // know exactly what to do.
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`Port ${port} is in use — probably already running.`);
      console.error(`See who: lsof -i :${port}`);
      console.error(`Kill the old one: pkill -f 17-api.js`);
      console.error(`Or pick another port: node 17-api.js --port ${port + 1}`);
      process.exit(1);
    }
    throw e;
  });

  server.listen(port, host, () => {
    console.log(`Home API listening on http://${host}:${port}`);
    if (onNetwork) {
      const addresses = Object.values(os.networkInterfaces()).flat()
        .filter(iface => iface && iface.family === 'IPv4' && !iface.internal)
        .map(iface => iface.address);
      console.log(`VISIBLE TO THE WHOLE NETWORK. Addresses: ${addresses.join(', ') || 'none found'}`);
      console.log('No password — do not enable this on a network you do not trust (e.g. a school one).');
    } else {
      console.log('This computer only. For the home network: --network');
    }
    console.log(`Handles: ${Object.keys(HANDLERS).join(' ')}`);
  });
}

module.exports = { HANDLERS, gather, toPublic };
if (require.main === module) start();
