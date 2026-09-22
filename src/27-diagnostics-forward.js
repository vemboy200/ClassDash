/**
 * Diagnostics forwarding — a development aid, off by default.
 *
 * Meant for exactly the situation this project keeps running into:
 * a real tester on a real machine hits something that only reproduces
 * on their computer, and the only view into what actually happened is
 * whatever they can describe or screenshot. When diagnosticsForwardUrl
 * and diagnosticsForwardToken are set in settings.json, install()
 * patches this process's own console.log/warn/error so every line also
 * gets POSTed to another computer's Home API — the exact same server
 * 17-api.js already runs, hitting its /api/diagnostics/logs write
 * handle, authenticated exactly like any other request that API
 * accepts (see 17-api.js: isAuthorized() runs before every handle,
 * this one included — nothing special-cased). Point a tester's install
 * at a developer's own running ClassDash, and its console output starts
 * showing up there live, without needing screen access to the tester's
 * machine at all.
 *
 * Empty URL (the default) — install() does nothing at all, not even
 * read the rest of settings. This is never on by accident.
 *
 * Fire-and-forget, always: a failed or slow forward can never be the
 * reason anything else breaks or stalls. The original console output
 * still happens first, unconditionally, exactly as it always did —
 * this only ever adds a side effect, never replaces the real one.
 */

const https = require('https');
const os = require('os');

function safeStringify(x) {
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

function install() {
  const settings = require('./19-settings.js').read();
  const url = (settings.diagnosticsForwardUrl || '').trim();
  if (!url) return;
  const token = settings.diagnosticsForwardToken || '';

  let target;
  try {
    target = new URL('/api/diagnostics/logs', url);
  } catch {
    // A broken URL in a dev-only setting shouldn't crash the very
    // process it's meant to help debug.
    return;
  }

  const hostname = os.hostname();

  const send = (level, args) => {
    const line = args
      .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
      .join(' ');
    const payload = JSON.stringify({
      source: hostname, level, line, at: new Date().toISOString(),
    });
    let req;
    try {
      req = https.request(target, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: `Bearer ${token}`,
        },
        // The receiving computer's own cert is self-signed — there's no
        // real CA for a private home address (see 17-api.js's own
        // header comment on this exact point). Pinning the fingerprint
        // here would need a third dev-only setting just for that; not
        // worth it for a feature that only ever runs against a URL a
        // developer typed in themselves, never on by default.
        rejectUnauthorized: false,
        timeout: 5000,
      }, (res) => { res.resume(); });
    } catch {
      return;
    }
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.write(payload);
    req.end();
  };

  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      try { send(level, args); } catch { /* never let this break real logging */ }
    };
  }
}

module.exports = { install };
