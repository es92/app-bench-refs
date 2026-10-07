'use strict';
// Fetching a feed from a stranger's server, carefully.
//
// The address comes from whoever typed it, and the request leaves from this
// app's container, so the fetch is fenced in:
// - http and https only, no credentials in the URL;
// - never a private, loopback, link-local or metadata address, checked on
//   the address the connection actually uses (a custom DNS lookup), so a
//   name that resolves inward is refused as well as a literal IP;
// - redirects followed by hand, each hop checked the same way;
// - a time limit and a size limit, gzip/deflate/brotli decoded within it.
// Errors carry a short sentence a person can act on (`err.userMessage`).

const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const zlib = require('zlib');

const TIMEOUT_MS = 10000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'RSSReader/1.0 (Homeroom app; feed fetcher)';
const ACCEPT = 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.7, */*;q=0.5';

function userError(message, code) {
  const err = new Error(message);
  err.userMessage = message;
  if (code) err.code = code;
  return err;
}

function ipv4Private(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && p[2] === 0)
    || (a === 198 && (b === 18 || b === 19));
}

/** Whether an address is one this app must never fetch from. */
function isPrivateAddress(address) {
  const ip = String(address || '').replace(/^\[|\]$/g, '').toLowerCase();
  const kind = net.isIP(ip);
  if (kind === 4) return ipv4Private(ip);
  if (kind !== 6) return true;
  if (ip === '::' || ip === '::1') return true;
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(ip)) return true;
  if (/^64:ff9b:/.test(ip)) return true;
  const first = parseInt(ip.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 // unique local fc00::/7
    || (first & 0xffc0) === 0xfe80 // link-local fe80::/10
    || (first & 0xff00) === 0xff00; // multicast
}

// DNS lookup that only ever hands the socket a public address.
function guardedLookup(hostname, options, callback) {
  const opts = typeof options === 'object' && options ? options : { family: options || 0 };
  dns.lookup(hostname, { all: true, family: opts.family || 0, hints: opts.hints }, (err, addresses) => {
    if (err) return callback(err);
    const allowed = (addresses || []).filter((a) => !isPrivateAddress(a.address));
    if (!allowed.length) return callback(userError('That address points to a private network, so it can\'t be added.', 'EBLOCKED'));
    if (opts.all) return callback(null, allowed);
    return callback(null, allowed[0].address, allowed[0].family);
  });
}

function checkUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw userError('That doesn\'t look like a web address.', 'EBADURL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw userError('Only http and https addresses can be followed.', 'EBADURL');
  if (url.username || url.password) throw userError('Addresses with a username or password can\'t be added.', 'EBADURL');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw userError('That address points to a private network, so it can\'t be added.', 'EBLOCKED');
  }
  if (net.isIP(host) && isPrivateAddress(host)) {
    throw userError('That address points to a private network, so it can\'t be added.', 'EBLOCKED');
  }
  return url;
}

function friendly(err) {
  if (err && err.userMessage) return err;
  const code = err && err.code;
  let message = 'We couldn\'t reach that website. Try again later.';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') message = 'We couldn\'t find that website. Check the address for typos.';
  else if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') message = 'The website took too long to answer. Try again later.';
  else if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EPIPE') message = 'The website refused the connection. Try again later.';
  else if (code && /CERT|SSL|TLS/i.test(code)) message = 'The website\'s security certificate isn\'t valid, so we didn\'t connect.';
  const wrapped = userError(message, code);
  wrapped.cause = err;
  return wrapped;
}

function decompress(res) {
  const enc = String(res.headers['content-encoding'] || '').trim().toLowerCase();
  if (enc === 'gzip' || enc === 'x-gzip') return res.pipe(zlib.createGunzip());
  if (enc === 'deflate') return res.pipe(zlib.createInflate());
  if (enc === 'br') return res.pipe(zlib.createBrotliDecompress());
  return res;
}

function requestOnce(url, headers, deadline) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const remaining = Math.max(1000, deadline - Date.now());
    const req = lib.request(url, {
      method: 'GET',
      headers: {
        'user-agent': USER_AGENT,
        accept: ACCEPT,
        'accept-encoding': 'gzip, deflate, br',
        ...headers,
      },
      lookup: guardedLookup,
      timeout: remaining,
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        resolve({ status, location: res.headers.location, headers: res.headers });
        return;
      }
      if (status === 304 || status < 200 || status >= 300) {
        res.resume();
        resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
        return;
      }
      const declared = Number(res.headers['content-length']);
      if (declared && declared > MAX_BYTES) {
        res.destroy();
        reject(userError('That page is too large to be a feed.', 'ETOOBIG'));
        return;
      }
      const stream = decompress(res);
      const chunks = [];
      let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          stream.destroy();
          res.destroy();
          reject(userError('That page is too large to be a feed.', 'ETOOBIG'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
      stream.on('error', (err) => reject(friendly(err)));
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })), remaining);
    timer.unref();
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', (err) => reject(friendly(err)));
    req.on('close', () => clearTimeout(timer));
    req.end();
  });
}

function charsetOf(contentType, body) {
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType || '');
  if (fromHeader) return fromHeader[1];
  const head = body.subarray(0, 1024).toString('latin1');
  const fromXml = /<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head);
  if (fromXml) return fromXml[1];
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head);
  if (fromMeta) return fromMeta[1];
  return 'utf-8';
}

function decode(body, contentType) {
  let label = charsetOf(contentType, body);
  let decoder;
  try { decoder = new TextDecoder(label); } catch { label = 'utf-8'; decoder = new TextDecoder('utf-8'); }
  return decoder.decode(body).replace(/^\uFEFF/, '');
}

/**
 * GET `raw`, following redirects. Resolves to
 * { status, url (final), contentType, text, etag, lastModified }; a 304 has
 * status 304 and no text. Rejects with an error carrying `userMessage`.
 */
async function fetchText(raw, { etag, lastModified } = {}) {
  const deadline = Date.now() + TIMEOUT_MS;
  let url = checkUrl(raw);
  const conditional = {};
  if (etag) conditional['if-none-match'] = etag;
  if (lastModified) conditional['if-modified-since'] = lastModified;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await requestOnce(url, hop === 0 ? conditional : {}, deadline);
    if (res.location) {
      let next;
      try { next = new URL(res.location, url); } catch { throw userError('The website sent us to an address that doesn\'t work.', 'EBADREDIRECT'); }
      url = checkUrl(next.toString());
      continue;
    }
    if (res.status === 304) return { status: 304, url: url.toString() };
    if (res.status === 404 || res.status === 410) throw userError(`The website says that page doesn't exist (${res.status}).`, 'EHTTP');
    if (res.status === 401 || res.status === 403) throw userError(`The website refused the request (${res.status}). The feed may be private.`, 'EHTTP');
    if (res.status === 429) throw userError('The website asked us to slow down. Try again later.', 'EHTTP');
    if (res.status < 200 || res.status >= 300) throw userError(`The website answered with an error (${res.status}). Try again later.`, 'EHTTP');
    const contentType = String(res.headers['content-type'] || '');
    return {
      status: res.status,
      url: url.toString(),
      contentType,
      text: decode(res.body, contentType),
      etag: res.headers.etag || null,
      lastModified: res.headers['last-modified'] || null,
    };
  }
  throw userError('The website redirected too many times.', 'EREDIRECTS');
}

module.exports = { fetchText, isPrivateAddress, checkUrl, userError };
