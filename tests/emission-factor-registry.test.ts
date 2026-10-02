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

  it('calculator-wired factors are verified:true; roadmap factors are verified:false', () => {
    // EPA/eGRID/IPCC are wired into utils.ts (calculateEmissions) and must be
    // verified:true. GLEC + EXIOBASE are roadmap-only (not consumed by the
    // calculator) and must be verified:false so they render the sentinel.
    // 'ipcc-ar6-gwp100' was a stale id: the registry entry is
    // 'ipcc-ar5-gwp100' (the catalog is AR5 throughout), so this set matched
    // nothing for IPCC and its verified flag went unasserted entirely --
    // flipping it to false would have passed.
    const wired = new Set(['epa-efh-2025', 'epa-egrid-2023', 'ipcc-ar5-gwp100', 'epa-warm-2023', 'desnz-2026']);
    const roadmap = new Set(['glec-v3', 'exiobase-3.8']);
    for (const e of EMISSION_FACTOR_REGISTRY) {
      if (wired.has(e.id)) {
        expect(e.verified, `${e.id} is wired into the calculator → must be verified:true`).toBe(true);
      } else if (roadmap.has(e.id)) {
        expect(e.verified, `${e.id} is roadmap-only → must be verified:false`).toBe(false);
      }
    }
    // Wired as well, but not a published dataset: the catalog's own estimates
    // stay verified:false so they are always flagged (F-E-06).
    expect(EMISSION_FACTOR_REGISTRY.find((e) => e.id === 'internal-estimate')?.verified).toBe(false);
  });

  it('no unverified entry renders without "(verify before publication)"', () => {
    // internal-estimate and the roadmap entries are verified:false; this guard
    // ensures every unverified entry gets the sentinel suffix.
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