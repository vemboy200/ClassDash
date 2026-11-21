/**
 * Where the credentials live: the settings that are keys (the Canvas access
 * token, the AI providers' API keys, the key for forwarding diagnostics) and
 * the Home API's own access key (23-api-security.js). Not in settings.json, which is plain text that
 * anything copying the ClassDash folder copies too (a synced folder, a
 * backup, a school computer's admin tools, someone with a USB stick).
 *
 *   Mac      the login keychain, one item ("ClassDash secrets"), written and
 *            read through /usr/bin/security like the Q password
 *            (services/q/40-grades.js). The value goes in on stdin, so it
 *            never shows up in the list of running processes.
 *   Windows  secrets.dat in the ClassDash folder, encrypted with Windows'
 *            own per-user encryption (DPAPI, through PowerShell). Copied to
 *            another computer or opened by another account, it's unreadable.
 *   Other    secrets.json in the ClassDash folder, readable only by this
 *            user account. There's no store every Linux has (a Docker
 *            container has none at all), so this is the honest fallback.
 *
 * None of this stops a program already running as you: it can ask the
 * keychain or DPAPI the same way ClassDash does. What it stops is the
 * folder (or a copy of it) giving the keys away by itself.
 *
 * settings.json keeps only `savedSecrets`, { key: fingerprint }: which keys
 * are saved (the apps' setup wizards check it for the Canvas token) and a
 * stamp, so a long-running process notices another process changed one and
 * reads the store again. A fingerprint is a cut-down SHA-256, which says
 * nothing about a random token.
 *
 * CLASSDASH_SECRETS_STORE=file: the plain file everywhere. The tests set it,
 * since they must never touch the real keychain.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { PROJECT_ROOT } = require('./00-project-root.js');

// The settings that are keys: read() in 19-settings.js fills them in.
const KEYS = ['canvasToken', 'aiOpenaiKey', 'aiAnthropicKey', 'aiGeminiKey', 'diagnosticsForwardToken'];
// Kept here too, but not settings: the Home API's access key, and the key
// the ClassDash app signs its own window in with (23-api-security.js).
const NAMES = [...KEYS, 'apiToken', 'appKey'];
const SERVICE = 'ClassDash secrets';
const ACCOUNT = 'settings';
const PLAIN_FILE = path.join(PROJECT_ROOT, 'secrets.json');
const PROTECTED_FILE = path.join(PROJECT_ROOT, 'secrets.dat');

// What the settings panel shows in a saved key's box instead of the key: the
// page is also a file on disk (summary.html), so the key itself never goes
// in it. A save that sends this back means "unchanged" (planBatch in
// 19-settings.js); an emptied box removes the key.
const SAVED_MARK = '\u2022'.repeat(16);

const fingerprint = v => {
  const t = String(v || '').trim();
  return t ? crypto.createHash('sha256').update(t).digest('hex').slice(0, 16) : '';
};

// ── The stores. Each reads and writes one JSON object of all the secrets. ──

// Inside "…" for `security -i`: a backslash and a quote get a backslash.
const quoted = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

function keychainStore({ run = execFileSync, service = SERVICE, account = ACCOUNT } = {}) {
  return {
    kind: 'keychain',
    load() {
      let out;
      try {
        out = run('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w'], { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        // 44: no such item, which is simply nothing saved yet. Anything else
        // (a locked keychain) is an error: reading it as "nothing saved"
        // would let the next save wipe the keys.
        if (e.status === 44) return {};
        throw new Error('couldn\'t read the keychain: ' + String(e.stderr || e.message).trim().split('\n')[0]);
      }
      // Stored as base64, so no quote or backslash in a key has to survive
      // `security -i`'s own quoting.
      return JSON.parse(Buffer.from(String(out).trim(), 'base64').toString('utf8'));
    },
    save(all) {
      if (!Object.keys(all).length) {
        try { run('/usr/bin/security', ['delete-generic-password', '-s', service, '-a', account], { stdio: 'ignore' }); } catch { /* wasn't there */ }
        return;
      }
      const value = Buffer.from(JSON.stringify(all)).toString('base64');
      const line = `add-generic-password -U -s ${quoted(service)} -a ${quoted(account)} -w ${quoted(value)}\n`;
      // `security -i` cuts input lines at 4096 bytes and runs the rest as a
      // command of its own (measured: a 4097-byte line is the most that
      // works, newline included). Refused here with a reason instead.
      if (Buffer.byteLength(line) > 4000) throw new Error('too much to keep in one keychain item');
      run('/usr/bin/security', ['-i'], { input: line, stdio: ['pipe', 'ignore', 'pipe'] });
    },
  };
}

// DPAPI through Windows PowerShell 5.1, which every Windows 10 and 11 has.
// The data goes in and out on stdin/stdout as base64, never on the command
// line. CurrentUser scope: only this Windows account can decrypt it.
function dpapi(direction, base64, run = execFileSync) {
  const call = direction === 'protect' ? 'Protect' : 'Unprotect';
  const script = 'Add-Type -AssemblyName System.Security; ' +
    '$d = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); ' +
    `$o = [Security.Cryptography.ProtectedData]::${call}($d, $null, 'CurrentUser'); ` +
    '[Console]::Out.Write([Convert]::ToBase64String($o))';
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return String(run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { input: base64, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, timeout: 30000 })).trim();
}

/** A file holding one JSON value, encrypted with DPAPI. Also what the Q
 *  password uses on Windows (services/q/40-grades.js). */
function protectedFile(file, run = execFileSync) {
  return {
    read() {
      let raw;
      try { raw = fs.readFileSync(file, 'utf8').trim(); } catch (e) { if (e.code === 'ENOENT') return undefined; throw e; }
      return JSON.parse(Buffer.from(dpapi('unprotect', raw, run), 'base64').toString('utf8'));
    },
    write(value) {
      const sealed = dpapi('protect', Buffer.from(JSON.stringify(value)).toString('base64'), run);
      fs.writeFileSync(file, sealed, { mode: 0o600 });
    },
    remove() { try { fs.unlinkSync(file); } catch { /* wasn't there */ } },
  };
}

function protectedFileStore(file = PROTECTED_FILE, run = execFileSync) {
  const f = protectedFile(file, run);
  return {
    kind: 'protected file',
    load() { return f.read() || {}; },
    save(all) { if (Object.keys(all).length) f.write(all); else f.remove(); },
  };
}

function plainFileStore(file = PLAIN_FILE) {
  return {
    kind: 'file',
    load() {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
    },
    save(all) {
      if (!Object.keys(all).length) { try { fs.unlinkSync(file); } catch { /* wasn't there */ } return; }
      fs.writeFileSync(file, JSON.stringify(all, null, 2), { mode: 0o600 });
      try { fs.chmodSync(file, 0o600); } catch { /* a file system without modes */ }
    },
  };
}

let storeOverride = null;
function store() {
  if (storeOverride) return storeOverride;
  return itemStore('settings', 'secrets');
}

/** A store of its own for something too big to share the main item (the
 *  Home API certificate's private key, 23-api-security.js): another keychain
 *  account under the same service, or its own file. */
function itemStore(account, fileBase) {
  if (process.env.CLASSDASH_SECRETS_STORE === 'file') return plainFileStore(path.join(PROJECT_ROOT, fileBase + '.json'));
  if (process.platform === 'darwin') return keychainStore({ account });
  if (process.platform === 'win32') return protectedFileStore(path.join(PROJECT_ROOT, fileBase + '.dat'));
  return plainFileStore(path.join(PROJECT_ROOT, fileBase + '.json'));
}

// ── Reading and saving, with a cache ──
//
// settings.read() runs often, and a keychain or PowerShell call is far from
// free (PowerShell takes most of a second to start). So the secrets are read
// once per process and again only when settings.json's savedSecrets stamp
// says another process changed them.

let cache = null; // { stamp, values }
const stampOf = saved => JSON.stringify(saved || {});

/** The secrets the stamp says are saved. Throws if the store can't be read. */
function load(saved) {
  // No savedSecrets doesn't mean nothing is saved: settings.json may have
  // been replaced (restored from a backup, written by hand). So the store is
  // asked anyway, once per process for that stamp.
  const stamp = stampOf(saved);
  if (cache && cache.stamp === stamp) return cache.values;
  const values = store().load();
  cache = { stamp, values };
  return values;
}

/**
 * Saves `changes` ({ key: value }, '' removes one) on top of what's saved,
 * and returns the new savedSecrets for settings.json. Throws when the store
 * can't be read or written: the caller refuses the save instead of losing a
 * key or falling back to plain text.
 */
function save(saved, changes) {
  const current = { ...load(saved) };
  for (const [key, value] of Object.entries(changes)) {
    if (!NAMES.includes(key)) continue;
    const v = String(value || '').trim();
    if (v) current[key] = v; else delete current[key];
  }
  store().save(current);
  const next = {};
  for (const key of NAMES) if (current[key]) next[key] = fingerprint(current[key]);
  cache = { stamp: stampOf(next), values: current };
  return next;
}

module.exports = {
  KEYS, NAMES, SERVICE, SAVED_MARK, load, save, fingerprint, store, itemStore, keychainStore, protectedFile, protectedFileStore, plainFileStore, dpapi,
  _setStore(s) { storeOverride = s; cache = null; },
};
