/**
 * What changed between two versions of the dashboard's data (dashboardView in
 * 08-page.js), so the stream sends that and not all of it. A list says its new
 * order and the items that are new or different; anything else is replaced as a
 * whole if it differs at all. `pieces` go one by one, being large.
 *
 * Only useful to a page holding exactly `from`: it has to check, and ask for
 * the whole thing otherwise (dashHeard in 08-page.js).
 */
const crypto = require('crypto');

function revOf(view) {
  return crypto.createHash('sha1').update(JSON.stringify(view)).digest('hex').slice(0, 16);
}

function dashDiff(before, after) {
  const lists = {};
  for (const name of Object.keys(after.lists)) {
    const was = new Map((before.lists[name] || []).map(x => [x.id, JSON.stringify(x)]));
    const set = after.lists[name].filter(x => was.get(x.id) !== JSON.stringify(x));
    const order = after.lists[name].map(x => x.id);
    if (set.length || JSON.stringify(order) !== JSON.stringify([...was.keys()])) lists[name] = { order, set };
  }
  const values = {};
  for (const key of Object.keys(after)) {
    if (key === 'lists' || key === 'pieces') continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) values[key] = after[key];
  }
  const pieces = {};
  for (const name of Object.keys(after.pieces || {})) {
    if ((before.pieces || {})[name] !== after.pieces[name]) pieces[name] = after.pieces[name];
  }
  if (Object.keys(pieces).length) values.pieces = pieces;
  return { lists, values };
}

module.exports = { revOf, dashDiff };
