// @vitest-environment node
/**
 * D-5 (VERIFY-FINAL-DATA I3): POST /api/calculate prices a preview from the
 * activity alone. The engine honours the pin a stored row carries (factor_value),
 * and the preview used to spread the client's entry over its own, so a client-sent
 * factor_value priced it: 0 t for 100,000 kWh, where the entry saved from the same
 * input is 19.504 t. Nothing is stored by a preview, but it disagreed with the
 * entry it stands for.
 *
 * A real spawned server (tests/helpers/spawn-server.ts), no Docker: the pg double
 * answers the company and billing rows the guards read (`data-down`), and the
 * preview needs nothing else from the database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type Spawned } from './helpers/spawn-server';

const TOKEN = 'calculate-preview-token';
const CAMX = { scope: 'Scope 2', category: 'purchased_electricity', source: 'CAMX', amount: 100000, unit: 'kWh', activity_date: '2026-03-15' };
const CAMX_TONNES = 19.504; // 100,000 kWh x 0.19504 kg per kWh (eGRID2023 CAMX)

let app: Spawned;

beforeAll(async () => {
  app = await startServer({ ALLOW_DEV_AUTH: 'true', DEV_AUTH_SECRET: TOKEN, DEV_COMPANY_ID: 'test-company-1' }, { fakePg: 'data-down' });
}, 60_000);

afterAll(() => app?.stop());

async function preview(entry: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${app.base}/api/calculate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ entries: [entry], period: '2026' }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

describe('POST /api/calculate (D-5)', () => {
  it('prices the activity at the current catalog', async () => {
    expect((await preview(CAMX)).total_emissions_tCO2e).toBeCloseTo(CAMX_TONNES, 6);
  });

  // Each of these names a price, a catalog or a score the client has no say in.
  it.each([
    ['factor_value 0', { factor_value: 0 }],
    ['a factor_value of 1 kg per kWh', { factor_value: 1 }],
    ['a made-up factor_source', { factor_source: 'made-up-dataset' }],
    ['the frozen catalog_version', { catalog_version: '2026-07-24+9841b57be1f6' }],
    ['a CO2e total', { co2e_kg: 1 }],
    ['a confidence', { confidence: 5 }],
  ])('answers what it answers without %s', async (_label, extra) => {
    expect(await preview({ ...CAMX, ...extra })).toEqual(await preview(CAMX));
  });
});
