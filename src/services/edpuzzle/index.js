/**
 * Edpuzzle, as the services bridge (61-services.js) sees it. The only file of
 * it the check calls.
 *
 *   bridge.settings   the settings
 *   bridge.openPage   async () => a tab of ClassDash's signed-in browser (in read)
 *   bridge.log        a line for the check's log (in read)
 *
 * Its manifest's browser class is "visible": Edpuzzle turns away a hidden
 * browser, so the check only reads it in a full check, with a window
 * (05-playwright-draft.js decides that from the manifest). Reading it is in
 * 11-edpuzzle.js.
 */

const SITE = 'https://edpuzzle.com/';

// There's nothing to type in for Edpuzzle, so it's its own switch.
const enabled = bridge => bridge.settings.edpuzzleEnabled !== false;

const addresses = bridge => (enabled(bridge) ? [SITE] : []);

/** Reads Edpuzzle, in the shape every service's read() has. */
async function read(bridge) {
  const page = await bridge.openPage();
  try {
    const { items, classrooms } = await require('./11-edpuzzle.js').collectEdpuzzle(page);
    (bridge.log || (() => {}))(`  Edpuzzle: classes ${classrooms.length}, assignments ${items.length}`);
    return { items };
  } finally {
    try { await page.close(); } catch { /* already closed */ }
  }
}

module.exports = { enabled, addresses, read, SITE };
