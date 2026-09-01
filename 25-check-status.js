/**
 * "Did the last check actually work?" — per platform, three states:
 *
 *   ok       — the last real attempt got its data back cleanly
 *   problem  — the last real attempt failed (network, cookies, a broken
 *              page — see `detail`)
 *   unknown  — never actually attempted, either because it's turned off
 *              (no Canvas address, edpuzzleEnabled false) or because no
 *              check has completed yet since the app was set up
 *
 * OWN FILE, NOT PART OF 05-playwright-draft.js — same reasoning as
 * 22-class-activity.js: this needs to be read from 08-page.js and
 * 17-api.js, both of which already require 05-playwright-draft.js, so
 * putting it there would mean requiring 05 from itself indirectly.
 *
 * ── Why "unknown" overrides whatever was last recorded ──
 *
 * Edpuzzle only actually runs during a full check (digest hours or a
 * manual Fresh check) — most of the day's quick checks never touch it
 * at all, so a stored "ok" from six hours ago is still the right thing
 * to show. But the moment edpuzzleEnabled goes off, that stored status
 * would otherwise just sit there forever, claiming a health check that
 * will never happen again actually still applies. Turning a platform
 * off has to read as "unknown" immediately, not "stuck at whatever it
 * last was" — checked live at read time against current settings,
 * not baked into what gets written.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'check-status.json');

function readRaw() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

const UNKNOWN = { status: 'unknown', at: null, detail: null };

/**
 * Records the outcome of an actual attempt at one platform this pass.
 * Only ever called for a platform that was really just tried — never
 * called at all for Canvas/Edpuzzle while they're turned off, so a
 * disabled platform's entry just sits frozen (harmless: checkStatus()
 * below overrides it with "unknown" while it stays disabled anyway).
 */
function record(platform, ok, detail = null) {
  const all = readRaw();
  all[platform] = {
    status: ok ? 'ok' : 'problem',
    at: new Date().toISOString(),
    detail: ok ? null : (detail || null),
  };
  try {
    fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
  } catch { /* not fatal — status just won't have moved this pass */ }
}

/**
 * The display-ready status for all three platforms. Classroom is
 * always attempted (there's no "Classroom disabled" concept — email is
 * required to run at all), so it only ever reads "unknown" before the
 * very first check has ever completed.
 */
function checkStatus() {
  const settings = require('./19-settings.js').read();
  const raw = readRaw();
  const canvasConfigured = !!(settings.canvas || '').trim();
  return {
    classroom: raw.classroom || UNKNOWN,
    canvas: canvasConfigured ? (raw.canvas || UNKNOWN) : UNKNOWN,
    edpuzzle: settings.edpuzzleEnabled ? (raw.edpuzzle || UNKNOWN) : UNKNOWN,
  };
}

module.exports = { record, checkStatus, FILE };
