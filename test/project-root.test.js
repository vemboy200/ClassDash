// 00-project-root.js's PROJECT_ROOT fallback — the one thing standing
// between the pipeline scripts and their real data once they move into
// src/, while a real deployed project (or a test scratch copy) never
// takes the fallback at all. See CONTRIBUTING.md and 00-project-root.js's
// own header comment for the full reasoning.
const T = require('./helpers');
const path = require('path'), fs = require('fs');
const ok = (n, c, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) process.exitCode = 1; };

const requireFresh = (file) => {
  delete require.cache[require.resolve(file)];
  return require(file);
};

// ---- a real deployed project / test scratch copy: package.json sits right next to the script ----
{
  const dir = T.tmpDir();
  T.writeFiles(dir, { 'package.json': { name: 'x' } });
  fs.copyFileSync(path.join(T.REPO, '00-project-root.js'), path.join(dir, '00-project-root.js'));
  const { PROJECT_ROOT } = requireFresh(path.join(dir, '00-project-root.js'));
  ok('package.json is my sibling -> PROJECT_ROOT is right here', PROJECT_ROOT === dir, PROJECT_ROOT);
}

// ---- this repo's own source tree: the script is one level below its real data, no sibling package.json ----
{
  const root = T.tmpDir();
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  T.writeFiles(root, { 'package.json': { name: 'x' }, 'settings.json': { language: 'en' } });   // the REAL data, one level up
  fs.copyFileSync(path.join(T.REPO, '00-project-root.js'), path.join(srcDir, '00-project-root.js'));
  const { PROJECT_ROOT } = requireFresh(path.join(srcDir, '00-project-root.js'));
  ok('no sibling package.json in src/ -> PROJECT_ROOT is one level up, where the real data is',
    PROJECT_ROOT === root, PROJECT_ROOT);
  ok('...and that really is where settings.json already sits',
    fs.existsSync(path.join(PROJECT_ROOT, 'settings.json')));
}

// ---- neither package.json anywhere: still resolves to one level up, doesn't throw ----
{
  const root = T.tmpDir();
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.copyFileSync(path.join(T.REPO, '00-project-root.js'), path.join(srcDir, '00-project-root.js'));
  const { PROJECT_ROOT } = requireFresh(path.join(srcDir, '00-project-root.js'));
  ok('no package.json anywhere: still falls back one level up, no crash', PROJECT_ROOT === root, PROJECT_ROOT);
}

process.exit(process.exitCode || 0);
