// @vitest-environment node
// Node, not jsdom: scripts/prerender.mjs renders in Node where `window` does not exist, and the providers
// branch on it (ThemeProvider calls window.matchMedia when a window is present).
// Renders the marketing pages the way scripts/prerender.mjs does (entry-server
// render(route)) and asserts on the HTML a crawler receives. This is the
// behavioural counterpart to the source-level checks in claims-honesty.test.ts:
// it proves what the page SAYS, not what a file happens to contain.
import { describe, it, expect } from 'vitest';
import { render } from '../src/entry-server';
import faq from '../src/content/faq.json';
import { PLAN_LIMITS, TRIAL_DAYS } from '../src/content/pricing';
import { CBAM_PRODUCT_STATEMENT, REGULATORY } from '../src/content/regulatory';

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");

/** Visible text of an HTML string: tags dropped, entities decoded, whitespace collapsed. */
const textOf = (html: string) => decode(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const h1Text = (html: string) => {
  const match = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  // Tags are removed WITHOUT inserting a space: this is what a mobile browser
  // shows when the <br> is display:none, and what crawlers read.
  return decode((match?.[1] ?? '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
};

describe('homepage as rendered', () => {
  const html = render('/');
  const text = textOf(html);

  it('hero H1 keeps its words apart when the line break is hidden (F-C-08, F-F-19)', () => {
    expect(h1Text(html)).toBe('Carbon accounting as easy as bookkeeping');
  });

  it('names the tier of the card-free trial next to the call to action (F-A-09)', () => {
    expect(text).toContain('14-day free Starter trial · No card required');
    expect(text).toContain('Scope 1 & 2 only');
    expect(text).toContain(`${PLAN_LIMITS.starter.facilities} facility`);
    expect(text).toContain(`${PLAN_LIMITS.starter.csvImportsPerMonth} CSV imports per month`);
  });

  it('shows the whole FAQ that the JSON-LD is generated from (F-F-10)', () => {
    for (const item of faq.home) {
      expect(text, item.q).toContain(item.q);
      expect(text, item.q).toContain(item.a);
    }
  });

  it('keeps live features and roadmap features apart (F-A-02)', () => {
    // The hero pill also says "Live today", so take the later, section-heading one.
    const live = text.lastIndexOf('Live today');
    const next = text.indexOf('Coming next');
    expect(live).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(live);
    // The three live features sit before the roadmap heading, the three roadmap ones after it.
    // Reports went live with K3 (F-C-05): the Reports page generates, lists and signs off PDF reports.
    for (const name of ['Executive Dashboard', 'Data Intake', 'Reports']) {
      const at = text.indexOf(name, live);
      expect(at, name).toBeGreaterThan(live);
      expect(at, name).toBeLessThan(next);
    }
    for (const name of ['AI Carbon Assistant', 'Emissions Ledger', 'Supplier Engagement Hub']) {
      expect(text.indexOf(name, next), name).toBeGreaterThan(next);
    }
    // The framework packages the old "Reporting Center" card described are not built,
    // so they must not reappear as a live feature.
    expect(text.slice(live, next)).not.toMatch(/readiness packages|procurement packets|CBAM supplier data/i);
    expect((html.match(/Coming soon/g) ?? []).length).toBe(3);
  });

  it('renders no composite testimonial cards (F-A-16)', () => {
    expect(html).not.toContain('<blockquote');
    expect(text).not.toContain('What teams will be able to say');
  });

  it('has one three-step flow, not two lists that both start with an import step (F-C-19)', () => {
    expect(text).toContain('Upload your activity CSV');
    expect(text).not.toContain('Four steps to');
    expect((html.match(/id="how-it-works"/g) ?? []).length).toBe(1);
  });

  it('leaves the click-to-play walkthrough visible to reduced-motion users (F-C-24)', () => {
    // The hero background video mounts only after hydration (desktop), so the
    // static render holds just the showcase video.
    const videos = html.match(/<video\b[^>]*>/g) ?? [];
    expect(videos).toHaveLength(1);
    expect(videos[0]).toContain('controls');
    expect(videos[0]).toContain('poster=');
    expect(videos[0]).not.toContain('eco-hero-motion');
    expect(videos[0]).not.toContain('autoplay');
  });
});

describe('methodology page as rendered', () => {
  const html = render('/methodology');
  const text = textOf(html);

  it('hero H1 keeps its words apart when the line break is hidden (F-C-08)', () => {
    expect(h1Text(html)).toBe('How we calculate your carbon footprint');
  });

  it('states the SB 253 status from the regulatory module, dated (F-A-05)', () => {
    expect(text).toContain(REGULATORY.sb253.statement);
    expect(text).toContain('November 10, 2026');
    expect(text).toContain('awaiting approval');
    expect(text).toContain('as of September 29, 2026');
    expect(text).toContain(REGULATORY.sb261.statement);
    expect(text).not.toContain('August 10');
  });

  it('sits its section nav below the site header (F-C-22)', () => {
    // The site header has a <nav> too; pick the in-page one by its anchor links.
    const nav = [...html.matchAll(/<nav\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/nav>/g)]
      .find((m) => (m[2] ?? '').includes('href="#standards"'))?.[1] ?? '';
    expect(nav).toContain('sticky');
    expect(nav).not.toMatch(/\btop-0\b/);
    expect(nav).toContain('top-[57px]');
    expect(nav).toContain('md:top-[63px]');
  });

  it('shows the whole FAQ that the JSON-LD is generated from (F-F-10)', () => {
    for (const item of faq.methodology) {
      expect(text, item.q).toContain(item.q);
      expect(text, item.q).toContain(item.a);
    }
  });

  it('does not say that every number traces to a published dataset (F-A-03)', () => {
    expect(text).not.toMatch(/every number .{0,40}traces/i);
    expect(text).toContain('internal estimates');
  });

  it('says what the product is not for CBAM in the sentence the chatbot uses (D-8)', () => {
    expect(text).toContain(CBAM_PRODUCT_STATEMENT);
    expect(text).toContain('it does not replace an authorized declarant, customs filing, legal review, or required verification');
    expect(text).toContain(REGULATORY['eu-cbam'].statement);
  });
});

describe('pricing page as rendered', () => {
  const html = render('/pricing');
  const text = textOf(html);

  it('opens on monthly billing, so the free trial is offered up front (F-C-10)', () => {
    expect(html).toContain('aria-checked="false"');
    expect(text).toContain('Start free trial');
    expect(text).toContain('a card is required to start it');
  });

  it('says the free trial is offered once per company, as checkout enforces (F-B-18)', () => {
    expect(text).toContain(`${TRIAL_DAYS}-day free trial, once per company · a card is required to start it`);
  });

  it('lists what is not included apart from what is (F-C-10)', () => {
    expect(text).toContain('Not included');
    // Starter: the excluded Scope 3 workflows must not sit in the ticked list.
    const starter = html.slice(html.indexOf('>Starter<'), html.indexOf('>Growth<'));
    const ticked = /<ul[^>]*>([\s\S]*?)<\/ul>/.exec(starter)?.[1] ?? '';
    expect(textOf(ticked)).toContain('Scope 1 & 2 workflows');
    expect(textOf(ticked)).not.toContain('Scope 3 workflows');
  });

  it('shows one badge on the recommended plan (F-C-10, F-C-18)', () => {
    expect((text.match(/Recommended/g) ?? []).length).toBe(1);
    expect(text).not.toContain('Most popular');
  });

  it('uses a plain headline and sells no add-on for an unbuilt feature (F-A-10, F-C-11)', () => {
    expect(h1Text(html)).toBe('Plans for your first GHG inventory');
    expect(text).not.toMatch(/pays for itself/i);
    expect(text).not.toMatch(/supplier requests/i);
    expect(text).not.toMatch(/report templates \(/i);
    expect(text).toContain('Extra facility');
  });

  it('numbers its plan names as H2 under the page H1 (F-C-21)', () => {
    const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => [Number(m[1]), textOf(m[2] ?? '')] as const);
    expect(headings[0]).toEqual([1, 'Plans for your first GHG inventory']);
    for (const name of ['Starter', 'Growth', 'Pro']) {
      expect(headings).toContainEqual([2, name]);
    }
    expect(headings).toContainEqual([3, 'Not included']);
    expect(headings).toContainEqual([3, 'On the roadmap']);
    // No heading skips a level below the previous one.
    for (let i = 1; i < headings.length; i++) {
      expect(headings[i]![0], headings[i]![1]).toBeLessThanOrEqual(headings[i - 1]![0] + 1);
    }
  });
});

describe('contact and demo pages as rendered', () => {
  it('contact: card headings follow the H1 without skipping a level (F-C-21)', () => {
    const html = render('/contact');
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]!, `heading ${i}`).toBeLessThanOrEqual(levels[i - 1]! + 1);
    }
    // The cards beside the form are peers of it, so they are H2s, not sub-sections of
    // "Send us a message". The shared footer (not this page) has its own H3 column titles.
    const footerAt = html.indexOf('<footer');
    const pageOnly = footerAt === -1 ? html : html.slice(0, footerAt);
    expect([...pageOnly.matchAll(/<h3\b/g)]).toHaveLength(0);
  });

  it('contact: still offers the DPA, without presenting it as GDPR compliance (F-A-06)', () => {
    const text = textOf(render('/contact'));
    expect(text).toMatch(/Data Processing Addendum/);
    expect(text).not.toMatch(/GDPR compliance|GDPR[- ]aligned/i);
  });

  it('contact: names the operator and uses the single shared mailbox (F-A-17)', () => {
    const text = textOf(render('/contact'));
    expect(text).toContain('Operated by Developer312, a subsidiary of NIGHT LITE USA LLC');
    expect(text).toContain('hello@developer312.com');
  });

  it('demo: does not promise an evidence index in the walkthrough (F-A-02)', () => {
    expect(textOf(render('/demo'))).not.toMatch(/evidence index/i);
  });
});
