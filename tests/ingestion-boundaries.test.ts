import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { calculateEntry, parseEmissionCsv } = require('../emissions-engine.cjs');

describe('ingestion boundaries', () => {
  it.each(['kg CO2e', 'tCO2e'])('rejects misclassified precomputed %s', (unit) => {
    expect(() => calculateEntry({ scope: 'Scope 1', category: 'purchased_goods', amount: 100, unit }))
      .toThrow(/Scope 3/);
  });

  it('preserves quoted newlines, commas and escaped quotes in one record', () => {
    const rows = parseEmissionCsv('scope,category,source,amount,unit,notes\r\nScope 1,stationary_combustion,natural_gas,10,therms,"Invoice, ""A""\r\ncontinued"\r\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].notes).toBe('Invoice, "A"\r\ncontinued');
  });

  it('rejects an unterminated quoted field rather than importing truncated data', () => {
    expect(() => parseEmissionCsv('scope,category,source,amount,unit,notes\nScope 1,fuel,gas,10,therms,"unfinished'))
      .toThrow(/quoted field/);
  });
});
