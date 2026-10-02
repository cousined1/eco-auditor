// Emission entries and facilities through Eco-Auditor's own API (audit K2).
//
// The calculator and onboarding used to write both tables straight through the
// InsForge records API as the browser role, where only ownership is checked: no
// plan, no trial end, no Scope 3 gate, and CO2e computed in the browser stored
// as sent. These wrappers are the SPA's only write path for them; server.cjs
// computes every value from the factor catalog. tests/sdk-write-guard.test.ts
// fails if a file writes either table through the SDK again.
import { apiFetch, getUpgradeRequired, type PlanId, type UpgradeRequired } from './api';
import { PLAN_LIMITS } from '../content/pricing';
import type { EmissionEntry, Facility } from '../components/carbon-calculator/utils';

/** A 402 from the plan gate: the caller shows an upgrade prompt, not an error. */
export class UpgradeRequiredError extends Error {
  readonly upgrade: UpgradeRequired;

  constructor(upgrade: UpgradeRequired) {
    super(upgrade.message || 'This needs a plan upgrade.');
    this.name = 'UpgradeRequiredError';
    this.upgrade = upgrade;
  }
}

/** What the client sends for an entry. CO2e, the factor and the confidence are the server's. */
export interface EntryInput {
  scope: string;
  category: string;
  source: string;
  amount: number;
  unit: string;
  /** YYYY-MM-DD: when the activity happened. It decides the reporting year. */
  activity_date: string;
  facility_id: number | null;
}

/**
 * What an edit may change (PATCH /api/entries/:id). The server recomputes CO2e and
 * the factor from the result; anything it does not list is ignored. A row saved
 * before the activity was recorded needs amount, unit and activity_date together.
 */
export interface EntryPatch {
  amount?: number;
  unit?: string;
  activity_date?: string;
  facility_id?: number | null;
}

export type FacilityType = 'office' | 'factory' | 'warehouse';

export const FACILITY_TYPES: readonly { value: FacilityType; label: string }[] = [
  { value: 'office', label: 'Office' },
  { value: 'factory', label: 'Factory' },
  { value: 'warehouse', label: 'Warehouse' },
];

const PLAN_ORDER: readonly PlanId[] = ['starter', 'growth', 'pro'];

/** The cheapest plan that includes Scope 3 (plan-limits.json, the file the server enforces). */
export const SCOPE3_PLAN: PlanId = PLAN_ORDER.find((plan) => PLAN_LIMITS[plan].scope3) ?? 'growth';

async function failure(res: Response, fallback: string): Promise<Error> {
  const upgrade = await getUpgradeRequired(res);
  if (upgrade) return new UpgradeRequiredError(upgrade);
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return new Error(typeof body.error === 'string' && body.error ? body.error : `${fallback} (${res.status})`);
}

/**
 * One key per entry the user means to save: a retry of the same form contents
 * reuses it (the server answers with the row it already stored), a new entry
 * gets a new one.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The caller's entries, newest first, with the CO2e the dashboard counts for each. */
export async function listEntries(signal?: AbortSignal): Promise<EmissionEntry[]> {
  const res = await apiFetch('/api/entries', signal ? { signal } : {});
  if (!res.ok) throw await failure(res, 'Loading your entries failed');
  const body = (await res.json()) as { data?: EmissionEntry[] };
  return Array.isArray(body.data) ? body.data : [];
}

export async function createEntry(entry: EntryInput, idempotencyKey: string): Promise<EmissionEntry> {
  const res = await apiFetch('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw await failure(res, 'Saving the entry failed');
  return ((await res.json()) as { data: EmissionEntry }).data;
}

/**
 * Edits an entry. The server re-prices it (unless only the date or facility
 * changed), stamps updated_at and keeps the old values in the entry history, and
 * answers with the stored entry.
 */
export async function updateEntry(id: number | string, patch: EntryPatch, signal?: AbortSignal): Promise<EmissionEntry> {
  const res = await apiFetch(`/api/entries/${encodeURIComponent(String(id))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw await failure(res, 'Saving the change failed');
  return ((await res.json()) as { data: EmissionEntry }).data;
}

export async function deleteEntry(id: number | string): Promise<void> {
  const res = await apiFetch(`/api/entries/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
  if (!res.ok) throw await failure(res, 'Deleting the entry failed');
}

/** Adds a facility; the server enforces the plan's facility cap under a lock. */
export async function createFacility(
  companyId: number,
  facility: { name: string; type: FacilityType; city: string },
  signal?: AbortSignal,
): Promise<Facility> {
  const res = await apiFetch(`/api/companies/${encodeURIComponent(String(companyId))}/facilities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(facility),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw await failure(res, 'Creating the facility failed');
  const data = ((await res.json()) as { data: Facility }).data;
  // The database returns bigint ids as strings; the rest of the app uses numbers.
  return { ...data, id: Number(data.id), company_id: Number(data.company_id) };
}

/**
 * Whether the account's current plan includes Scope 3, or null when that is
 * unknown (the form then leaves the decision to the server's 402).
 */
export async function planIncludesScope3(signal?: AbortSignal): Promise<boolean | null> {
  try {
    const res = await apiFetch('/api/billing', signal ? { signal } : {});
    if (!res.ok) return null;
    const billing = (await res.json()) as { active?: boolean; plan?: string | null };
    if (!billing.active) return false;
    const plan = PLAN_ORDER.find((id) => id === billing.plan);
    return plan ? PLAN_LIMITS[plan].scope3 : null;
  } catch {
    return null;
  }
}
