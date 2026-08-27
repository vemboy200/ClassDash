/**
 * Installs a separate, dedicated Brave for login and collection — not the
 * browser a person actually uses every day.
 *
 * ── Why a separate browser at all ──
 *
 * This used to be plain Playwright Chromium — Google cuts off login through
 * it as a "not secure" browser. Real Chrome via channel: 'chrome' fixes
 * that, but drags along either a system install of Google Chrome, or (if
 * someone already has a different Chromium fork installed, like Arc) the
 * risk of running the automation on top of THEIR real profile.
 *
 * That's exactly what happened once: Arc doesn't respect --user-data-dir,
 * silently used the real user profile instead, and after launching with
 * Playwright's automation flags (--use-mock-keychain and so on), the real
 * cookies and extensions didn't survive the next normal Arc launch.
 * Recovery wasn't possible — there was no backup.
 *
 * Brave doesn't do this: it respects --user-data-dir like an ordinary
 * Chromium build. But rather than rely on luck with ANY browser someone
 * happens to have installed, this file installs its OWN Brave — into
 * .browser/ inside this project, not into /Applications. It doesn't open
 * as a normal app, doesn't participate in "default browser," and has
 * nothing to conflict with: only this project ever touches it.
 *
 * Real Google Chrome gives the exact same safety guarantee Arc didn't —
 * it also respects --user-data-dir correctly. So if Chrome is already on
 * the system, this skips the download entirely: there's nothing to fix
 * that isn't already fine.
 *
 * ── Why just a copy of the .app, not a real install ──
 *
 * A .app on macOS is a self-contained folder. It doesn't need to live in
 * /Applications to work. Copy it out of the .dmg — done. No Launch Services
 * registration, no Dock icon, no auto-updates.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const DIR = path.join(__dirname, '.browser');
const APP = path.join(DIR, 'Brave Browser.app');
const BINARY = path.join(APP, 'Contents/MacOS/Brave Browser');

// Brave's official download endpoints, different for Apple Silicon and Intel.
const URLS = {
  arm64: 'https://laptop-updates.brave.com/latest/osxarm64',
  x64: 'https://laptop-updates.brave.com/latest/osx',
};

function isInstalled() {
  return fs.existsSync(BINARY);
}

// Google Chrome, unlike Arc, respects --user-data-dir like any well-behaved
// Chromium build: launching it with this project's own profile folder never
// touches a person's real, everyday Chrome profile, cookies, or extensions.
// That's the same guarantee the bundled Brave gives — so if Chrome is
// already installed, there's nothing this needs to do at all. This is only
// about the download, not the runtime fallback: 05-playwright-draft.js
// already falls back to channel: 'chrome' on its own regardless of what
// this function reports.
const SYSTEM_CHROME = '/Applications/Google Chrome.app';

function hasSystemChrome() {
  return fs.existsSync(SYSTEM_CHROME);
}

function extractVolumeFromOutput(output) {
  // hdiutil attach prints one line per partition; only the one that
  // actually mounted has a volume path.
  const line = output.split('\n').reverse().find(l => l.includes('/Volumes/'));
  if (!line) throw new Error('could not find a mount point in hdiutil output');
  return line.split('\t').pop().trim();
}

function install() {
  if (process.platform !== 'darwin') {
    console.error('Automatic browser install only works on macOS so far.');
    process.exitCode = 1;
    return;
  }
  if (isInstalled()) {
    console.log('Brave is already installed:', APP);
    return;
  }
  if (hasSystemChrome()) {
    console.log('Found Google Chrome already installed — nothing to download.');
    console.log('This project will automatically use it with its own isolated');
    console.log('profile folder, never your everyday Chrome profile.');
    console.log(`(Run this again with --force to install Brave anyway: ${SYSTEM_CHROME} would be ignored.)`);
    if (!process.argv.includes('--force')) return;
  }
  const url = URLS[process.arch];
  if (!url) {
    console.error(`Unknown processor architecture: ${process.arch}`);
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(DIR, { recursive: true });
  const dmg = path.join(os.tmpdir(), `brave-${Date.now()}.dmg`);
  let volume;

  try {
    console.log('Downloading Brave (about 150 MB, one time only)...');
    execFileSync('curl', ['-L', '-o', dmg, url], { stdio: 'inherit' });

    console.log('Extracting...');
    const output = execFileSync('hdiutil', ['attach', dmg, '-nobrowse', '-readonly'], { encoding: 'utf8' });
    volume = extractVolumeFromOutput(output);

    // ditto, not cp -R: cp drags along Finder resource forks that later
    // make codesign --verify --strict fail.
    execFileSync('ditto', [path.join(volume, 'Brave Browser.app'), APP]);
    execFileSync('xattr', ['-cr', APP]);
    execFileSync('codesign', ['--verify', '--deep', '--strict', APP]);
  } finally {
    if (volume) { try { execFileSync('hdiutil', ['detach', volume]); } catch {} }
    try { fs.unlinkSync(dmg); } catch {}
  }

  console.log('Done:', APP);
  console.log('Nothing to set in settings.json — it gets picked up automatically.');
}

module.exports = { isInstalled, hasSystemChrome, APP, BINARY };

if (require.main === module) {
  install();
}
