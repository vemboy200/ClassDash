/**
 * Compresses what the server sends to other devices. Worth it over a network
 * (the page shrinks from about 1 MB to about 170 KB), pointless to the app and
 * browsers on this computer, which are skipped so they cost nothing.
 *
 * Only the server's own files and answers go through this, never anything that
 * repeats what a request said back into a page with the access key in it, so
 * compressing over TLS doesn't give an attacker a way to guess the key from
 * response sizes (the BREACH attack). The cookie is SameSite=Strict as well.
 */
const zlib = require('zlib');

const SMALLEST = 1024;                // smaller answers can grow, and save nothing
const CACHED_FROM = 64 * 1024;        // only big bodies are worth keeping
const MOST_CACHED = 4;                // the page, and a paired device's copy of it
const cache = [];

function isThisComputer(req) {
  const address = (req.socket && req.socket.remoteAddress) || '';
  return address === '::1' || /^(::ffff:)?127\./.test(address);
}

/** Whether this client asked for gzip, and isn't on this computer. */
function wantsCompression(req) {
  if (isThisComputer(req)) return false;
  const accepted = String(req.headers['accept-encoding'] || '');
  return accepted.split(',').some(part => {
    const [name, ...options] = part.trim().toLowerCase().split(';');
    if (name.trim() !== 'gzip') return false;
    return !options.some(o => /^\s*q\s*=\s*0(\.0*)?\s*$/.test(o));
  });
}

function gzip(body, done) {
  const known = body.length >= CACHED_FROM && cache.find(c => c.body.equals(body));
  if (known) return done(null, known.compressed);
  zlib.gzip(body, (err, compressed) => {
    if (!err && body.length >= CACHED_FROM) {
      cache.unshift({ body, compressed });
      cache.length = Math.min(cache.length, MOST_CACHED);
    }
    done(err, compressed);
  });
}

/** Ends the response with this body, compressed if that's worth doing. */
function sendBody(req, res, status, body) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.setHeader('Vary', 'Accept-Encoding');
  if (data.length < SMALLEST || !wantsCompression(req)) return res.writeHead(status).end(data);
  gzip(data, (err, compressed) => {
    if (err) return res.writeHead(status).end(data);
    res.setHeader('Content-Encoding', 'gzip');
    res.writeHead(status).end(compressed);
  });
}

/**
 * A push stream's writer. Each connection has to have its own compressor, since
 * what it can shrink depends on what that connection has already been sent, and
 * every event is flushed so it arrives right away.
 *
 * Only for a browser (signed in by cookie). Other programs like Home Assistant
 * hold a stream open for days and were written against a plain one.
 */
function streamWriter(req, res) {
  if (req.headers.authorization || !wantsCompression(req)) return { write: text => res.write(text), close() {} };
  res.setHeader('Content-Encoding', 'gzip');
  const compressor = zlib.createGzip();
  compressor.on('error', () => {});
  compressor.pipe(res);
  return {
    write(text) {
      if (compressor.destroyed) return;
      compressor.write(text);
      compressor.flush(zlib.constants.Z_SYNC_FLUSH);
    },
    close() { compressor.destroy(); },
  };
}

module.exports = { sendBody, streamWriter, wantsCompression };
