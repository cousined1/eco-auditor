// The browser side of the company API in server.cjs (audit K5: F-B-03 = F-C-03):
// the company profile and its onboarding state, renaming, the reporting basis and
// facility edits. Every call goes through apiFetch, which owns the session token,
// and runs under withDeadline (15 s): a stalled connection ends in an error with a
// retry instead of a spinner that never stops.
//
// The option lists below mirror server-company.cjs (tests/company-screens.test.ts
// fails if they drift). The server is the authority; these only keep the form from
// offering what it would refuse.
import { apiFetch, getUpgradeRequired, type PlanId } from './api';
import { UpgradeRequiredError, createFacility, type FacilityType } from './entries';
import { RequestTimeoutError, withDeadline } from './requestTimeout';

export const INDUSTRIES = [
  'Agriculture & Food',
  'Construction',
  'Energy & Utilities',
  'Financial Services',
  'Healthcare',
  'Hospitality',
  'Manufacturing',
  'Retail & Consumer Goods',
  'Technology',
  'Transportation & Logistics',
  'Other',
] as const;

export const COMPANY_NAME_MAX = 200;
export const FACILITY_FIELD_MAX = 200;
export const BASE_YEAR_MIN = 1990;

export type ConsolidationApproach = 'operational_control' | 'financial_control' | 'equity_share' | 'unspecified';

/** One sentence each, from the GHG Protocol Corporate Standard's definitions. */
export const CONSOLIDATION_OPTIONS: readonly { value: ConsolidationApproach; label: string; explanation: string }[] = [
  { value: 'unspecified', label: 'Not chosen yet', explanation: 'Reports will say “not specified” until you choose an approach.' },
  { value: 'operational_control', label: 'Operational control', explanation: 'You account for all emissions from the operations you control.' },
  { value: 'financial_control', label: 'Financial control', explanation: 'You account for all emissions from the operations you control financially.' },
  { value: 'equity_share', label: 'Equity share', explanation: 'You account for each operation’s emissions in proportion to your ownership share of it.' },
];

export const CONSOLIDATION_HINT = 'The GHG Protocol asks a company to state how it consolidates emissions.';
export const BASE_YEAR_HINT =
  'The year your emissions are compared against over time, for example 2019. Leave it empty if you have not set one: reports then say “not set”.';

export interface CompanyProfile {
  id: number;
  name: string;
  industry: string | null;
  consolidation_approach: ConsolidationApproach;
  base_year: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface OnboardingState {
  /** The server made the company and the customer has neither named it nor chosen "Finish later". */
  needs_onboarding: boolean;
  auto_provisioned: boolean;
  completed_at: string | null;
  skipped_at: string | null;
}

/** Each step ticks from what is stored, not from a flag that stays ticked after the data is gone. */
export interface Checklist {
  company_named: boolean;
  facility_added: boolean;
  data_added: boolean;
  report_generated: boolean;
  complete: boolean;
}

export interface CompanyFacility {
  id: number;
  company_id: number;
  name: string;
  type: FacilityType | null;
  city: string | null;
}

export interface CompanyOverview {
  company: CompanyProfile;
  onboarding: OnboardingState;
  facilities: CompanyFacility[];
  /** The caller's active plan and its facility cap (null: no cap). */
  plan: { id: PlanId; facility_limit: number | null };
  checklist: Checklist;
}

export interface CompanyPatch {
  name?: string;
  industry?: string | null;
  consolidation_approach?: ConsolidationApproach;
  base_year?: number | null;
}

/** A refusal or failure with the server's own message (validation, ownership, a facility still in use). */
export class CompanyApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'CompanyApiError';
    this.status = status;
    this.code = code;
  }
}

/** What a form shows for any failure of these calls. */
export function describeError(err: unknown, fallback: string): string {
  if (err instanceof RequestTimeoutError) return 'That took too long. Check your connection and try again.';
  return err instanceof Error && err.message ? err.message : fallback;
}

/** The plan that raises the facility cap, for the upgrade prompt. */
export function nextPlanForFacilities(plan: PlanId): PlanId {
  return plan === 'starter' ? 'growth' : 'pro';
}

/** The select value for a stored industry: the list entry, or "Other" for the server's own 'other'. */
export function industryValue(industry: string | null): string {
  if (industry === null) return '';
  if ((INDUSTRIES as readonly string[]).includes(industry)) return industry;
  return industry.toLowerCase() === 'other' ? 'Other' : '';
}

/**
 * The base year field: empty is allowed (no base year), otherwise a four-digit year
 * from 1990 to this year. The server bounds it with the UTC year, so does this.
 */
export function parseBaseYear(text: string, now: Date = new Date()): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: null };
  const latest = now.getUTCFullYear();
  const year = Number(trimmed);
  if (!/^\d{4}$/.test(trimmed) || year < BASE_YEAR_MIN || year > latest) {
    return { ok: false, error: `Enter a year from ${BASE_YEAR_MIN} to ${latest}, or leave it empty.` };
  }
  return { ok: true, value: year };
}

async function failure(res: Response, fallback: string): Promise<Error> {
  const upgrade = await getUpgradeRequired(res);
  if (upgrade) return new UpgradeRequiredError(upgrade);
  const body = (await res.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
  const message = typeof body.error === 'string' && body.error ? body.error : `${fallback} (${res.status})`;
  return new CompanyApiError(message, res.status, typeof body.code === 'string' ? body.code : undefined);
}

function asFacility(row: { id: unknown; company_id: unknown; name: unknown; type?: unknown; city?: unknown }): CompanyFacility {
  return {
    id: Number(row.id),
    company_id: Number(row.company_id),
    name: String(row.name),
    type: row.type === 'office' || row.type === 'factory' || row.type === 'warehouse' ? row.type : null,
    city: typeof row.city === 'string' ? row.city : null,
  };
}

function bounded<T>(run: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal): Promise<T> {
  return withDeadline(run, outer ? { signal: outer } : {});
}

/** The company, whether onboarding is pending, its facilities, the plan cap and the checklist. */
export function getCompanyOverview(signal?: AbortSignal): Promise<CompanyOverview> {
  return bounded(async (inner) => {
    const res = await apiFetch('/api/company', { signal: inner });
    if (!res.ok) throw await failure(res, 'Loading your company failed');
    const body = (await res.json()) as Partial<CompanyOverview> & { success?: boolean };
    if (!body.success || !body.company || !body.onboarding || !Array.isArray(body.facilities) || !body.plan || !body.checklist) {
      throw new CompanyApiError('The company details came back in an unexpected shape. Please try again.', res.status);
    }
    return {
      company: body.company,
      onboarding: body.onboarding,
      facilities: body.facilities.map(asFacility),
      plan: body.plan,
      checklist: body.checklist,
    };
  }, signal);
}

/** Saves company fields. Saving a name is what ends onboarding. */
export function updateCompany(companyId: number, patch: CompanyPatch): Promise<{ company: CompanyProfile; onboarding: OnboardingState }> {
  return bounded(async (signal) => {
    const res = await apiFetch(`/api/companies/${encodeURIComponent(String(companyId))}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
      signal,
    });
    if (!res.ok) throw await failure(res, 'Saving the company failed');
    const body = (await res.json()) as { data: CompanyProfile; onboarding: OnboardingState };
    return { company: body.data, onboarding: body.onboarding };
  });
}

/** "Finish later": onboarding stops being the first screen; the dashboard checklist stays. */
export function skipOnboarding(companyId: number): Promise<OnboardingState> {
  return bounded(async (signal) => {
    const res = await apiFetch(`/api/companies/${encodeURIComponent(String(companyId))}/onboarding/skip`, { method: 'POST', signal });
    if (!res.ok) throw await failure(res, 'Could not save that choice');
    return ((await res.json()) as { onboarding: OnboardingState }).onboarding;
  });
}

/** Adds a facility; the server applies the plan's cap under a lock and answers 402 at it. */
export function addFacility(companyId: number, facility: { name: string; type: FacilityType; city: string }): Promise<CompanyFacility> {
  return bounded(async (signal) => asFacility(await createFacility(companyId, facility, signal)));
}

export function updateFacility(
  companyId: number,
  facilityId: number,
  patch: { name?: string; type?: FacilityType; city?: string },
): Promise<CompanyFacility> {
  return bounded(async (signal) => {
    const res = await apiFetch(`/api/companies/${encodeURIComponent(String(companyId))}/facilities/${encodeURIComponent(String(facilityId))}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
      signal,
    });
    if (!res.ok) throw await failure(res, 'Saving the facility failed');
    return asFacility(((await res.json()) as { data: CompanyFacility }).data);
  });
}

/** Deletes a facility; the server refuses (409, code facility_has_entries) while entries point at it. */
export function deleteFacility(companyId: number, facilityId: number): Promise<void> {
  return bounded(async (signal) => {
    const res = await apiFetch(`/api/companies/${encodeURIComponent(String(companyId))}/facilities/${encodeURIComponent(String(facilityId))}`, {
      method: 'DELETE',
      signal,
    });
    if (!res.ok) throw await failure(res, 'Deleting the facility failed');
  });
}
