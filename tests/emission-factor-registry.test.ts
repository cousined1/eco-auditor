import { describe, it, expect } from 'vitest';
import { EMISSION_FACTOR_REGISTRY, factorLabel } from '../src/lib/emission-factors/registry';

describe('emission-factor registry (P0-04)', () => {
  it('every entry has publishedYear, dataYear, and a boolean verified', () => {
    for (const e of EMISSION_FACTOR_REGISTRY) {
      expect(typeof e.publishedYear, `${e.id}.publishedYear`).toBe('number');
      expect(typeof e.dataYear, `${e.id}.dataYear`).toBe('number');
      expect(typeof e.verified, `${e.id}.verified`).toBe('boolean');
    }
  });

  it('all entries are verified:true (publicly published sources)', () => {
    for (const e of EMISSION_FACTOR_REGISTRY) {
      expect(e.verified, `${e.id} must be verified:true`).toBe(true);
    }
  });

  it('no unverified entry renders without "(verify before publication)"', () => {
    // All are verified:true today, so factorLabel returns the bare label; this
    // guard ensures any future unverified entry gets the sentinel suffix.
    for (const e of EMISSION_FACTOR_REGISTRY) {
      const label = factorLabel(e.id);
      if (!e.verified) {
        expect(label, `${e.id} unverified must carry sentinel`).toContain('(verify before publication)');
      }
    }
  });

  it("factorLabel('epa-egrid-2023') === 'eGRID2023'", () => {
    expect(factorLabel('epa-egrid-2023')).toBe('eGRID2023');
  });

  it("factorLabel('nonexistent') === '(verify before publication)'", () => {
    expect(factorLabel('nonexistent')).toBe('(verify before publication)');
  });

  it('eGRID2023 uses dataYear 2023 and publishedYear 2025', () => {
    const e = EMISSION_FACTOR_REGISTRY.find((x) => x.id === 'epa-egrid-2023');
    expect(e?.dataYear).toBe(2023);
    expect(e?.publishedYear).toBe(2025);
    expect(e?.label).toBe('eGRID2023');
  });

  it('EPA GHG Factor Hub 2025 uses dataYear 2024 and publishedYear 2025', () => {
    const e = EMISSION_FACTOR_REGISTRY.find((x) => x.id === 'epa-efh-2025');
    expect(e?.dataYear).toBe(2024);
    expect(e?.publishedYear).toBe(2025);
  });
});