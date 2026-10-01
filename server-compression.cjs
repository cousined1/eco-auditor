'use strict';

/**
 * Response compression (moved from server.cjs for F-G-18, so it can be tested
 * without booting the server).
 *
 * Nothing upstream compresses: Railway's proxy passes the origin body through,
 * and express.static has no compression of its own, so the entry bundle was
 * going out at its full 496KB instead of ~121KB. That is the single largest
 * contributor to LCP on a cold mobile load.
 *
 * zlib is stdlib, so this adds no dependency. It wraps write/end rather than
 * piping a stream so that Content-Length is replaced correctly and the
 * already-set security headers survive. Skips: clients that did not ask for
 * gzip, HEAD/304 (no body), Range requests (byte offsets refer to the
 * uncompressed entity — the video route serves those), and payloads that are
 * already compressed (images, fonts, video, .gz/.br).
 *
 * What F-G-18 found and this fixes: gzip;q=0 still got gzip (the header was
 * matched with a regex), write() always returned true so a piped source was
 * buffered whatever the client's speed, and the gzip stream had no 'error'
 * listener, so a zlib error was an uncaught exception and a process exit. The
 * `compression` package does all of this too; switching to it is an owner option
 * (a new dependency).
 */

const zlib = require('node:zlib');

const COMPRESSIBLE = /^(?:text\/|application\/(?:javascript|json|xml|manifest\+json)|image\/svg\+xml)/i;
const COMPRESSION_THRESHOLD = 1024; // below this, gzip framing costs more than it saves

function parseQuality(params) {
  let quality = 1;
  params.forEach(function (param) {
    const match = /^\s*q\s*=(.*)$/i.exec(param);
    if (match) quality = Number(match[1].trim());
  });
  if (!Number.isFinite(quality) || quality < 0) return 0;
  return Math.min(quality, 1);
}

/**
 * True when Accept-Encoding makes gzip acceptable and not less preferred than
 * an uncompressed response (RFC 9110 section 12.5.3):
 *   - q-values count: "gzip;q=0" refuses gzip, a malformed q counts as 0
 *   - "gzip;q=0.5, identity" prefers the uncompressed response
 *   - "*" stands for gzip when gzip is not named, and for identity likewise
 *   - identity not named at all takes the lowest q of the listed codings, the
 *     rule the negotiator package (used by `compression`) applies
 */
function acceptsGzip(header) {
  const qualities = new Map();
  String(header || '').split(',').forEach(function (part) {
    const pieces = part.split(';');
    const coding = pieces[0].trim().toLowerCase();
    if (coding) qualities.set(coding, parseQuality(pieces.slice(1)));
  });

  const named = function (coding) {
    if (qualities.has(coding)) return qualities.get(coding);
    return qualities.has('*') ? qualities.get('*') : undefined;
  };
  const gzip = qualities.has('gzip') ? qualities.get('gzip') : qualities.has('x-gzip') ? qualities.get('x-gzip') : named('gzip');
  if (!(gzip > 0)) return false;
  let identity = named('identity');
  if (identity === undefined) identity = Math.min.apply(null, Array.from(qualities.values()));
  return gzip >= identity;
}

function toBuffer(chunk, encoding) {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8');
  return Buffer.from(chunk);
}

/**
 * deps.log         server.cjs log()
 * deps.createGzip  () => a zlib gzip stream; injectable for tests
 */
function createCompression(deps) {
  const log = deps.log;
  const createGzip = deps.createGzip || function () { return zlib.createGzip({ level: 6 }); };

  return function compressResponse(req, res, next) {
    if (req.method === 'HEAD' || req.headers.range || !acceptsGzip(req.headers['accept-encoding'])) return next();

    const originalWrite = res.write;
    const originalEnd = res.end;
    let gzip = null;

    function start() {
      if (gzip !== null) return gzip;
      const type = String(res.getHeader('Content-Type') || '');
      const length = Number(res.getHeader('Content-Length') || 0);
      const encoded = res.getHeader('Content-Encoding');
      if (
        res.statusCode === 204 ||
        res.statusCode === 304 ||
        encoded ||
        !COMPRESSIBLE.test(type) ||
        (length && length < COMPRESSION_THRESHOLD)
      ) {
        gzip = false;
        return gzip;
      }
      res.setHeader('Content-Encoding', 'gzip');
      // Length changes, and caches must not serve one encoding for the other.
      res.removeHeader('Content-Length');
      res.setHeader('Vary', res.getHeader('Vary') ? res.getHeader('Vary') + ', Accept-Encoding' : 'Accept-Encoding');
      gzip = createGzip();
      gzip.on('data', function (chunk) {
        // The socket buffer is full: stop compressing until it drains.
        if (originalWrite.call(res, chunk) === false) gzip.pause();
      });
      gzip.on('end', function () { originalEnd.call(res); });
      // res.write() answers with gzip.write()'s result, so a source piped into the
      // response waits for 'drain': it has to come when the gzip buffer drains too,
      // not only when the socket does, or the source would wait forever.
      gzip.on('drain', function () { res.emit('drain'); });
      gzip.on('error', function (err) {
        // Only this response is lost: cut it so the client sees a failed request
        // instead of a truncated body that looks complete.
        log('error', 'Response compression failed', { error: err });
        res.destroy();
      });
      return gzip;
    }

    // The socket drained: let the compressor push again.
    res.on('drain', function () { if (gzip) gzip.resume(); });

    res.write = function (chunk, encoding, callback) {
      if (typeof encoding === 'function') {
        callback = encoding;
        encoding = undefined;
      }
      const stream = start();
      if (stream === false) return originalWrite.call(res, chunk, encoding, callback);
      if (chunk === undefined || chunk === null || chunk.length === 0) {
        if (typeof callback === 'function') process.nextTick(callback);
        return true;
      }
      return stream.write(toBuffer(chunk, encoding), callback);
    };

    res.end = function (chunk, encoding, callback) {
      if (typeof chunk === 'function') {
        callback = chunk;
        chunk = undefined;
      } else if (typeof encoding === 'function') {
        callback = encoding;
        encoding = undefined;
      }
      const stream = start();
      if (stream === false) return originalEnd.call(res, chunk, encoding, callback);
      if (chunk !== undefined && chunk !== null && chunk.length) stream.write(toBuffer(chunk, encoding));
      stream.end();
      if (typeof callback === 'function') res.once('finish', callback);
      return res;
    };

    next();
  };
}

module.exports = {
  acceptsGzip,
  createCompression,
  COMPRESSIBLE,
  COMPRESSION_THRESHOLD,
};
