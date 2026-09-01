/**
 * Reads what 16-summary.swift's own update check already found — this
 * file doesn't do any checking itself.
 *
 * THE ACTUAL GITHUB CALL LIVES IN SWIFT, NOT HERE.
 *
 * checkForUpdates() in 16-summary.swift runs on launch and every 24
 * hours after, writing whatever it finds to update-status.json. That's
 * the one place with a long-running process to hang a repeating timer
 * on and a menu bar to put a manual "Check for Updates…" item in —
 * neither exists on this side, which only runs for ten seconds at a
 * time every ten minutes. This file just reads that same file back for
 * the summary page and the settings panel to show, plus writes the one
 * field that belongs to a click on the page instead: dismissedVersion.
 *
 * ── Why dismissedVersion is written from here, not Swift ──
 *
 * Dismissing the banner is a click on the page, which reaches this
 * process through the exact same napominalka:// bridge every other
 * page action does (see 21-notifier-actions.js) — writing it directly
 * here keeps that one consistent path, instead of the page's dismiss
 * button needing some other way to reach back into the Swift process
 * that isn't already there for anything else it does.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'update-status.json');

/** Whatever the last check found — null if none has ever run yet. */
function readUpdateStatus() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Marks a version as seen-and-dismissed. Silently a no-op if no check
 * has ever run — nothing to dismiss yet, and there's no reasonable
 * file to create out of thin air here (Swift owns every other field).
 */
function dismissUpdate(version) {
  const current = readUpdateStatus();
  if (!current) return;
  current.dismissedVersion = version;
  try {
    fs.writeFileSync(FILE, JSON.stringify(current, null, 2));
  } catch { /* not fatal — the banner just won't have been dismissed */ }
}

module.exports = { readUpdateStatus, dismissUpdate, FILE };
