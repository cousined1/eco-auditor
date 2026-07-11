import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PLANS } from '../src/content/pricing';

// AF-1 — pricing.ts is the single source of truth. Every surface that exposes
// plan prices (JSON-LD schema, UI meta, mockData re-export, salesbot KB, and the
// homepage AggregateOffer) must derive from src/content/pricing.ts so the site
// never shows three different price sets. See `.omo/impl-spec.md` AF-1.
const ROOT = path.resolve(__dirname, '..');

function readSrc(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('AF-1 — pricing single source of truth', () => {
  it('PLANS (src/content/pricing.ts) holds canonical Starter $149 / Growth $399 / Pro $999', () => {
    expect(PLANS.starter.monthly).toBe(149);
    expect(PLANS.growth.monthly).toBe(399);
    expect(PLANS.pro.monthly).toBe(999);
    expect(PLANS.starter.annual).toBe(1490);
    expect(PLANS.growth.annual).toBe(3990);
    expect(PLANS.pro.annual).toBe(9990);
  });

  it('Pricing.tsx PRICING_SCHEMA JSON-LD prices match PLANS (149/399/999)', () => {
    const src = readSrc('src/pages/Pricing.tsx');
    // PRICING_SCHEMA is built from PLANS via PLAN_ORDER.map — assert the prices
    // appear as String(PLANS[id].monthly) in the source, proving it reads from
    // the single source rather than hardcoding stale values.
    expect(src).toContain('PLANS[id].monthly');
    expect(src).toContain('PLANS[id].name');
    // No stale $49 price and no "Free tier" string in Pricing.tsx.
    expect(src).not.toMatch(/\$49/);
    expect(src).not.toContain('Free tier');
  });

  it('Pricing.tsx has no bare $49 and no "free tier" in JSON-LD description', () => {
    const src = readSrc('src/pages/Pricing.tsx');
    // The JSON-LD description must not mention a free tier.
    const schemaBlock = src.match(/PRICING_SCHEMA\s*=\s*\{[\s\S]*?\};/);
    expect(schemaBlock).toBeTruthy();
    expect(schemaBlock![0].toLowerCase()).not.toContain('free tier');
    expect(schemaBlock![0]).not.toMatch(/\$49/);
  });

  it('mockData.ts re-exports PLANS from @/content/pricing (single source)', () => {
    const src = readSrc('src/data/mockData.ts');
    // AF-1: mockData should re-export PLANS from the canonical module, not
    // redefine its own plan prices (which caused the original three-way drift).
    expect(src).toMatch(/export\s*\{[^}]*PLANS[^}]*\}\s*from\s*['"]@\/content\/pricing['"]/);
  });

  it('server.cjs salesbot KB prices contain 149/399/999 and NOT $49 or "Enterprise custom"', () => {
    const src = readSrc('server.cjs');
    // The salesbot KB (ECOAUDITOR_KB) must use canonical plan prices.
    // The main pricing response already shows 149/399/999; assert no stale $49
    // remains anywhere in the salesbot KB block.
    const kbStart = src.indexOf('const ECOAUDITOR_KB');
    expect(kbStart).toBeGreaterThan(-1);
    // ponytail: slice from ECOAUDITOR_KB to the getBotResponse function.
    const kbEnd = src.indexOf('function getBotResponse', kbStart);
    const kbBlock = src.slice(kbStart, kbEnd === -1 ? undefined : kbEnd);
    expect(kbBlock).toContain('149');
    expect(kbBlock).toContain('399');
    expect(kbBlock).toContain('999');
    expect(kbBlock).not.toMatch(/\$49/);
    expect(kbBlock).not.toContain('Enterprise custom');
    expect(kbBlock).not.toContain('Custom pricing');
  });

  it('index.html JSON-LD AggregateOffer has lowPrice=149, highPrice=999 (no $0 free-tier)', () => {
    const src = readSrc('index.html');
    expect(src).toContain('"@type": "AggregateOffer"');
    expect(src).toContain('"lowPrice": "149"');
    expect(src).toContain('"highPrice": "999"');
    // No $0 / free-tier implication in the AggregateOffer.
    const offer = src.match(/"AggregateOffer"[\s\S]*?"offerCount":\s*"\d+"/);
    expect(offer).toBeTruthy();
    expect(offer![0]).not.toMatch(/\$0/);
    expect(offer![0].toLowerCase()).not.toContain('free');
  });
});