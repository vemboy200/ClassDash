/**
 * The follower's side of sync (see 58-sync.js), running inside its server: finds
 * the master, listens for changes, and copies them down.
 *
 * ── Finding the master ──
 *
 * There can be two addresses, one at home and one through a tunnel, and no way to
 * know ahead of time which works here, so both are tried: the home one gets a
 * small head start, since it's faster when it works. The home address is the last
 * one that worked, or whatever the network announces with this master's
 * certificate fingerprint (36-api-discovery.js), which follows it when its address
 * changes. While on the tunnel, the home address keeps being tried, and seeing the
 * announcement tries it right away.
 *
 * ── Noticing it's gone ──
 *
 * The master says something on the stream at least every 20 seconds, so a
 * connection that hangs instead of dropping (a laptop changing networks) is
 * noticed after STREAM_QUIET_MS, not whenever the system gets around to it.
 */
const https = require('https');
const { URL } = require('url');
const sync = require('./58-sync.js');
const { SERVICE_TYPE, reachable } = require('./36-api-discovery.js');

const LOCAL_HEAD_START_MS = 300;
const STREAM_QUIET_MS = 50 * 1000;
const RETRY_FIRST_MS = 3 * 1000;
const RETRY_MOST_MS = 60 * 1000;
const NOT_FOLLOWING_MS = 3 * 1000;
const TRY_LOCAL_EVERY_MS = 60 * 1000;

const sleep = (ms, signal) => new Promise(resolve => {
  const timer = setTimeout(resolve, ms);
  if (signal) signal.wake = () => { clearTimeout(timer); resolve(); };
});

/** Listens for this master's announcement on the network. */
function watchNetwork(fp, onFound, log, Bonjour) {
  if (!Bonjour) {
    try { ({ Bonjour } = require('bonjour-service')); } catch (e) { log(`sync: not looking on the network (${e.message})`); return { stop() {}, look() {} }; }
  }
  let bonjour, browser;
  const seen = service => {
    if (!service || !service.txt || service.txt.fp !== fp) return;
    const address = (service.addresses || []).find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a) && reachable(a));
    if (address && service.port) onFound(`https://${address}:${service.port}`);
  };
  try {
    bonjour = new Bonjour({}, e => log(`sync: network search error: ${e.message}`));
    browser = bonjour.find({ type: SERVICE_TYPE, protocol: 'tcp' }, seen);
  } catch (e) {
    log(`sync: not looking on the network (${e.message})`);
  }
  return {
    look() { try { browser && browser.update(); } catch {} },
    stop() { try { bonjour && bonjour.destroy(); } catch {} },
  };
}

/** Lists the ClassDash servers nearby, for choosing one to pair with. */
function findNearby(ownFingerprint, ms = 1500, Bonjour) {
  return new Promise(resolve => {
    if (!Bonjour) {
      try { ({ Bonjour } = require('bonjour-service')); } catch { return resolve([]); }
    }
    const found = new Map();
    let bonjour;
    const finish = () => {
      try { bonjour && bonjour.destroy(); } catch {}
      resolve([...found.values()]);
    };
    try {
      bonjour = new Bonjour({}, () => {});
      bonjour.find({ type: SERVICE_TYPE, protocol: 'tcp' }, service => {
        const fp = service.txt && service.txt.fp;
        const address = (service.addresses || []).find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a) && reachable(a));
        if (!fp || fp === ownFingerprint || !address || !service.port) return;
        found.set(fp, { name: String(service.name || '').replace(/^ClassDash on /, ''), url: `https://${address}:${service.port}`, fp });
      });
    } catch { return finish(); }
    setTimeout(finish, ms);
  });
}

/** Whether this address is this master, by what it says. Answers the route, or
 *  throws. A tunnel can't be recognized by its certificate, so this is the check
 *  there; at home the certificate has already been checked by the time it answers. */
async function tryRoute(route, m) {
  const hello = await sync.requestJson(route, m, '/api/sync/hello', { timeout: 8000 });
  if (hello.fingerprint !== m.fp) throw new Error('a different ClassDash answers there');
  return { ...route, hello };
}

/** The fastest way to the master right now, or throws. Removed-from-the-master
 *  wins over the other way simply not answering. */
async function findRoute(m, seenUrl) {
  const local = [...new Set([seenUrl, m.localUrl].filter(Boolean))].map(url => ({ url, kind: 'local' }));
  const attempts = local.map(route => tryRoute(route, m));
  if (m.remoteUrl) {
    attempts.push((async () => {
      if (local.length) await sleep(LOCAL_HEAD_START_MS);
      return tryRoute({ url: m.remoteUrl, kind: 'remote' }, m);
    })());
  }
  if (!attempts.length) throw new Error('no address for the master yet');
  try {
    return await Promise.any(attempts);
  } catch (all) {
    const removed = all.errors.find(e => e.removed);
    throw removed || all.errors[0];
  }
}

/** Opens the master's stream, calling onChange for what it announces. Resolves
 *  when the stream ends, for whatever reason. Answers {stop} through `control`. */
function listen(route, m, onChange, control) {
  return new Promise(resolve => {
    let quiet;
    const done = reason => { clearTimeout(quiet); try { req.destroy(); } catch {} resolve(reason); };
    const stay = () => { clearTimeout(quiet); quiet = setTimeout(() => done('went quiet'), STREAM_QUIET_MS); };
    const req = https.request(new URL('/api/sync/stream', route.url), {
      agent: false,
      headers: { Authorization: `Bearer ${m.key}`, Accept: 'text/event-stream' },
      ...sync.tlsOptions(route, m),
    }, res => {
      if (res.statusCode !== 200) return done(`answered ${res.statusCode}`);
      stay();
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        stay();
        text += chunk;
        let end;
        while ((end = text.indexOf('\n\n')) !== -1) {
          const event = text.slice(0, end);
          text = text.slice(end + 2);
          const name = (/^event: (.*)$/m.exec(event) || [])[1];
          if (name !== 'changed') continue;
          try { onChange(JSON.parse((/^data: (.*)$/m.exec(event) || [])[1]).version); } catch { /* a broken line isn't worth dropping for */ }
        }
      });
      res.on('end', () => done('ended'));
      res.on('error', () => done('broke'));
    });
    req.on('error', e => done(e.message));
    req.end();
    control.stop = reason => done(reason);
  });
}

/**
 * Runs for as long as the server does. `applied(count)` is called after anything
 * was copied. `busy()` says a check is running here, whose files shouldn't be
 * swapped underneath it; the copy is retried once it's done.
 */
function startFollowing({ applied = () => {}, busy = () => false, log = () => {}, Bonjour } = {}) {
  let stopped = false;
  let network = null;
  let networkFp = null;
  let seenUrl = null;
  const wake = {};
  const control = {};
  let current = null;
  let lastSync = null;
  let statusTimer = null;

  const setStatus = fields => {
    current = { ...current, ...fields };
    try { sync.writeStatus({ ...current, lastSync }); } catch (e) { log(`sync: could not write status: ${e.message}`); }
  };

  const stopNetwork = () => { if (network) network.stop(); network = null; networkFp = null; };

  /** Copies what changed. One at a time: a change arriving during a copy just
   *  means another round after it. */
  const makePuller = (route, m) => {
    let running = false, again = false;
    const pull = async () => {
      if (running) { again = true; return; }
      running = true;
      try {
        do {
          again = false;
          if (busy()) { await sleep(5000); again = true; continue; }
          setStatus({ state: 'syncing' });
          await sync.replayQueue(route, m, log);
          const theirs = await sync.requestJson(route, m, '/api/sync/manifest');
          const changed = await sync.applyManifest(theirs, async name => {
            const r = await sync.request(route, m, `/api/sync/file?name=${encodeURIComponent(name)}`, { timeout: 60 * 1000 });
            if (r.status !== 200) throw new Error(`could not copy ${name} (${r.status})`);
            return r.body;
          });
          lastSync = Date.now();
          setStatus({ state: 'synced' });
          if (changed) { log(`sync: ${changed} changed`); try { applied(changed); } catch (e) { log(`sync: after copying: ${e.message}`); } }
        } while (again && !stopped);
      } catch (e) {
        if (e.tryAgain) {
          setTimeout(pull, 1000).unref();
        } else {
          log(`sync: copy failed: ${e.message}`);
          if (control.stop) control.stop('copy failed');
        }
      } finally {
        running = false;
      }
    };
    return pull;
  };

  const run = async () => {
    let retry = RETRY_FIRST_MS;
    while (!stopped) {
      const m = sync.master();
      if (!m) {
        stopNetwork();
        current = null;
        lastSync = null;
        seenUrl = null;
        await sleep(NOT_FOLLOWING_MS, wake);
        continue;
      }
      if (networkFp !== m.fp) {
        stopNetwork();
        networkFp = m.fp;
        network = watchNetwork(m.fp, url => {
          if (url === seenUrl) return;
          seenUrl = url;
          // Found at home again: a wait for a retry, or being on the tunnel, ends.
          if (wake.wake) wake.wake();
          if (control.onLocal) control.onLocal();
        }, log, Bonjour);
      }
      lastSync = lastSync || (sync.readStatus() || {}).lastSync || null;
      let route;
      try {
        route = await findRoute(m, seenUrl);
      } catch (e) {
        setStatus(e.removed ? { state: 'removed', via: null, url: null } : { state: 'cutOff', via: null, url: null });
        if (network) network.look();
        await sleep(retry, wake);
        retry = Math.min(retry * 2, RETRY_MOST_MS);
        continue;
      }
      retry = RETRY_FIRST_MS;
      if (route.hello.account && m.account && route.hello.account !== m.account) {
        // The master signed into someone else since pairing: nothing more is copied.
        setStatus({ state: 'otherAccount', via: null, url: null });
        await sleep(RETRY_MOST_MS, wake);
        continue;
      }
      if (route.kind === 'local' && route.url !== m.localUrl) {
        const saved = sync.readSync();
        if (saved.master && saved.master.fp === m.fp) { saved.master.localUrl = route.url; sync.writeSync(saved); }
      }
      log(`sync: connected to ${m.name} (${route.kind})`);
      setStatus({ state: 'syncing', via: route.kind, url: route.url });
      const pull = makePuller(route, m);
      statusTimer = setInterval(() => {
        if (!sync.master()) return control.stop && control.stop('stopped following');
        setStatus({});
      }, sync.STATUS_EVERY_MS);
      statusTimer.unref();
      // On the tunnel, keep trying for home.
      let homeTimer = null;
      if (route.kind === 'remote') {
        const tryHome = async () => {
          if (network) network.look();
          const home = [...new Set([seenUrl, m.localUrl].filter(Boolean))];
          for (const url of home) {
            try {
              await tryRoute({ url, kind: 'local' }, m);
              if (control.stop) control.stop('back home');
              return;
            } catch { /* not here */ }
          }
        };
        control.onLocal = tryHome;
        homeTimer = setInterval(tryHome, TRY_LOCAL_EVERY_MS);
        homeTimer.unref();
      }
      const listening = listen(route, m, () => pull(), control);
      pull();
      const why = await listening;
      clearInterval(statusTimer);
      clearInterval(homeTimer);
      control.onLocal = null;
      control.stop = null;
      log(`sync: connection to ${m.name} closed (${why})`);
      if (sync.master()) setStatus({ state: 'cutOff', via: null, url: null });
      if (why !== 'back home' && !stopped) await sleep(RETRY_FIRST_MS, wake);
    }
    stopNetwork();
  };
  run().catch(e => log(`sync: stopped unexpectedly: ${e.stack || e.message}`));

  return {
    /** Something changed about the connection: look again now. */
    wake() { if (wake.wake) wake.wake(); },
    stop() { stopped = true; if (control.stop) control.stop('stopping'); if (wake.wake) wake.wake(); stopNetwork(); },
  };
}

module.exports = { startFollowing, findNearby, findRoute };
