/**
 * Where this project's OWN data lives — settings.json, last-collection.json,
 * summary.html, and everything else every script here reads or writes.
 *
 * For a real, deployed project — the app's own ProjectTemplate, flattened
 * by build.sh/electron-builder into whatever folder a user picks, and the
 * test suite's own scratch copies (test/helpers.js's makeProject()) — that
 * is always just __dirname: every script and its data sit flat together,
 * exactly as they always have.
 *
 * Running this repo's own source tree directly is the one exception: these
 * scripts live in src/, one level below the actual project root, where a
 * developer's own settings.json/last-collection.json/etc already sits (see
 * CONTRIBUTING.md's "Building from source"). package.json is the signal:
 * every real deployed or test project has one flattened right alongside the
 * scripts (see build.sh, electron/package.json's extraResources, and
 * test/helpers.js's makeProject()) — src/ deliberately does NOT ship its
 * own copy, on purpose, so its absence is exactly what says "one level up."
 *
 * Anything that's a template-sibling file rather than personal data —
 * icons, settings.example.json, a script spawning another script next to
 * it — stays on plain __dirname; only actual data-file paths use this.
 */
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = fs.existsSync(path.join(__dirname, 'package.json'))
  ? __dirname
  : path.dirname(__dirname);

module.exports = { PROJECT_ROOT };
