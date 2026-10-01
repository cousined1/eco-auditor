// @vitest-environment node
// Node, not jsdom: scripts/prerender.mjs renders in Node, where `window` does not exist.
//
// The cross-owner leftovers of wave 1, asserted on what the pages SAY (the same
// entry-server render the prerender step uses) rather than on source text:
// F-C-08/F-F-19 headline spacing, F-A-09 trial tier, F-A-12 sign-in subtitle,
// F-C-17 shared scope colours, F-A-20 export wording, F-A-06 status wording,
// F-C-20 one brand spelling and F-C-25 menu aria-controls.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURES } from '../src/content/features';
import { trialHeadline, trialLimitsLabel } from '../src/content/pricing';
import { contactDetails } from '../src/content/trust-facts';
import { render } from '../src/entry-server';
import { SCOPE_COLORS } from '../src/lib/scopeColors';

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");

/**
 * Visible text of an HTML string: tags dropped, entities decoded, whitespace collapsed.
 * The `<!-- -->` React puts between adjacent text nodes is removed without a space, as a browser shows it.
 */
const textOf = (html: string) =>
  decode(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

/** The H1 as a phone shows it when the <br> is display:none: tags removed WITHOUT inserting a space. */
const h1Text = (html: string) =>
  decode(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]?.replace(/<[^>]+>/g, '') ?? '').replace(/\s+/g, ' ').trim();

describe('sample report as rendered', () => {
  const html = render('/sample-report');
  const text = textOf(html);

  it('keeps the headline words apart when the line break is hidden (F-C-08, F-F-19)', () => {
    expect(h1Text(html)).toBe('See the reports your team will actually use');
  });

  it('says what the trial is next to its call to action (F-A-09)', () => {
    expect(text).toContain(`Start your ${trialHeadline()}; no card required.`);
    expect(text).toContain(`Trial limits: ${trialLimitsLabel()}.`);
    expect(text).not.toMatch(/14-day free trial/);
  });

  it('describes the JSON export by what it contains (F-A-20)', () => {
    expect(text).toContain('JSON export of your company profile, facilities and emissions entries');
    expect(text).not.toContain('workspace data');
  });

  it('colours the scope bar and figures from the shared palette, not per-screen classes (F-C-17)', () => {
    for (const [scope, hex] of Object.entries(SCOPE_COLORS)) {
      // Once on the stacked bar and once on the figure under it.
      expect(html.split(hex).length - 1, scope).toBeGreaterThanOrEqual(2);
    }
    for (const stale of ['bg-red-500', 'bg-blue-500', 'bg-emerald-500', 'text-red-600', 'text-blue-600', 'text-emerald-600']) {
      expect(html, stale).not.toContain(stale);
    }
  });

  it('has no colour literal of its own: the palette is imported (F-C-17)', () => {
    const source = readFileSync(resolve('src/pages/SampleReport.tsx'), 'utf8');
    expect(source).toMatch(/from '\.\.\/lib\/scopeColors'/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});

describe('headline line breaks (F-C-08, F-F-19)', () => {
  it('every <br> that is hidden on phones has an explicit space before it, in every page and component', () => {
    // JSX drops whitespace that contains a newline, so "text\n<br/>" runs the words
    // together whenever the <br> is display:none. claims-honesty.test.ts checks the pages it
    // owns; this walks all of src so a page added later is held to it too.
    const sources = (readdirSync(resolve('src'), { recursive: true }) as string[])
      .map((file) => file.replaceAll('\\', '/'))
      .filter((file) => file.endsWith('.tsx'));
    const offenders: string[] = [];
    for (const file of sources) {
      const source = readFileSync(resolve('src', file), 'utf8');
      for (const match of source.matchAll(/<br className="hidden/g)) {
        if (!source.slice(0, match.index).trimEnd().endsWith("{' '}")) offenders.push(`src/${file} @${match.index}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('"available today" lists (F-C-04)', () => {
  // The entry list shows scope, category, source, CO2e and facility, and the dashboard shows
  // totals by scope and a trend. No screen shows a per-entry factor, dataset, confidence or
  // timestamp, so none of them may be offered as something you can do today.
  const PER_ENTRY_VIEW = /per[- ]entry|every entry|each entry|timestamp|published dataset|data-confidence score|factor applied/i;

  it('no live feature in the shared list promises a per-entry view', () => {
    for (const feature of FEATURES.filter((f) => f.status === 'live')) {
      expect(feature.description, feature.name).not.toMatch(PER_ENTRY_VIEW);
    }
  });

  it('the homepage lists none of them under "Live today"', () => {
    const text = textOf(render('/'));
    const live = text.slice(text.lastIndexOf('Live today'), text.indexOf('Coming next'));
    expect(live.length).toBeGreaterThan(0);
    expect(live).not.toMatch(PER_ENTRY_VIEW);
  });
});

describe('sign-in pages as rendered', () => {
  it('signup names the tier and limits of the card-free trial (F-A-09)', () => {
    const text = textOf(render('/signup'));
    expect(text).toContain(`${trialHeadline()} · No card required · ${trialLimitsLabel()}.`);
    expect(text).not.toMatch(/14-day free trial/);
  });

  it('signup with a plan chosen still says a card is required, and never "no card"', () => {
    const text = textOf(render('/signup?plan=growth'));
    expect(text).toContain('A payment method is required to start a trial from a selected plan.');
    expect(text).not.toContain('No card required');
  });

  it('login promises only the dashboard that exists (F-A-12)', () => {
    const text = textOf(render('/login'));
    expect(text).toContain('Welcome back. Continue to your emissions dashboard.');
    expect(text).not.toMatch(/ledger|compliance dashboard/i);
  });

  it('login draws the shared brand mark, not the old cycle-and-leaf logo (F-C-20)', () => {
    const html = render('/login');
    expect(html).toContain('M8 20V8l6 4 6-4v12');
    expect(html).not.toContain('M380 310 A150 150');
  });
});

describe('trust pages as rendered', () => {
  it('security no longer names audit trails or compliance reports as outputs (F-A-12, F-A-01)', () => {
    const text = textOf(render('/security'));
    expect(text).not.toMatch(/audit trails?|compliance reports?/i);
    expect(text).toContain('generating emissions estimates and PDF emissions summaries');
  });

  it('the DPA states its scope without a compliance-status word (F-A-06)', () => {
    const text = textOf(render('/dpa'));
    expect(text).not.toMatch(/GDPR[- ]aligned/i);
    expect(text).toContain('controller-to-processor arrangements under the GDPR');
  });
});

describe('one spelling of the brand (F-C-20)', () => {
  const ROUTES = [
    '/', '/pricing', '/methodology', '/sample-report', '/security', '/demo', '/contact',
    '/privacy', '/terms', '/dpa', '/blog', '/login', '/signup', '/forgot-password',
  ];

  it.each(ROUTES)('%s never writes "EcoAuditor"', (route) => {
    expect(textOf(render(route))).not.toContain('EcoAuditor');
  });

  it('no UI source or chatbot reply writes it either', () => {
    // .cjs is included on purpose: src/lib/reports/report-generator.cjs prints the product name as
    // the first line of every generated PDF, and the committed sample PDF is generated from it, so
    // that string changes together with `node scripts/generate-sample-report.cjs`.
    const files = (readdirSync(resolve('src'), { recursive: true }) as string[])
      .map((file) => file.replaceAll('\\', '/'))
      .filter((file) => /\.(tsx?|json|cjs)$/.test(file))
      .map((file) => `src/${file}`);
    const offenders = [...files, 'server.cjs', 'public/llms.txt'].filter((file) => readFileSync(resolve(file), 'utf8').includes('EcoAuditor'));
    expect(offenders).toEqual([]);
  });
});

describe('the follow-up promise as rendered (F-A-07, D-2)', () => {
  // The Demo and Contact pages used to say "within one business day" and "within 1-2 business
  // days" while the chat said something else and nothing told a human about the lead.
  it.each(['/contact', '/demo'])('%s makes the shared follow-up promise and names no time', (route) => {
    const text = textOf(render(route));
    expect(text).toContain(`${contactDetails.followUp}.`);
    expect(text).not.toMatch(/business days?|within (?:one|1|2|two|24|48) |typically respond/i);
  });
});

describe('the footer and the security page claim nothing they cannot back (F-C-18)', () => {
  it.each(['/', '/pricing', '/security', '/contact', '/privacy'])('%s links no sister products under an "Eco-Auditor suite" label', (route) => {
    const html = render(route);
    expect(html).not.toMatch(/provenance-os\.com|sim-?2-?real\.com|ProvenanceOS|Sim2Real/i);
    expect(textOf(html)).not.toMatch(/Eco-Auditor suite/i);
  });

  it('the security page grades nothing "enterprise" and prices nothing', () => {
    expect(textOf(render('/security'))).not.toMatch(/enterprise[- ]grade|SMB-priced/i);
  });
});

describe('no page says it "never shares" data (D-7)', () => {
  // The Security page said "We never share or sell customer data" twice while DPA Annex III
  // names the providers customer data is shared with. The sentence is now "we do not sell ...;
  // we share it only with the service providers listed in DPA Annex III" (COUNSEL-REVIEW).
  const NEVER = /\bnever\s+(?:share|sell|license)\b/i;
  const ROUTES = [
    '/', '/pricing', '/methodology', '/sample-report', '/security', '/demo', '/contact',
    '/privacy', '/terms', '/dpa', '/blog', '/login', '/signup', '/forgot-password',
  ];

  it.each(ROUTES)('%s', (route) => {
    expect(textOf(render(route))).not.toMatch(NEVER);
  });

  it('nor do the chat copy, llms.txt or the FAQ data', () => {
    for (const file of ['server.cjs', 'public/llms.txt', 'src/content/faq.json']) {
      expect(readFileSync(resolve(file), 'utf8'), file).not.toMatch(NEVER);
    }
  });

  it('the security page says who the data is shared with, in both places it speaks of sharing', () => {
    const text = textOf(render('/security'));
    const sentence = /We do not sell (?:customer data|or license your emissions data); we share it only with the service providers listed in DPA Annex III\./g;
    expect([...text.matchAll(sentence)]).toHaveLength(2);
  });
});

describe('marketing menu button (F-C-25)', () => {
  it.each(['/', '/pricing', '/contact'])('%s: the button controls an element that is in the page', (route) => {
    const html = render(route);
    const controls = /<button\b[^>]*aria-controls="([^"]+)"[^>]*aria-label="Toggle navigation menu"|<button\b[^>]*aria-label="Toggle navigation menu"[^>]*aria-controls="([^"]+)"/.exec(html);
    const id = controls?.[1] ?? controls?.[2];
    expect(id, 'aria-controls on the menu button').toBeTruthy();
    expect(html).toContain(`id="${id}"`);
  });
});
