const fs = require('fs'), vm = require('vm');
const T = require('./helpers');
const src = fs.readFileSync(require('path').join(T.REPO, 'electron/main.js'), 'utf8');
const a = src.indexOf('function buildMenu()'), b = src.indexOf('function openSettings()');
const code = src.slice(a, b);
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const ran = []; let template = null;
const ctx = {
  Menu: { buildFromTemplate: t => { template = t; return t; }, setApplicationMenu: () => {} },
  checkForUpdatesManually() {}, openSettings() {},
  win: { isDestroyed: () => false, webContents: { executeJavaScript: (js) => { ran.push(js); return Promise.resolve(); } } },
};
vm.createContext(ctx);
vm.runInContext(code + '\nbuildMenu();', ctx);
const flat = template.flatMap(m => (m.submenu || []).map(i => ({ menu: m.label || m.role, ...i })));
ok(!flat.some(i => i.role === 'reload' || i.role === 'forceReload'), 'the built-in reload role is gone (it would swallow Ctrl+R / Ctrl+Shift+R)');
const item = l => flat.find(i => i.label === l);
ok(item('Refresh').accelerator === 'CmdOrCtrl+R' && item('Refresh').menu === 'View', 'Refresh: CmdOrCtrl+R in View');
ok(item('Fresh Check').accelerator === 'CmdOrCtrl+Shift+R', 'Fresh Check: CmdOrCtrl+Shift+R');
ok(item('Check Status').accelerator === 'CmdOrCtrl+S', 'Check Status: CmdOrCtrl+S');
const accels = flat.map(i => i.accelerator).filter(Boolean);
ok(new Set(accels).size === accels.length, 'no accelerator is used twice: ' + accels.join(', '));
item('Refresh').click(); item('Fresh Check').click(); item('Check Status').click();
ok(ran.length === 3 && /classdashShortcut\('refresh'\)/.test(ran[0]) && /classdashShortcut\('fresh'\)/.test(ran[1]) && /classdashShortcut\('status'\)/.test(ran[2]), 'each item calls the page function: ' + JSON.stringify(ran.map(r => r.slice(-22))));
ok(flat.some(i => i.role === 'quit') && template.some(m => m.role === 'editMenu'), 'quit and the Edit menu are still there');
ok(!flat.some(i => /Choose Browser|Sign In/.test(i.label || '')), 'the moved items stay out of the menu');
console.log(`menu-windows: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
