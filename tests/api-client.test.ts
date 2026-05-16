import { describe, expect, it } from 'vitest';
import { buildApiRequestInit } from '../src/lib/api';

describe('API request helper', () => {
  it('passes through the current InsForge authorization header', () => {
    const init = buildApiRequestInit({
      getHttpClient() {
        return {
          getHeaders() {
            return { Authorization: 'Bearer token-123', 'x-client': 'sdk' };
          },
        };
      },
    });

    expect(init.headers).toEqual({ Authorization: 'Bearer token-123' });
  });

  it('does not forward non-auth SDK headers to same-origin app APIs', () => {
    const init = buildApiRequestInit({
      getHttpClient() {
        return {
          getHeaders() {
            return { 'x-api-key': 'anon-key' };
          },
        };
      },
    });

    expect(init.headers).toEqual({});
  });
});
