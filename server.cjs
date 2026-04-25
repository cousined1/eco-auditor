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

// ─── Version endpoint (for forced-update watchdog) ───
app.get('/api/version', function (_req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({
    version: process.env.npm_package_version || process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0',
    build: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
    timestamp: new Date().toISOString(),
  });
});

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
    const { planId, billing } = req.body;
    log('info', 'Subscription change requested', { planId, billing });
    return res.json({ success: true, message: 'Subscription update queued' });
  } catch (err) {
    log('error', 'Subscription change failed', { error: String(err) });
    return res.status(500).json({ error: 'Subscription change failed' });
  }
});

app.delete('/api/stripe/subscription', express.json(), stripeGuard, async function (_req, res) {
  try {
    log('info', 'Subscription cancellation requested');
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

// ─── LEADS STORAGE ───
const LEADS_FILE = path.join(__dirname, '.data', 'leads.json');
function ensureLeadsDir() {
  const dir = path.dirname(LEADS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function readLeads() {
  ensureLeadsDir();
  if (!fs.existsSync(LEADS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  } catch {
    return [];
  }
}
function writeLead(lead) {
  ensureLeadsDir();
  const leads = readLeads();
  leads.push({ ...lead, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

// ─── SALESBOT CHAT ENGINE ───
const ECOAUDITOR_KB = [
  {
    pattern: /pricing|cost|how much|plan/i,
    response: "We offer three plans:\n\n• **Starter** — $49/mo for basic carbon tracking\n• **Growth** — $149/mo for full Scope 1/2/3 reporting\n• **Enterprise** — Custom pricing for large organizations\n\nAll plans include a 14-day free trial. Would you like me to help you choose the right plan?"
  },
  {
    pattern: /demo|book a demo|schedule a call|talk to sales/i,
    response: "I'd be happy to schedule a demo! To get started, could you tell me your name?"
  },
  {
    pattern: /contact|reach out|email|phone/i,
    response: "You can reach us at:\n\n• Email: hello@developer312.com\n• Phone: (510) 401-1225\n\nOr I can connect you with our sales team right here in the chat!"
  },
  {
    pattern: /how (it|does) work|features|what is|about/i,
    response: "EcoAuditor helps businesses track and report carbon emissions:\n\n• **Automatic data collection** from your systems\n• **Scope 1/2/3 reporting** aligned with GHG Protocol\n• **Compliance readiness** for SEC, CBAM, and California AB 1305\n• **AI-powered insights** to reduce emissions\n\nWant to see it in action? I can book you a demo!"
  },
  {
    pattern: /scope 1|scope 2|scope 3|ghg|protocol/i,
    response: "We follow the GHG Protocol for comprehensive emissions accounting:\n\n• **Scope 1**: Direct emissions from owned/controlled sources\n• **Scope 2**: Indirect emissions from purchased energy\n• **Scope 3**: All other indirect emissions in your value chain\n\nOur platform automates data collection and reporting across all three scopes."
  },
  {
    pattern: /cbam|carbon border|eu|europe/i,
    response: "EcoAuditor helps you prepare for the EU Carbon Border Adjustment Mechanism (CBAM):\n\n• Track embedded emissions in imports\n• Generate CBAM-compliant reports\n• Monitor compliance deadlines\n• Calculate carbon costs\n\nNeed help getting CBAM-ready? Book a demo with our team!"
  },
  {
    pattern: /sec|disclosure|climate rule/i,
    response: "We support SEC climate disclosure requirements:\n\n• Materiality assessment guidance\n• Emissions data collection and validation\n• Scenario analysis support\n• Audit-ready documentation\n\nOur platform helps you meet the SEC's climate disclosure rules efficiently."
  },
  {
    pattern: /california|ab 1305|climate corporate/i,
    response: "EcoAuditor is built for California's Climate Corporate Data Accountability Act (AB 1305):\n\n• Automated emissions reporting\n• Third-party verification support\n• Public disclosure templates\n• Compliance timeline tracking\n\nStay ahead of California's climate reporting requirements with EcoAuditor."
  },
  {
    pattern: /smb|small business|startup|affordable/i,
    response: "EcoAuditor is designed for businesses of all sizes:\n\n• **Starter plan** at $49/mo for small teams\n• Easy setup — no technical expertise needed\n• Templates and guides for first-time reporters\n• Scale up as your reporting needs grow\n\nStart your 14-day free trial today!"
  },
  {
    pattern: /integration|api|connect|erp|salesforce/i,
    response: "EcoAuditor integrates with your existing tools:\n\n• **Direct API** for custom integrations\n• **Pre-built connectors** for major ERPs\n• **CSV import/export** for spreadsheets\n• **Webhook support** for real-time updates\n\nNeed a specific integration? Let us know and we'll build it!"
  }
];

function getBotResponse(message, state = {}) {
  const lowerMsg = message.toLowerCase().trim();

  // Handle multi-step flows
  if (state.flow === 'demo') {
    if (!state.name) {
      return {
        response: `Nice to meet you, ${message}! What's your email address?`,
        state: { ...state, name: message, step: 'email' }
      };
    }
    if (state.step === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(message)) {
        return {
          response: "That doesn't look like a valid email. Please enter a valid email address:",
          state
        };
      }
      return {
        response: "Great! What company are you with?",
        state: { ...state, email: message, step: 'company' }
      };
    }
    if (state.step === 'company') {
      return {
        response: `Perfect! What day works best for your demo? (Please provide a date, e.g., "2026-05-15")`,
        state: { ...state, company: message, step: 'date' }
      };
    }
    if (state.step === 'date') {
      return {
        response: "What time of day do you prefer? (e.g., 'Morning', 'Afternoon', or specific time like '2:00 PM PST')",
        state: { ...state, date: message, step: 'time' }
      };
    }
    if (state.step === 'time') {
      // Save lead
      writeLead({
        type: 'demo_request',
        name: state.name,
        email: state.email,
        company: state.company,
        preferredDate: state.date,
        preferredTime: message,
        source: 'chatbot'
      });
      return {
        response: `🎉 Demo booked!\n\nOur team will reach out to ${state.email} within 24 hours to confirm your demo for ${state.date} (${message}).\n\nIn the meantime, check out our [Pricing](/pricing) or ask me anything else!`,
        state: {}
      };
    }
  }

  if (state.flow === 'contact') {
    if (!state.name) {
      return {
        response: `Thanks for reaching out! What's your name?`,
        state: { ...state, name: message, step: 'email' }
      };
    }
    if (state.step === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(message)) {
        return {
          response: "Please enter a valid email address:",
          state
        };
      }
      return {
        response: "How can our sales team help you today?",
        state: { ...state, email: message, step: 'message' }
      };
    }
    if (state.step === 'message') {
      writeLead({
        type: 'contact_request',
        name: state.name,
        email: state.email,
        message: message,
        source: 'chatbot'
      });
      return {
        response: `✅ Message sent!\n\nOur sales team will contact you at ${state.email} within 24 hours.\n\nIs there anything else I can help you with?`,
        state: {}
      };
    }
  }

  // Quick reply triggers
  if (lowerMsg === '💰 pricing' || lowerMsg === 'pricing') {
    const match = ECOAUDITOR_KB.find(k => k.pattern.test('pricing'));
    return { response: match ? match.response : "Our plans start at $49/mo. Would you like more details?", state };
  }
  if (lowerMsg === '📅 book a demo' || lowerMsg === 'book a demo') {
    return {
      response: "I'd be happy to schedule a demo! What's your name?",
      state: { flow: 'demo', step: 'name' }
    };
  }
  if (lowerMsg === '🚀 how it works' || lowerMsg === 'how it works') {
    const match = ECOAUDITOR_KB.find(k => k.pattern.test('how it works'));
    return { response: match ? match.response : "EcoAuditor automates carbon tracking and reporting. Want a demo?", state };
  }
  if (lowerMsg === '📞 contact sales' || lowerMsg === 'contact sales') {
    return {
      response: "I'd be happy to connect you with our sales team! What's your name?",
      state: { flow: 'contact', step: 'name' }
    };
  }

  // Regex KB matching
  for (const entry of ECOAUDITOR_KB) {
    if (entry.pattern.test(message)) {
      return { response: entry.response, state };
    }
  }

  // Default response
  return {
    response: "I'm not sure I understand. I can help you with:\n\n• 💰 Pricing and plans\n• 📅 Booking a demo\n• 🚀 How EcoAuditor works\n• 📞 Contacting sales\n\nOr ask me about carbon accounting, emissions reporting, or compliance!",
    state
  };
}

// ─── CHAT API ───
app.post('/api/chat', express.json(), async function (req, res) {
  const { message, sessionId, state = {} } = req.body || {};

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Message is required' });
  }

  if (message.length > 5000) {
    return res.status(400).json({ success: false, error: 'Message too long (max 5000 chars)' });
  }

  // Use salesbot engine first
  const botResult = getBotResponse(message.trim(), state);
  
  // If we have a specific flow response, return it immediately
  if (botResult.response) {
    return res.json({
      success: true,
      response: botResult.response,
      state: botResult.state || state,
      quickReplies: !botResult.state?.flow ? ['💰 Pricing', '📅 Book a Demo', '🚀 How it works', '📞 Contact Sales'] : undefined
    });
  }

  // Fallback to AI if no pattern matched and no flow is active
  const chatModel = process.env.CHAT_MODEL;
  const chatApiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;

  if (!chatApiKey) {
    return res.json({
      success: true,
      response: "I'm here to help! I can assist with:\n\n• 💰 Pricing and plans\n• 📅 Booking a demo\n• 🚀 How EcoAuditor works\n• 📞 Contacting sales\n• Carbon accounting and compliance questions\n\nWhat would you like to know?",
      quickReplies: ['💰 Pricing', '📅 Book a Demo', '🚀 How it works', '📞 Contact Sales']
    });
  }

  try {
    const systemPrompt = `You are the EcoAuditor AI assistant — an expert in carbon accounting, emissions reporting, GHG protocols, Scope 1/2/3, California AB 1305, CBAM, SEC climate disclosure, and sustainability compliance for SMBs. Answer clearly and concisely. When uncertain, say so rather than guessing. Do not provide legal or regulatory advice — recommend consulting a specialist for specific compliance questions.`;

    let result;
    if (chatModel === 'anthropic' || process.env.ANTHROPIC_API_KEY) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: message.trim() }],
        }),
      });
      const data = await response.json();
      result = data.content?.[0]?.text || 'Sorry, I could not process that request.';
    } else {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 1024,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message.trim() },
          ],
        }),
      });
      const data = await response.json();
      result = data.choices?.[0]?.message?.content || 'Sorry, I could not process that request.';
    }

    return res.json({ success: true, response: result.trim(), quickReplies: ['💰 Pricing', '📅 Book a Demo', '🚀 How it works', '📞 Contact Sales'] });
  } catch (err) {
    log('error', 'Chat API error', { error: String(err) });
    return res.status(500).json({ success: false, error: 'Internal error. Please try again.', quickReplies: ['💰 Pricing', '📅 Book a Demo', '🚀 How it works', '📞 Contact Sales'] });
  }
});

// ─── LEADS API ───
app.post('/api/leads', express.json(), async function (req, res) {
  const { name, email, company, type, message, preferredDate, preferredTime } = req.body || {};
  
  if (!name || !email) {
    return res.status(400).json({ success: false, error: 'Name and email are required' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, error: 'Invalid email address' });
  }

  writeLead({
    type: type || 'general',
    name,
    email,
    company: company || null,
    message: message || null,
    preferredDate: preferredDate || null,
    preferredTime: preferredTime || null,
    source: 'api'
  });

  return res.json({ success: true, message: 'Lead captured successfully' });
});

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
