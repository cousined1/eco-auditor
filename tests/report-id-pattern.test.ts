// A report id longer than a bigint used to reach Postgres as an out-of-range error and
// answer 500 on download and sign-off (verification D-2); it must be a plain 404, like
// every other id that cannot exist. The pattern is a constant in server.cjs, so this
// reads it from the source rather than starting a server.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('server.cjs'), 'utf8');
const literal = /const REPORT_ID_PATTERN = \/(.+)\/;/.exec(source);

describe('REPORT_ID_PATTERN', () => {
  it('is defined once in server.cjs and used by download and sign-off', () => {
    expect(literal, 'REPORT_ID_PATTERN literal').not.toBeNull();
    expect(source.match(/REPORT_ID_PATTERN\.test\(req\.params\.id\)/g)?.length).toBe(2);
  });

  const pattern = new RegExp(literal?.[1] ?? '$^');

  it.each(['1', '42', '999999999999999999'])('accepts %s (at most 18 digits)', (id) => {
    expect(pattern.test(id)).toBe(true);
  });

  it.each(['', '0x1', '1e5', '-1', '1.5', ' 1', '99999999999999999999', '9223372036854775808'])(
    'refuses %j',
    (id) => {
      expect(pattern.test(id)).toBe(false);
    },
  );
});
