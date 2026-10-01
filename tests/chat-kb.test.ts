// @vitest-environment node
/**
 * F-A-11 (salesbot routing and truthfulness) and the reply half of F-A-07 /
 * F-B-12 ("Demo booked!").
 *
 * The salesbot is a regex table, not a model, and it lives inside server.cjs, so
 * these tests evaluate the REAL source block (marker to marker) in a vm context
 * instead of re-implementing it, the same technique as tests/csv-quota-transaction.test.ts.
 * `planLimits` is the real function from server-billing.cjs; `writeChatLead` is a stub.
 *
 * Two failure classes are pinned:
 *   1. routing: a generic entry placed ahead of a specific one makes the
 *      specific entry unreachable (the audit found "Tell me about CBAM" and
 *      "What about the SEC climate rule?" both answered by the overview);
 *   2. truth: every claim in a reply is checked against the sources of truth,
 *      plan-limits.json (enforced limits) and src/content/pricing.ts (prices).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import planLimitsFile from '../plan-limits.json';
import { PLANS } from '../src/content/pricing';
import { CBAM_PRODUCT_STATEMENT } from '../src/content/regulatory';
import { contactDetails } from '../src/content/trust-facts';

const require = createRequire(import.meta.url);
const { planLimits } = require('../server-billing.cjs');

const source = readFileSync(resolve(__dirname, '..', 'server.cjs'), 'utf8');
const START = '// ─── SALESBOT CHAT ENGINE ───';
const END = '// ─── CHAT API ───';
const block = source.slice(source.indexOf(START), source.indexOf(END));

interface KbEntry {
  id: string;
  pattern: RegExp;
  response: string;
  flow?: string;
}
interface BotResult {
  response: string;
  state: Record<string, unknown>;
}
interface Engine {
  ECOAUDITOR_KB: KbEntry[];
  matchKbEntry: (message: string) => KbEntry | null;
  getBotResponse: (message: string, state?: Record<string, unknown>) => Promise<BotResult>;
}

function loadEngine(writeChatLead: (lead: Record<string, unknown>) => Promise<boolean>): Engine {
  return runInNewContext(`${block}\n({ ECOAUDITOR_KB, matchKbEntry, getBotResponse })`, {
    planLimits,
    writeChatLead,
  }) as Engine;
}

const saved: Array<Record<string, unknown>> = [];
const engine = loadEngine(async (lead) => {
  saved.push(lead);
  return true;
});

describe('the extracted block is the real thing', () => {
  it('found both markers', () => {
    expect(source.indexOf(START)).toBeGreaterThan(-1);
    expect(source.indexOf(END)).toBeGreaterThan(source.indexOf(START));
    expect(block).toContain('const ECOAUDITOR_KB');
    expect(block).toContain('async function getBotResponse');
  });
});

describe('F-A-11: routing, specific intents win over the catch-all', () => {
  // 27 representative questions and the entry that must answer each. The first
  // three are the audit's own repro; the rest cover every entry.
  const table: Array<[string, string]> = [
    ['how it works', 'overview'],
    ['Tell me about CBAM', 'cbam'],
    ['What about the SEC climate rule?', 'sec'],
    ['What is Scope 3?', 'scope'],
    ['Is there a free trial?', 'trial'],
    ['Do you offer a free plan?', 'trial'],
    ['Is there a discount for annual billing?', 'pricing'],
    ['Can I import a CSV?', 'integrations'],
    ['how does eco-auditor work', 'overview'],
    ['What can you do?', 'overview'],
    ['How much does it cost?', 'pricing'],
    ['Do you support Scope 3 on the Starter plan?', 'pricing'],
    ['Can I get a demo?', 'demo'],
    ['How do I contact sales?', 'contact'],
    ['I want to talk to someone', 'contact'],
    ['Does it connect to QuickBooks?', 'integrations'],
    ['Do you have an API?', 'integrations'],
    ['Is it audit-ready for SB 253?', 'audit'],
    ['Do you provide third-party assurance?', 'audit'],
    ['Tell me about California SB 253', 'california'],
    ['What about AB 1305?', 'california'],
    ['Do you cover SB 261?', 'california'],
    ['Do you handle EU importers?', 'cbam'],
    ['What emission factors do you use?', 'scope'],
    ['We are a small business, is this affordable?', 'smb'],
    ['What is Eco-Auditor?', 'overview'],
    ['What features do you have?', 'overview'],
  ];

  it.each(table)('%j is answered by the %s entry', (question, id) => {
    expect(engine.matchKbEntry(question)?.id).toBe(id);
  });

  it('every entry is reachable by at least one representative question', () => {
    const reached = new Set(table.map(([, id]) => id));
    for (const entry of engine.ECOAUDITOR_KB) {
      expect(reached, `no representative question reaches "${entry.id}"`).toContain(entry.id);
    }
  });

  it('keeps the generic overview LAST and entry ids unique', () => {
    const ids = engine.ECOAUDITOR_KB.map((entry) => entry.id);
    expect(ids[ids.length - 1]).toBe('overview');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no word-boundary-less pattern swallows longer words (eu in "queue", api in "capital")', () => {
    expect(engine.matchKbEntry('the queue is long')?.id).not.toBe('cbam');
    expect(engine.matchKbEntry('our capital budget')?.id).not.toBe('integrations');
    expect(engine.matchKbEntry('an enterprise with 500 staff')?.id).not.toBe('integrations');
  });

  it('answers the widget quick replies with the entries they name', async () => {
    const pricing = await engine.getBotResponse('💰 Pricing');
    expect(pricing.response).toBe(engine.ECOAUDITOR_KB.find((e) => e.id === 'pricing')?.response);

    const how = await engine.getBotResponse('🚀 How it works');
    expect(how.response).toBe(engine.ECOAUDITOR_KB.find((e) => e.id === 'overview')?.response);

    const demo = await engine.getBotResponse('📅 Book a Demo');
    expect(demo.state).toEqual({ flow: 'demo', step: 'name' });

    const contact = await engine.getBotResponse('📞 Contact Sales');
    expect(contact.state).toEqual({ flow: 'contact', step: 'name' });
  });

  it('typing a demo request starts the demo flow it asks a name for', async () => {
    // The reply asked "what's your name?" but left the state empty, so the
    // visitor's answer was treated as a fresh question and got the fallback.
    const first = await engine.getBotResponse('I would like a demo please');
    expect(first.state).toEqual({ flow: 'demo', step: 'name' });
    const second = await engine.getBotResponse('Ada Lovelace', first.state);
    expect(second.response).toMatch(/email/i);
    expect(second.state).toMatchObject({ flow: 'demo', name: 'Ada Lovelace', step: 'email' });
  });
});

describe('F-A-11: every reply is true', () => {
  const replies = () => engine.ECOAUDITOR_KB.map((entry) => ({ id: entry.id, text: entry.response }));
  const planIds = ['starter', 'growth', 'pro'] as const;
  const limitsOf = (id: (typeof planIds)[number]) => planLimitsFile.plans[id];

  it('quotes the plan prices from src/content/pricing.ts', () => {
    const pricing = engine.ECOAUDITOR_KB.find((e) => e.id === 'pricing')!.response;
    for (const id of planIds) {
      expect(pricing).toContain(`**${PLANS[id].name}** — $${PLANS[id].monthly}/mo`);
    }
    const smb = engine.ECOAUDITOR_KB.find((e) => e.id === 'smb')!.response;
    expect(smb).toContain(`$${PLANS.starter.monthly}/mo`);
  });

  it('never quotes a dollar amount other than a plan price or the SB 253 threshold', () => {
    const allowed = new Set([...planIds.map((id) => `$${PLANS[id].monthly}`), '$1']); // "$1 billion"
    for (const { id, text } of replies()) {
      for (const amount of text.match(/\$\d[\d,]*/g) ?? []) {
        expect(allowed, `${id} quotes ${amount}`).toContain(amount);
      }
    }
  });

  it('states every limit from plan-limits.json, the file the server enforces', () => {
    const pricing = engine.ECOAUDITOR_KB.find((e) => e.id === 'pricing')!.response;
    const lineOf = (name: string) => pricing.split('\n').find((line) => line.includes(`**${name}**`)) ?? '';

    for (const id of planIds) {
      const limits = limitsOf(id);
      const line = lineOf(PLANS[id].name);
      expect(line, `${id} plan line`).not.toBe('');

      expect(line).toContain(limits.scope3 ? 'Scope 1, 2 and 3' : 'Scope 1 and 2 only (no Scope 3)');
      if (limits.facilities === null) expect(line).toContain('unlimited facilities');
      else expect(line).toContain(limits.facilities === 1 ? '1 facility' : `up to ${limits.facilities} facilities`);
      if (limits.csvImportsPerMonth === null) expect(line).toContain('unlimited CSV imports');
      else expect(line).toContain(`${limits.csvImportsPerMonth} CSV imports a month`);
    }
  });

  it('describes the card-free trial with the Starter limits (server-billing.cjs grants Starter during a trial)', () => {
    const trial = engine.ECOAUDITOR_KB.find((e) => e.id === 'trial')!.response;
    const starter = limitsOf('starter');
    expect(trial).toContain('Starter-level');
    expect(trial).toContain('no Scope 3');
    expect(trial).toContain(`${starter.csvImportsPerMonth} CSV imports a month`);
    // Pro has no trial (pricing.ts), Starter and Growth do.
    expect(PLANS.pro.trial).toBe(false);
    expect(PLANS.starter.trial && PLANS.growth.trial).toBe(true);
    expect(trial).toContain('Pro has no trial');
  });

  it('names exactly the plans that include Scope 3', () => {
    const withScope3 = planIds.filter((id) => limitsOf(id).scope3).map((id) => PLANS[id].name);
    expect(withScope3).toEqual(['Growth', 'Pro']);
    const scope = engine.ECOAUDITOR_KB.find((e) => e.id === 'scope')!.response;
    expect(scope).toContain('Scope 3 needs Growth or Pro');
  });

  it('labels every unbuilt feature it mentions as roadmap', () => {
    for (const id of ['overview', 'integrations', 'audit']) {
      const text = engine.ECOAUDITOR_KB.find((e) => e.id === id)!.response;
      expect(text, `${id} must say roadmap`).toMatch(/roadmap/i);
    }
    // Everything the roadmap sentence lists is on some plan's roadmap in pricing.ts
    // (which tier lists an item is a product decision; only the feature matters here).
    const roadmap = planIds.flatMap((id) => PLANS[id].roadmap).join(' ').toLowerCase();
    for (const item of ['supplier', 'quickbooks', 'api', 'audit trail']) expect(roadmap).toContain(item);
    // ...and no reply offers an audit trail as something the product has.
    expect(engine.ECOAUDITOR_KB.find((e) => e.id === 'audit')!.response).toMatch(/does not yet keep an audit trail/i);
  });

  it('carries none of the claims the audit found false', () => {
    const forbidden: Array<[string, RegExp]> = [
      ['a booking claim', /\bbooked\b|book you\b/i],
      ['a personalized deck', /personali[sz]ed/i],
      ['an SLA no one can back', /within 24 hours/i],
      ['audit-ready', /audit[- ]ready/i],
      ['compliance readiness', /compliance readiness/i],
      ['SB 261 readiness', /SB 261 (and|readiness)/i],
      ['the wrong SEC status', /withdrawn/i],
      ['a deadline feature', /stay informed on compliance deadlines/i],
      ['SB 253 deadline information as a feature', /SB 253 deadline information/i],
      ['templates that do not exist', /templates and guides/i],
      ['DEFRA factors', /DEFRA/i],
      ['quarterly factor updates', /quarterly/i],
      ['CDP/GRI/TCFD exports', /\bCDP\b|\bGRI\b|\bTCFD\b/],
      ['the old "unlimited" Scope 3 pitch', /Scope 1\/2\/3 reporting/i],
    ];
    for (const { id, text } of replies()) {
      for (const [label, pattern] of forbidden) {
        expect(text, `${id} contains ${label}`).not.toMatch(pattern);
      }
    }
  });

  it('says what it is NOT where the audit found over-claiming', () => {
    const byId = (id: string) => engine.ECOAUDITOR_KB.find((e) => e.id === id)!.response;
    expect(byId('cbam')).toMatch(/not a CBAM tool/i);
    expect(byId('cbam')).toMatch(/does not calculate CBAM embedded emissions/i);
    // D-8: the Methodology page renders this sentence from src/content/regulatory.ts, so the two say the same thing.
    expect(byId('cbam')).toContain(CBAM_PRODUCT_STATEMENT);
    expect(byId('california')).toMatch(/not an SB 253 filing tool/i);
    expect(byId('california')).toMatch(/more than \$1 billion/);
    expect(byId('sec')).toMatch(/have not taken effect/i);
    expect(byId('sec')).toMatch(/does not produce SEC filings/i);
    expect(byId('audit')).toMatch(/does not provide third-party assurance/i);
  });
});

describe('F-A-07 / F-B-12: the demo and contact flows do not overclaim', () => {
  async function runDemo(engineUnderTest: Engine): Promise<BotResult> {
    let state: Record<string, unknown> = {};
    let last: BotResult = { response: '', state };
    for (const message of ['Book a Demo', 'Ada Lovelace', 'ada@example.test', 'Analytical Engines', '2026-10-20', 'Morning']) {
      last = await engineUnderTest.getBotResponse(message, state);
      state = last.state;
    }
    return last;
  }

  it('confirms only that the details are saved and that the team will follow up by email', async () => {
    saved.length = 0;
    const done = await runDemo(engine);

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      type: 'demo_request',
      name: 'Ada Lovelace',
      email: 'ada@example.test',
      company: 'Analytical Engines',
      preferredDate: '2026-10-20',
      preferredTime: 'Morning',
    });
    expect(done.state).toEqual({});
    expect(done.response).toMatch(/details are saved/i);
    expect(done.response).toMatch(/follow up by email at ada@example\.test/i);
    expect(done.response).toMatch(/can't book a time myself/i);
    expect(done.response).toMatch(/preference, not a confirmed slot/i);
    expect(done.response).not.toMatch(/booked|personali[sz]ed|within 24 hours|presentation|deck|🎉/i);
    // No third-party link at all, and nothing personal in any URL.
    expect(done.response).not.toMatch(/railway\.app|prismdeck/i);
    expect(done.response.match(/https?:\/\/\S+/g) ?? []).toEqual([]);
  });

  it('does not claim the request was saved when saving failed', async () => {
    const failing = loadEngine(async () => false);
    const done = await runDemo(failing);

    expect(done.response).toMatch(/couldn't save/i);
    expect(done.response).not.toMatch(/details are saved|booked|✅/i);
    expect(done.response).toMatch(/team will follow up/i);
  });

  it('suggests an example date that is still in the future', async () => {
    const prompt = await engine.getBotResponse('Analytical Engines', { flow: 'demo', step: 'company', name: 'Ada', email: 'ada@example.test' });
    const example = prompt.response.match(/"(\d{4}-\d{2}-\d{2})"/)?.[1];
    expect(example).toBeDefined();
    const today = new Date().toISOString().slice(0, 10);
    expect(example! > today).toBe(true);
    // The audit caught it suggesting 2026-05-15 in September.
    expect(prompt.response).not.toContain('2026-05-15');
  });

  it('the contact flow confirms a saved message, with no 24-hour promise', async () => {
    saved.length = 0;
    let state: Record<string, unknown> = {};
    let last: BotResult = { response: '', state };
    for (const message of ['Contact Sales', 'Ada Lovelace', 'ada@example.test', 'Please call me about pricing']) {
      last = await engine.getBotResponse(message, state);
      state = last.state;
    }
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ type: 'contact_request', email: 'ada@example.test' });
    expect(last.response).toMatch(/message is saved/i);
    expect(last.response).toMatch(/follow up by email/i);
    expect(last.response).not.toMatch(/within 24 hours|Message sent/i);
  });

  it('the contact flow does not confirm when saving failed', async () => {
    const failing = loadEngine(async () => false);
    let state: Record<string, unknown> = {};
    let last: BotResult = { response: '', state };
    for (const message of ['Contact Sales', 'Ada', 'ada@example.test', 'hello']) {
      last = await failing.getBotResponse(message, state);
      state = last.state;
    }
    expect(last.response).toMatch(/couldn't send that/i);
    expect(last.response).not.toMatch(/saved|✅/i);
  });
});

// F-A-07 / D-2 / F-A-17: the pages read contactDetails; the bot cannot import it (server.cjs
// is CommonJS), so what it says is held to the same words. The wording here comes from the
// constant, so the day the owner changes it (for example to add a time, once the lead
// notifier is live and staffed) this fails until the bot says the same.
describe('F-A-07 / F-A-17: the bot promises and lists what the pages do (contactDetails)', () => {
  // "We'll follow up by email" -> "follow up by email", as the bot writes it ("our team will follow up by email").
  const promise = contactDetails.followUp.replace(/^We'll\s+/i, '').toLowerCase();

  async function converse(engineUnderTest: Engine, messages: string[]): Promise<BotResult> {
    let state: Record<string, unknown> = {};
    let last: BotResult = { response: '', state };
    for (const message of messages) {
      last = await engineUnderTest.getBotResponse(message, state);
      state = last.state;
    }
    return last;
  }
  const DEMO_STEPS = ['Book a Demo', 'Ada Lovelace', 'ada@example.test', 'Analytical Engines', '2026-10-20', 'Morning'];
  const CONTACT_STEPS = ['Contact Sales', 'Ada Lovelace', 'ada@example.test', 'Please call me about pricing'];

  it('the demo intro, the contact entry and both confirmations make the same follow-up promise as the Demo and Contact pages', async () => {
    const entry = (id: string) => engine.ECOAUDITOR_KB.find((e) => e.id === id)!.response.toLowerCase();
    expect(entry('demo')).toContain(promise);
    expect(entry('contact')).toContain(promise);
    expect((await converse(engine, DEMO_STEPS)).response.toLowerCase()).toContain(promise);
    expect((await converse(engine, CONTACT_STEPS)).response.toLowerCase()).toContain(promise);
  });

  it('lists the mailbox and phone number the pages list, and sends a visitor whose request could not be saved to the same mailbox', async () => {
    const contact = engine.ECOAUDITOR_KB.find((e) => e.id === 'contact')!.response;
    expect(contact).toContain(contactDetails.email);
    expect(contact).toContain(contactDetails.phone);
    const failing = loadEngine(async () => false);
    expect((await converse(failing, DEMO_STEPS)).response).toContain(contactDetails.email);
    expect((await converse(failing, CONTACT_STEPS)).response).toContain(contactDetails.email);
  });

  it('no reply states a time the team will respond within', async () => {
    const TIME_PROMISE = /within\s+(?:\d+|one|two|a few|the same)\s+(?:hours?|business days?|days?)|same[- ]day|next[- ](?:business )?day/i;
    const replies = [
      ...engine.ECOAUDITOR_KB.map((e) => e.response),
      (await converse(engine, DEMO_STEPS)).response,
      (await converse(engine, CONTACT_STEPS)).response,
    ];
    for (const reply of replies) expect(reply).not.toMatch(TIME_PROMISE);
  });
});
