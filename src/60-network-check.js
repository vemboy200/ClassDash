/**
 * Whether there's any internet to check with, asked before a check opens a browser.
 *
 * Without this, a check on no connection or a bad one (school Wi-Fi, say) sat on
 * "starting" for minutes, since the first steps wait on pages that may never answer.
 *
 * Errs on the side of going ahead: only not reaching a place at all counts. Any
 * answer does, even an error or a certificate this can't check, because a school's
 * filter can answer in ways the browser copes with, and the check itself then
 * reports whatever's really wrong.
 */
const http = require('http');
const https = require('https');

const NO_INTERNET = 'no internet connection';
const NOT_REACHED = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETDOWN', 'EADDRNOTAVAIL']);

function reaches(url, timeoutMs) {
  return new Promise(resolve => {
    let req;
    try {
      req = (String(url).startsWith('http:') ? http : https).request(url, { method: 'GET', agent: false, rejectUnauthorized: false }, res => {
        // The answer starting is all this needs, so the rest isn't fetched.
        resolve(true);
        res.destroy();
      });
    } catch { return resolve(true); }
    req.setTimeout(timeoutMs, () => { req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })); });
    req.on('error', e => resolve(!NOT_REACHED.has(e.code)));
    req.end();
  });
}

/** True as soon as any of these answers, trying twice. */
async function online(urls, { timeoutMs = 5000, tries = 2 } = {}) {
  for (let i = 0; i < tries; i++) {
    const answers = urls.map(url => reaches(url, timeoutMs).then(yes => (yes ? true : Promise.reject(new Error('no')))));
    try { await Promise.any(answers); return true; } catch { /* none answered */ }
  }
  return false;
}

/** Whether what a check recorded means the network, not the service: said so
 *  above, or the browser's or Node's own words for it from partway through. */
function isNetworkProblem(detail) {
  return String(detail || '').includes(NO_INTERNET)
    || /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE|NETWORK_CHANGED|CONNECTION_TIMED_OUT)|ENOTFOUND|ENETUNREACH|EAI_AGAIN/.test(String(detail || ''));
}

module.exports = { NO_INTERNET, online, reaches, isNetworkProblem };
