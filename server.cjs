const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ─── Stripe SDK (lazy init) ───
let stripe = null;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
if (STRIPE_SECRET_KEY) {
  try {
    const Stripe = require('stripe');
    stripe = new Stripe(STRIPE_SECRET_KEY);
  } catch (err) {
    // stripe package not installed — billing routes will return 503
  }
}

const app = express();
const PORT = process.env.PORT;

if (!PORT) {
  console.error(JSON.stringify({ level: 'error', timestamp: new Date().toISOString(), message: 'PORT environment variable is required' }));
  process.exit(1);
}

// ─── Security headers ───
app.use(function (_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ─── Rate limiting (sliding window, in-memory) ───
const rateLimitWindowMs = 60_000;
const rateLimitMax = 120;
const rateLimitStore = new Map();

app.use(function (req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now - entry.windowStart > rateLimitWindowMs) {
    rateLimitStore.set(key, { windowStart: now, count: 1 });
    return next();
  }

  entry.count++;
  if (entry.count > rateLimitMax) {
    const retryAfter = Math.ceil((rateLimitWindowMs - (now - entry.windowStart)) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many requests', retryAfter });
  }
  next();
});

// Periodically prune stale rate limit entries
setInterval(function () {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now - entry.windowStart > rateLimitWindowMs * 2) {
      rateLimitStore.delete(key);
    }
  }
}, 120_000);

// ─── Health check ───
app.get('/health', function (_req, res) {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    version: process.env.npm_package_version || '0.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.get('/ready', function (_req, res) {
  const videoPath = findVideoPath();
  res.json({
    status: videoPath ? 'ok' : 'degraded',
    video: videoPath ? 'available' : 'not-found',
    timestamp: new Date().toISOString(),
  });
});

// ─── Stripe API routes ───
function stripeGuard(_req, res, next) {
  if (!stripe) {
    return res.status(503).json({ error: 'Billing not configured' });
  }
  next();
}

// JSON body parser for Stripe API routes (NOT webhook)
app.use('/api/stripe/checkout', express.json());
app.use('/api/stripe/portal', express.json());

// Subscription routes need method-specific handling
app.patch('/api/stripe/subscription', express.json(), stripeGuard, async function (req, res) {
  try {
    // In production: look up customer's subscription from your DB
    // For now, return a placeholder that the frontend can handle
    const { planId, billing } = req.body;
    log('info', 'Subscription change requested', { planId, billing });
    // TODO: Implement actual subscription update when customer auth is wired
    return res.json({ success: true, message: 'Subscription update queued' });
  } catch (err) {
    log('error', 'Subscription change failed', { error: String(err) });
    return res.status(500).json({ error: 'Subscription change failed' });
  }
});

app.delete('/api/stripe/subscription', express.json(), stripeGuard, async function (_req, res) {
  try {
    log('info', 'Subscription cancellation requested');
    // TODO: Implement actual cancellation when customer auth is wired
    return res.json({ success: true, message: 'Subscription cancelled' });
  } catch (err) {
    log('error', 'Subscription cancel failed', { error: String(err) });
    return res.status(500).json({ error: 'Cancellation failed' });
  }
});

app.post('/api/stripe/checkout', stripeGuard, async function (req, res) {
  try {
    const { priceId, trial } = req.body;
    if (!priceId) return res.status(400).json({ error: 'Missing priceId' });

    const sessionParams = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: (process.env.APP_URL || 'http://localhost:3000') + '/app?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: (process.env.APP_URL || 'http://localhost:3000') + '/pricing',
    };

    if (trial) {
      sessionParams.subscription_data = { trial_period_days: 14 };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.json({ url: session.url });
  } catch (err) {
    log('error', 'Checkout session failed', { error: String(err) });
    return res.status(500).json({ error: 'Checkout session creation failed' });
  }
});

app.post('/api/stripe/portal', stripeGuard, async function (req, res) {
  try {
    // TODO: Get customer ID from authenticated user session
    const customerId = req.body.customerId;
    if (!customerId) return res.status(400).json({ error: 'Missing customerId' });

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: (process.env.APP_URL || 'http://localhost:3000') + '/app/settings',
    });
    return res.json({ url: session.url });
  } catch (err) {
    log('error', 'Billing portal failed', { error: String(err) });
    return res.status(500).json({ error: 'Billing portal session creation failed' });
  }
});

// Webhook uses raw body for signature verification
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), function (req, res) {
  if (!stripe) return res.status(503).json({ error: 'Billing not configured' });

  let event;
  try {
    if (STRIPE_WEBHOOK_SECRET) {
      const sig = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body.toString());
      log('warn', 'Processing webhook without signature verification');
    }
  } catch (err) {
    log('error', 'Webhook signature verification failed', { error: String(err) });
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  log('info', 'Stripe webhook received', { type: event.type, id: event.id });

  switch (event.type) {
    case 'checkout.session.completed':
      // TODO: Provision user subscription in DB
      log('info', 'Checkout completed', { sessionId: event.data.object.id });
      break;
    case 'customer.subscription.updated':
      log('info', 'Subscription updated', { subId: event.data.object.id, status: event.data.object.status });
      break;
    case 'customer.subscription.deleted':
      log('info', 'Subscription deleted', { subId: event.data.object.id });
      break;
    case 'invoice.paid':
      log('info', 'Invoice paid', { invoiceId: event.data.object.id });
      break;
    case 'invoice.payment_failed':
      log('warn', 'Invoice payment failed', { invoiceId: event.data.object.id });
      break;
    default:
      log('info', 'Unhandled webhook event', { type: event.type });
  }

  return res.json({ received: true });
});

// ─── Video streaming ───
const VIDEO_FILENAME = 'eco-auditor-intro.mp4';
const VIDEO_PATHS = [
  path.join('/app/videos', VIDEO_FILENAME),
  path.join(__dirname, 'static', VIDEO_FILENAME),
  path.join(__dirname, 'public', VIDEO_FILENAME),
];

function findVideoPath() {
  for (const p of VIDEO_PATHS) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore permission errors
    }
  }
  return null;
}

app.get('/api/video', function (req, res) {
  const filePath = findVideoPath();
  if (!filePath) {
    return res.status(404).json({ error: 'Video not found' });
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    log('error', 'Failed to stat video file', { path: filePath, error: String(err) });
    return res.status(500).json({ error: 'Internal server error' });
  }

  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const rawStart = parseInt(parts[0], 10);
    const rawEnd = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (isNaN(rawStart) || isNaN(rawEnd) || rawStart < 0 || rawEnd < rawStart || rawStart >= fileSize) {
      return res.status(416).setHeader('Content-Range', 'bytes */' + fileSize).end();
    }

    const start = rawStart;
    const end = Math.min(rawEnd, fileSize - 1);
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': 'bytes ' + start + '-' + end + '/' + fileSize,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
      'Cache-Control': 'public, max-age=86400',
    });

    const stream = fs.createReadStream(filePath, { start: start, end: end });
    stream.on('error', function (err) {
      log('error', 'Video stream error', { error: String(err) });
      if (!res.headersSent) res.status(500).json({ error: 'Stream error' });
      else res.end();
    });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
    });

    const stream = fs.createReadStream(filePath);
    stream.on('error', function (err) {
      log('error', 'Video stream error', { error: String(err) });
      if (!res.headersSent) res.status(500).json({ error: 'Stream error' });
      else res.end();
    });
    stream.pipe(res);
  }
});

// ─── Static files with cache headers ───
app.use(express.static(path.join(__dirname, 'static'), {
  setHeaders: function (res, filePath) {
    if (filePath.includes('/assets/') && (filePath.endsWith('.js') || filePath.endsWith('.css'))) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// ─── SPA fallback ───
app.get('*', function (_req, res) {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

// ─── Structured logging ───
function log(level, message, context) {
  const entry = {
    level: level,
    timestamp: new Date().toISOString(),
    message: message,
    requestId: context && context.requestId || undefined,
  };
  if (context) {
    Object.keys(context).forEach(function (k) {
      if (k !== 'requestId') entry[k] = context[k];
    });
  }
  const out = level === 'error' ? process.stderr : process.stdout;
  out.write(JSON.stringify(entry) + '\n');
}

// ─── Global error handlers ───
process.on('uncaughtException', function (err) {
  log('error', 'Uncaught exception', { error: String(err), stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', function (reason) {
  log('error', 'Unhandled rejection', { reason: String(reason) });
  process.exit(1);
});

// ─── Graceful shutdown ───
const server = app.listen(PORT, '0.0.0.0', function () {
  var videoPath = findVideoPath();
  log('info', 'Eco-Auditor listening', { port: PORT, video: videoPath || 'not-found' });
});

function shutdown(signal) {
  log('info', 'Shutting down', { signal: signal });
  server.close(function () {
    log('info', 'All connections closed');
    process.exit(0);
  });
  setTimeout(function () {
    log('error', 'Forced shutdown after timeout');
    process.exit(1);
  }, 9000);
}

process.on('SIGTERM', function () { shutdown('SIGTERM'); });
process.on('SIGINT', function () { shutdown('SIGINT'); });