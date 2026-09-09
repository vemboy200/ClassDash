/**
 * Reads what 16-summary.swift's own update check already found, and
 * handles downloading the release it points at — two different halves
 * of "update support," split across two processes for a real reason,
 * not by accident.
 *
 * ── Checking lives in Swift, downloading lives here ──
 *
 * checkForUpdates() in 16-summary.swift runs on launch and every 24
 * hours after, writing whatever it finds to update-status.json — that's
 * the one place with a long-running process to hang a repeating timer
 * on, and a menu bar to put a manual "Check for Updates…" item in.
 *
 * Downloading the actual .dmg is different: it has to work even when
 * 16-summary.swift ISN'T running at all. The home API's own process
 * (17-api.js) is spawned fully detached — see startApiServer() in
 * 21-notifier-actions.js — its lifetime has nothing to do with whether
 * the app is open. A POST to /api/update-status/download has to
 * actually do something regardless, so the fetch happens here, in
 * plain Node, not in Swift. This also sidesteps a real Gatekeeper
 * concern for free: macOS only quarantines a downloaded file when the
 * app fetching it opts into LSFileQuarantineEnabled (Safari, Mail) or
 * calls the quarantine APIs directly — a plain `https.get` here never
 * triggers that, so there's nothing to strip afterward.
 *
 * Actually INSTALLING the download (mounting the .dmg, replacing
 * ClassDash.app, relaunching) still has to happen in 16-summary.swift
 * — that needs AppKit, and it's the one step deliberately gated behind
 * a native confirmation nothing outside that process can trigger or
 * skip. See installReadyUpdate()/maybeShowInstallPrompt() there.
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const FILE = path.join(__dirname, 'update-status.json');

// Named for the extension the release actually shipped (.dmg on macOS,
// .exe on Windows), not hardcoded to one platform — this file is the one
// piece of the update flow shared by both native wrappers (see
// 16-summary.swift and electron/main.js), so it can't assume which one
// called it. Falls back to .dmg only if a URL genuinely has no extension
// at all, which no real release asset should ever hit.
function destPathFor(downloadURL) {
  let ext = '.dmg';
  try {
    ext = path.extname(new URL(downloadURL).pathname) || ext;
  } catch { /* keep the fallback */ }
  return path.join(__dirname, 'update-download' + ext);
}

/**
 * One word for "what's it doing right now" — computed fresh from the
 * raw fields every time, not stored as its own field anyone has to
 * remember to keep in sync. Three different writers touch this file
 * (checkForUpdates() and installReadyUpdate() in 16-summary.swift,
 * downloadUpdate() here) — a stored status string would mean all three
 * agreeing on when to update it, and any one of them forgetting would
 * silently desync it from the booleans it's supposed to summarize.
 * Deriving it here instead means there's exactly one place that can
 * ever be wrong.
 *
 *   unknown     — no check has completed yet
 *   error       — the last check or download attempt failed (see `error`)
 *   downloading — a download is in progress right now
 *   ready       — downloaded, waiting on the native install confirmation
 *   available   — a newer version exists, nothing downloaded yet
 *   up_to_date  — currentVersion is already the latest
 */
function computeStatus(raw) {
  if (!raw || !raw.checkedAt) return 'unknown';
  if (raw.downloading) return 'downloading';
  if (raw.readyToInstall) return 'ready';
  if (raw.error) return 'error';
  if (raw.updateAvailable) return 'available';
  return 'up_to_date';
}

/**
 * Whatever the last check found, plus `status` (computeStatus() above)
 * and `downloadedVersion` — the version actually sitting downloaded,
 * as opposed to `currentVersion` (what's running) or `latestVersion`
 * (what GitHub has). Both computed on read, not stored under their own
 * keys: `readyVersion` is still the field every writer touches
 * internally (least churn to the three places that already reference
 * it by that name), `downloadedVersion` is just the clearer name to
 * expose. Returns null if no check has ever run yet.
 */
function readUpdateStatus() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return null;
  }
  return {
    ...raw,
    status: computeStatus(raw),
    downloadedVersion: raw.readyVersion || null,
  };
}

/** The raw object as last written, with none of readUpdateStatus()'s
 *  computed fields — what every writer should read-modify-write
 *  against, so a computed field never gets accidentally persisted as
 *  if it were real stored state. */
function readUpdateStatusRaw() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Merges into whatever's already there, same "each writer owns its own
 * fields" rule 16-summary.swift's own writeUpdateStatus() follows —
 * this only ever touches downloading/readyToInstall/readyVersion/
 * downloadedPath, never latestVersion/url/dismissedVersion, which
 * belong to the check and the dismiss action respectively.
 */
function writeFields(fields) {
  const current = readUpdateStatusRaw() || {};
  Object.assign(current, fields);
  try {
    fs.writeFileSync(FILE, JSON.stringify(current, null, 2));
  } catch { /* not fatal — status just won't reflect this step */ }
}

/**
 * Marks a version as seen-and-dismissed. Silently a no-op if no check
 * has ever run — nothing to dismiss yet, and there's no reasonable
 * file to create out of thin air here (Swift owns every other field).
 */
function dismissUpdate(version) {
  const current = readUpdateStatusRaw();
  if (!current) return;
  current.dismissedVersion = version;
  try {
    fs.writeFileSync(FILE, JSON.stringify(current, null, 2));
  } catch { /* not fatal — the banner just won't have been dismissed */ }
}

/**
 * Follows redirects itself — Node's https.get doesn't, and GitHub's
 * own `browser_download_url` always 302s to a signed, short-lived S3
 * URL rather than serving the asset directly. Capped at 5 hops so a
 * redirect loop fails loudly instead of hanging forever.
 */
function fetchToFile(url, destPath, redirectsLeft, cb) {
  const file = fs.createWriteStream(destPath);
  const cleanupAndFail = (err) => {
    file.close();
    fs.unlink(destPath, () => cb(err));
  };

  https.get(url, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume(); // drain this response before starting the next one
      file.close();
      if (redirectsLeft <= 0) return cleanupAndFail(new Error('too many redirects'));
      return fetchToFile(res.headers.location, destPath, redirectsLeft - 1, cb);
    }
    if (res.statusCode !== 200) {
      res.resume();
      return cleanupAndFail(new Error(`download responded ${res.statusCode}`));
    }
    res.pipe(file);
    file.on('finish', () => file.close(() => cb(null)));
    file.on('error', cleanupAndFail);
  }).on('error', cleanupAndFail);
}

/**
 * Starts a download in the background and returns immediately — same
 * "started, not finished" contract 'check'/'reload' already use for a
 * real collection pass (see 21-notifier-actions.js). A caller (the
 * page, an API client) watches update-status.json's own downloading/
 * readyToInstall fields for progress instead of waiting on this call,
 * since a release .dmg is a real download, not something to hold a
 * request open for.
 */
function downloadUpdate() {
  const status = readUpdateStatusRaw();
  if (!status || !status.downloadURL || !status.latestVersion) {
    return { ok: false, why: 'no downloadURL yet — run a check first' };
  }

  // Already have this exact version sitting downloaded — nothing to
  // do, just let whatever's polling notice readyToInstall is already
  // true. Re-downloading the same bytes on every retry would be a
  // waste, and would also spuriously flip downloading back to true for
  // something that's already sitting there finished.
  if (status.readyVersion === status.latestVersion && status.readyToInstall) {
    return { ok: true, alreadyReady: true };
  }

  const latestVersion = status.latestVersion;
  // error cleared here, not just on success — starting a fresh attempt
  // is itself a reason to stop reporting a PREVIOUS attempt's failure;
  // computeStatus() would otherwise keep reading "error" right through
  // a download that's actually in progress right now, since a stale
  // error field never got cleared by anything.
  writeFields({ downloading: true, error: null });

  const destPath = destPathFor(status.downloadURL);
  fetchToFile(status.downloadURL, destPath, 5, (err) => {
    if (err) {
      writeFields({ downloading: false, error: err.message });
      return;
    }
    writeFields({
      downloading: false,
      readyToInstall: true,
      readyVersion: latestVersion,
      downloadedPath: destPath,
      error: null,
    });
  });

  return { ok: true, started: true };
}

module.exports = { readUpdateStatus, dismissUpdate, downloadUpdate, FILE };
