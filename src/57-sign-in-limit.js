/**
 * Slows down wrong sign-ins (/login and /api/pair) from other devices.
 *
 * The keys themselves can't be guessed, and a pairing code ends after a few
 * wrong tries, so this isn't what keeps anyone out. It's there so that, with
 * the server reachable from the internet, a stranger can't use up a waiting
 * pairing code or keep the server busy answering them.
 *
 * Counted per address, from the tunnel's header when there is one, since
 * everything through a tunnel arrives from the tunnel's own address. Someone can
 * fake that header to dodge the count, but then they're back to guessing keys
 * that can't be guessed. This computer isn't counted.
 */
const { isThisComputer } = require('./53-compress.js');

const WINDOW_MS = 60 * 1000;
const MOST_WRONG = 10;
const MOST_ADDRESSES = 2000;
const wrong = new Map();

function addressOf(req) {
  const headers = req.headers || {};
  return String(headers['cf-connecting-ip'] || (req.socket && req.socket.remoteAddress) || '');
}

/** How many seconds until this client may try again; 0 if it may now. */
function waitSeconds(req, now = Date.now()) {
  if (isThisComputer(req)) return 0;
  const entry = wrong.get(addressOf(req));
  if (!entry || now >= entry.until) return 0;
  return entry.count >= MOST_WRONG ? Math.ceil((entry.until - now) / 1000) : 0;
}

function noteWrong(req, now = Date.now()) {
  if (isThisComputer(req)) return;
  const address = addressOf(req);
  const entry = wrong.get(address);
  if (!entry || now >= entry.until) {
    // Oldest first in a Map, so a flood of addresses can't grow this forever.
    if (wrong.size >= MOST_ADDRESSES) wrong.delete(wrong.keys().next().value);
    wrong.set(address, { count: 1, until: now + WINDOW_MS });
  } else {
    entry.count++;
  }
}

function noteRight(req) {
  wrong.delete(addressOf(req));
}

module.exports = { waitSeconds, noteWrong, noteRight, MOST_WRONG, WINDOW_MS };
