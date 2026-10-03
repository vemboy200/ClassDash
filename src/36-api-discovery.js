/**
 * Announces the home API on the home network (mDNS / Bonjour), so Home
 * Assistant can find it without anyone typing an address, and follow it
 * when the computer's address changes.
 *
 * Only while the API is open to the network (--network): in "this computer
 * only" mode there's nothing another device could reach, so nothing is
 * announced. 17-api.js starts this once the server is listening and stops
 * it when the server stops.
 *
 * What goes out: the service `_classdash._tcp` named "ClassDash on <this
 * computer's name>", its port, the addresses, and in the TXT record the
 * certificate fingerprint (`fp`, the same value a client pins; not a
 * secret, any client is shown it on connecting) and `api` (1). Never the
 * token, and nothing about the student: the computer's name is already
 * announced by the system itself.
 *
 * The addresses are its own name (classdash-<computer>.local), not the
 * system's: the system's own mDNS answers for its name, and two answerers
 * for one name could disagree. A record holds the addresses from when it
 * was published, so a change of address (a new network, a new DHCP lease)
 * re-announces it with the new ones.
 *
 * The library (bonjour-service) is loaded only here and only when needed,
 * and anything going wrong just means no announcement: the API itself
 * never depends on it.
 */
const os = require('os');

const SERVICE_TYPE = 'classdash';
const ADDRESS_CHECK_MS = 60 * 1000;

/** This computer's name, short (no ".local", no domain). */
function computerName() {
  return os.hostname().replace(/\.local\.?$/i, '').split('.')[0] || 'computer';
}

/** The name the addresses are announced under: classdash-<computer>.local. */
function hostFor(name = computerName()) {
  const label = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return `classdash-${label || 'computer'}.local`;
}

/** The IPv4 addresses other devices could reach, as one comparable string. */
function addressKey() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => i.address).sort().join(',');
}

/**
 * Starts announcing. Returns { stop(callback) }; stop sends the "gone"
 * announcement before calling back. `log` gets one line per event.
 * `deps.Bonjour` is for tests.
 */
function advertise({ port, fingerprint, log = () => {} }, deps = {}) {
  let Bonjour = deps.Bonjour;
  if (!Bonjour) {
    try {
      ({ Bonjour } = require('bonjour-service'));
    } catch (e) {
      log(`not announcing on the network (bonjour-service missing: ${e.message})`);
      return { stop: cb => cb && cb() };
    }
  }

  const name = `ClassDash on ${computerName()}`;
  const host = hostFor();
  let bonjour = null;
  let lastAddresses = null;
  let stopped = false;

  const publish = () => {
    lastAddresses = addressKey();
    try {
      bonjour = new Bonjour({}, (e) => log(`network announcement error: ${e.message}`));
      const service = bonjour.publish({
        name, host, port, type: SERVICE_TYPE, protocol: 'tcp', disableIPv6: true,
        txt: { api: '1', ...(fingerprint ? { fp: fingerprint } : {}) },
      });
      service.on('error', e => log(`network announcement error: ${e.message}`));
      log(`announced on the network as "${name}" (_${SERVICE_TYPE}._tcp, ${host}:${port})`);
    } catch (e) {
      log(`not announcing on the network: ${e.message}`);
      bonjour = null;
    }
  };

  const unpublish = (cb) => {
    const b = bonjour;
    bonjour = null;
    if (!b) return cb();
    let done = false;
    const finish = () => { if (done) return; done = true; try { b.destroy(); } catch {} cb(); };
    // The goodbye packet usually goes out at once; don't hang on it.
    setTimeout(finish, 1000).unref();
    try { b.unpublishAll(finish); } catch { finish(); }
  };

  publish();
  const timer = setInterval(() => {
    if (stopped || addressKey() === lastAddresses) return;
    log('network addresses changed, announcing again');
    unpublish(() => { if (!stopped) publish(); });
  }, deps.addressCheckMs || ADDRESS_CHECK_MS);
  timer.unref();

  return {
    stop(cb) {
      stopped = true;
      clearInterval(timer);
      unpublish(() => cb && cb());
    },
  };
}

module.exports = { SERVICE_TYPE, advertise, computerName, hostFor, addressKey };
