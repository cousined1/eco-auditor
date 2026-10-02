// A GET /api/company answer for tests of screens that load the company (K5). The
// default is a company with a name of its own, nothing pending and nothing to
// set up; pass the parts a test is about.
import { act } from 'react';
import type { CompanyOverview } from '../../src/lib/company';

export const COMPANY_URL = '/api/company';

/**
 * The shell loads the onboarding gate and then the page as lazy chunks, the gate after one
 * company fetch. Wait until <main> stops saying "Loading…" rather than a fixed delay: the
 * first mount in a file pays the chunk's transform time, and a full run is heavily loaded.
 */
export async function settleShell(container: HTMLElement) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  for (let waited = 0; waited < 200 && /Loading/.test(container.querySelector('main')?.textContent ?? ''); waited += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

type Parts = {
  company?: Partial<CompanyOverview['company']>;
  onboarding?: Partial<CompanyOverview['onboarding']>;
  facilities?: CompanyOverview['facilities'];
  plan?: Partial<CompanyOverview['plan']>;
  checklist?: Partial<Omit<CompanyOverview['checklist'], 'complete'>>;
};

export function companyOverview(parts: Parts = {}) {
  const steps = { company_named: true, facility_added: true, data_added: true, report_generated: true, ...parts.checklist };
  return {
    success: true,
    company: {
      id: 7, name: 'Northstar Foods', industry: 'Manufacturing', consolidation_approach: 'unspecified', base_year: null,
      created_at: '2026-09-01T10:00:00.000Z', updated_at: '2026-09-01T10:00:00.000Z', ...parts.company,
    },
    onboarding: { needs_onboarding: false, auto_provisioned: false, completed_at: null, skipped_at: null, ...parts.onboarding },
    facilities: parts.facilities ?? [],
    plan: { id: 'starter', facility_limit: 1, ...parts.plan },
    checklist: { ...steps, complete: Object.values(steps).every(Boolean) },
  };
}

/** The placeholder company the server makes on the first call: pending onboarding, nothing done. */
export function placeholderOverview(parts: Parts = {}) {
  return companyOverview({
    ...parts,
    company: { name: 'ada Organization', industry: 'other', ...parts.company },
    onboarding: { needs_onboarding: true, auto_provisioned: true, ...parts.onboarding },
    checklist: { company_named: false, facility_added: false, data_added: false, report_generated: false, ...parts.checklist },
  });
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
