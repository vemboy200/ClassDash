/**
 * Keeps a project folder's scripts in step with the app that runs them.
 *
 *   node 30-template-sync.js <bundled template folder> <project folder>
 *
 * ── The problem this solves ──
 *
 * The apps ship a copy of the project (Contents/Resources/ProjectTemplate on
 * macOS, resources\ProjectTemplate on Windows), and the first-run wizard
 * copies it into the folder the person picks. After that everything —
 * collecting, the page, the notifier, the home API — runs from THAT folder.
 * Nothing ever refreshed it: installing a new version of the app, by hand or
 * through the in-app updater, replaced the app and left the scripts as they
 * were on the day the folder was made. Caught on a real Windows laptop: the
 * new installer was installed, and the page was still the one from three
 * weeks earlier, because the page is a script in the project folder.
 *
 * So on every launch the app runs this, from the BUNDLED template (never
 * from the project, which may be too old to have it): when the project's
 * copy no longer matches the app's, the app's copy goes over it.
 *
 * ── What it touches, and what it never does ──
 *
 * It copies what the template ships — the scripts, the icons, package.json,
 * settings.example.json — and nothing else. Settings, collected data, the
 * browser profile, logs, and any file the template doesn't have are not read,
 * changed or deleted. node_modules is replaced only when the dependencies in
 * package.json changed (or it's missing), since it's big.
 *
 * Files it is about to overwrite are first copied to previous-scripts/,
 * replacing whatever an earlier sync left there: one step of undo, for
 * someone who had edited a script by hand.
 *
 * ── When it does nothing ──
 *
 *   - The project is a git checkout (has a .git). That's someone running from
 *     source — the developer's own working copy, which the bundled template
 *     can be OLDER than — and overwriting it would destroy uncommitted work.
 *     This is the guard that matters most.
 *   - The project IS the template folder, there's no template, or there's no
 *     project.
 *   - Nothing changed: the project's marker (template-sync.json) holds the
 *     fingerprint of the template it was last synced to. The fingerprint is a
 *     hash of the template's files, not the app's version number: a dev build
 *     has the same version string across different code.
 *
 * It never throws and always exits 0, printing one JSON line: a failed sync
 * must not stop the app from opening, and it isn't marked done, so the next
 * launch tries again.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MARKER = 'template-sync.json';
const BACKUP_DIR = 'previous-scripts';

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const exists = p => fs.existsSync(p);

/** The files a template ships, at its top level (its node_modules is a
 *  folder and handled separately). Dotfiles are left out. */
function shippedFiles(templateDir) {
  return fs.readdirSync(templateDir, { withFileTypes: true })
    .filter(e => e.isFile() && !e.name.startsWith('.'))
    .map(e => e.name)
    .sort();
}

/** One hash over every shipped file's name and contents. */
function fingerprint(templateDir, files = shippedFiles(templateDir)) {
  const hash = crypto.createHash('sha256');
  for (const name of files) {
    const body = fs.readFileSync(path.join(templateDir, name));
    hash.update(name).update('\0').update(String(body.length)).update('\0').update(body);
  }
  return hash.digest('hex');
}

/** package.json's dependencies, normalized, or null if there aren't any to read. */
function dependenciesOf(dir) {
  try {
    const deps = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dependencies || {};
    return JSON.stringify(Object.fromEntries(Object.entries(deps).sort()));
  } catch {
    return null;
  }
}

function readMarker(projectDir) {
  try { return JSON.parse(fs.readFileSync(path.join(projectDir, MARKER), 'utf8')); } catch { return null; }
}

// Written to a temp name and renamed, so an interrupted write can't leave a
// half-written marker that later reads as "not matching" forever.
function writeMarker(projectDir, data) {
  const tmp = path.join(projectDir, MARKER + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, path.join(projectDir, MARKER));
}

const skipped = reason => ({ ok: true, action: 'skipped', reason });

/**
 * @returns {{ok: boolean, action: 'skipped'|'current'|'synced'|'failed',
 *            reason?: string, changed?: string[], refreshedModules?: boolean,
 *            error?: string}}
 *   changed  the files that were replaced or added — empty when the project
 *            already matched and only the marker was missing
 */
function syncProject(templateDir, projectDir) {
  try {
    if (!templateDir || !isDir(templateDir)) return skipped('no bundled template');
    if (!projectDir || !isDir(projectDir)) return skipped('no project folder');
    if (fs.realpathSync(templateDir) === fs.realpathSync(projectDir)) {
      return skipped('the project is the template');
    }
    if (exists(path.join(projectDir, '.git'))) return skipped('a git checkout: running from source');

    const files = shippedFiles(templateDir);
    if (!files.length) return skipped('the template has no files');

    const print = fingerprint(templateDir, files);
    const marker = readMarker(projectDir);
    if (marker && marker.fingerprint === print) return { ok: true, action: 'current' };

    const changed = files.filter(name => {
      const there = path.join(projectDir, name);
      return !exists(there) ||
        !fs.readFileSync(path.join(templateDir, name)).equals(fs.readFileSync(there));
    });

    // Decided BEFORE package.json is copied over: afterwards they'd match.
    const templateModules = path.join(templateDir, 'node_modules');
    const projectModules = path.join(projectDir, 'node_modules');
    const refreshModules = isDir(templateModules) &&
      (dependenciesOf(templateDir) !== dependenciesOf(projectDir) || !isDir(projectModules));

    if (changed.length) {
      // One step of undo: what's about to be replaced, kept until the next sync.
      const backup = path.join(projectDir, BACKUP_DIR);
      fs.rmSync(backup, { recursive: true, force: true });
      const replacing = changed.filter(name => exists(path.join(projectDir, name)));
      if (replacing.length) {
        fs.mkdirSync(backup, { recursive: true });
        for (const name of replacing) fs.copyFileSync(path.join(projectDir, name), path.join(backup, name));
      }
      for (const name of changed) fs.copyFileSync(path.join(templateDir, name), path.join(projectDir, name));
    }

    if (refreshModules) {
      fs.rmSync(projectModules, { recursive: true, force: true });
      fs.cpSync(templateModules, projectModules, { recursive: true });
    }

    writeMarker(projectDir, {
      fingerprint: print, appliedAt: new Date().toISOString(), changed: changed.length,
    });
    return { ok: true, action: 'synced', changed, refreshedModules: refreshModules };
  } catch (e) {
    return { ok: false, action: 'failed', error: e.message };
  }
}

module.exports = { syncProject, fingerprint, shippedFiles, MARKER, BACKUP_DIR };

if (require.main === module) {
  const [templateDir, projectDir] = process.argv.slice(2);
  console.log(JSON.stringify(syncProject(templateDir, projectDir)));
  process.exit(0);
}
