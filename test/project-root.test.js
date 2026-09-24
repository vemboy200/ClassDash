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
  fs.copyFileSync(path.join(T.REPO, 'src', '00-project-root.js'), path.join(dir, '00-project-root.js'));
  const { PROJECT_ROOT } = requireFresh(path.join(dir, '00-project-root.js'));
  ok('package.json is my sibling -> PROJECT_ROOT is right here', PROJECT_ROOT === dir, PROJECT_ROOT);
}

// ---- this repo's own source tree: the script is one level below its real data, no sibling package.json ----
{
  const root = T.tmpDir();
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  T.writeFiles(root, { 'package.json': { name: 'x' }, 'settings.json': { language: 'en' } });   // the REAL data, one level up
  fs.copyFileSync(path.join(T.REPO, 'src', '00-project-root.js'), path.join(srcDir, '00-project-root.js'));
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
  fs.copyFileSync(path.join(T.REPO, 'src', '00-project-root.js'), path.join(srcDir, '00-project-root.js'));
  const { PROJECT_ROOT } = requireFresh(path.join(srcDir, '00-project-root.js'));
  ok('no package.json anywhere: still falls back one level up, no crash', PROJECT_ROOT === root, PROJECT_ROOT);
}

// ---- every __dirname left in src/ is one of the known template-sibling uses ----
// Data paths must go through PROJECT_ROOT. The reorg missed live.startRun(__dirname)
// and readCollection(__dirname), which put the progress bar's file in src/live/.
{
  const allowed = [
    /^const PROJECT_ROOT = fs\.existsSync\(path\.join\(__dirname, 'package\.json'\)\)$/,
    /^\? __dirname$/,
    /^: path\.dirname\(__dirname\);$/,
    /^\*/,
    /^const readIcon = name => fs\.readFileSync\(path\.join\(__dirname, name\)\)/,
    /path\.join\(__dirname, 'settings\.example\.json'\)/,
    /path\.join\(__dirname, '(05-playwright-draft|17-api)\.js'\)/,
    /cwd: __dirname/,
  ];
  const srcDir = path.join(T.REPO, 'src');
  const stray = [];
  for (const f of fs.readdirSync(srcDir).filter(f => f.endsWith('.js'))) {
    fs.readFileSync(path.join(srcDir, f), 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').trim();
      if (code.includes('__dirname') && !allowed.some(re => re.test(code))) stray.push(`${f}:${i + 1}: ${code}`);
    });
  }
  ok('no data path in src/ is built from __dirname (use PROJECT_ROOT)', stray.length === 0, '\n' + stray.join('\n'));
}

process.exit(process.exitCode || 0);
