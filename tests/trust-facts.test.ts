import { describe, it, expect } from 'vitest';
import { trustFacts, renderFact } from '../src/content/trust-facts';

describe('trustFacts (P0-06)', () => {
  it('every scalar field has a `verified` boolean', () => {
    const scalarKeys = [
      'encryptionInTransitMinimum',
      'preferredTransport',
      'encryptionAtRest',
      'accountDeletionRequestWindowDays',
      'postTerminationRetentionDays',
      'backupsDeletionWindowDays',
      'contentUsedForModelTraining',
      'soc2Status',
      'cloudHosting',
    ] as const;
    for (const k of scalarKeys) {
      const f = trustFacts[k] as { verified: unknown };
      expect(typeof f.verified, `${k}.verified must be boolean`).toBe('boolean');
    }
  });

  it('every subprocessor entry has a `verified` boolean', () => {
    for (const s of trustFacts.subprocessors) {
      expect(typeof s.verified).toBe('boolean');
    }
  });

  it('verified:false scalar fields do NOT expose a fabricated concrete value', () => {
    // 30 is the documented code value (not fabricated); 'VERIFY' is the sentinel (not fabricated).
    // Any other concrete value on a verified:false fact would be an invented claim.
    expect(trustFacts.backupsDeletionWindowDays.value).toBe(30);
    expect(trustFacts.backupsDeletionWindowDays.verified).toBe(false);
    expect(trustFacts.cloudHosting.value).toBe('VERIFY');
    expect(trustFacts.cloudHosting.verified).toBe(false);
  });

  it('verified:false subprocessor entries use the VERIFY sentinel for processingRegion', () => {
    for (const s of trustFacts.subprocessors) {
      if (!s.verified) {
        expect(s.processingRegion, `${s.name} must use VERIFY sentinel`).toBe('VERIFY');
      }
    }
  });

  it('renderFact returns "(verify before publication)" for verified:false and the string value for verified:true', () => {
    expect(renderFact(trustFacts.backupsDeletionWindowDays)).toBe('(verify before publication)');
    expect(renderFact(trustFacts.cloudHosting)).toBe('(verify before publication)');
    expect(renderFact(trustFacts.encryptionAtRest)).toBe('AES-256');
    expect(renderFact(trustFacts.soc2Status)).toBe('in progress (Q3 2026)');
    expect(renderFact(trustFacts.postTerminationRetentionDays)).toBe('90');
  });
});