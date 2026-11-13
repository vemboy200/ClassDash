// Reads a school calendar feed (ICS, also called iCal or webcal): every
// event's dates and title. No dependency: the format is plain text, one
// "NAME;PARAMS:value" per line, events between BEGIN:VEVENT and END:VEVENT.
//
// What each kind of event means (no school, minimum day, just an event, or
// hidden) is chosen per event title in Settings → Calendar; see
// 33-school-calendar.js for that and for what's saved.
const MAX_BYTES = 5 * 1024 * 1024;
const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Lines with folding undone: a line starting with a space or tab continues the one before. */
function unfold(text) {
  return String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(value) {
  return value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').replace(/\s+/g, ' ').trim();
}

/**
 * A DTSTART/DTEND value as a local calendar day (YYYY-MM-DD) and whether it
 * had a time. "20261009" is a day; "20261009T080000Z" is UTC, so it's
 * turned into this computer's day; "20261009T080000" (local, or with a
 * TZID) is taken as written.
 */
function parseDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { day: `${y}-${mo}-${d}`, timed: false };
  if (z) return { day: dayKey(new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)))), timed: true };
  return { day: `${y}-${mo}-${d}`, timed: true };
}

const addDays = (key, n) => {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n));
};

/**
 * parseIcs(text) → [{ start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' (the last day,
 * inclusive), summary }], sorted by start. An all-day event's DTEND is the
 * day after it ends, so it's moved back one; a timed event ends on its own
 * day. Cancelled events are left out. Repeating events (RRULE) are taken at
 * their first date only: school calendars list days one by one.
 */
function parseIcs(text) {
  const events = [];
  let current = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT') {
      if (current && current.start && current.status !== 'CANCELLED') {
        let end = current.start.day;
        if (current.end) {
          end = current.end.timed ? current.end.day : addDays(current.end.day, -1);
          if (end < current.start.day) end = current.start.day;
        }
        events.push({ start: current.start.day, end, summary: current.summary || '' });
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(';')[0].toUpperCase();
    const value = line.slice(colon + 1);
    if (name === 'DTSTART') current.start = parseDate(value);
    else if (name === 'DTEND') current.end = parseDate(value);
    else if (name === 'SUMMARY') current.summary = unescapeText(value);
    else if (name === 'STATUS') current.status = value.trim().toUpperCase();
  }
  return events.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/** webcal:// is just https:// for calendar apps. */
function feedUrl(url) {
  const trimmed = String(url || '').trim();
  return trimmed.replace(/^webcals?:\/\//i, 'https://');
}

/**
 * fetchIcs(url) → { ok: true, events } or { ok: false, why }. Only http(s);
 * gives up after 20 seconds or 5MB.
 */
async function fetchIcs(url) {
  const target = feedUrl(url);
  if (!/^https?:\/\//i.test(target)) return { ok: false, why: 'the link has to start with https://, http:// or webcal://' };
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(20000), redirect: 'follow' });
    if (!res.ok) return { ok: false, why: `the server answered ${res.status}` };
    const text = await res.text();
    if (text.length > MAX_BYTES) return { ok: false, why: 'the feed is too big' };
    if (!/BEGIN:VCALENDAR/i.test(text)) return { ok: false, why: 'that link isn\'t a calendar feed (no BEGIN:VCALENDAR)' };
    return { ok: true, events: parseIcs(text) };
  } catch (e) {
    return { ok: false, why: e && e.name === 'TimeoutError' ? 'the feed took too long to answer' : String(e && e.message || e) };
  }
}

module.exports = { parseIcs, fetchIcs, feedUrl };
