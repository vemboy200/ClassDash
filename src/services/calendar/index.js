/**
 * The school calendar's feed (ICS), as the services bridge (61-services.js)
 * sees it. The only file of it the check and Settings → Calendar call.
 *
 *   bridge.saved   what ClassDash kept from the last read: { url, fetchedAt,
 *                  failedAt } (see savedFor in 61-services.js)
 *
 * The events it reads are saved by ClassDash, into the school calendar
 * (33-school-calendar.js), where the page's calendar draws them from. Reading
 * and parsing the feed is in 34-calendar-ics.js.
 */

// Once a day, give or take: a little under a day, so a check at the same hour
// tomorrow still counts.
const EVERY_MS = 20 * 3600e3;

const enabled = bridge => !!(bridge.saved && bridge.saved.url);

/** Whether this check should read it: a link is saved, and its last try,
 *  worked or not, was long enough ago. */
function due(bridge, now = new Date()) {
  if (!enabled(bridge)) return false;
  const { fetchedAt, failedAt } = bridge.saved;
  const last = Date.parse(failedAt && (!fetchedAt || failedAt > fetchedAt) ? failedAt : fetchedAt || 0);
  return !last || now - last > EVERY_MS;
}

/** Where it is (webcal:// turned into https://). */
function addresses(bridge) {
  return enabled(bridge) ? [require('./34-calendar-ics.js').feedUrl(bridge.saved.url)] : [];
}

/** Reads the feed, in the shape every service's read() has. Throws why it
 *  couldn't, in words that go straight into Settings → Calendar. */
async function read(bridge) {
  const r = await require('./34-calendar-ics.js').fetchIcs(bridge.saved.url);
  if (!r.ok) throw new Error(r.why);
  return { events: r.events, status: { ok: true, detail: `${r.events.length} events` } };
}

module.exports = { enabled, due, addresses, read, EVERY_MS };
