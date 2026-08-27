export interface LeadSubmission {
  type: string;
  name: string;
  email: string;
  company: string;
  message: string;
  source: string;
}

const GENERIC_ERROR = 'We couldn’t send your request right now.';

function responseError(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('error' in body)) return GENERIC_ERROR;
  return typeof body.error === 'string' && body.error.trim() ? body.error : GENERIC_ERROR;
}

export async function submitLead(lead: LeadSubmission): Promise<void> {
  const response = await fetch('/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lead),
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(responseError(body));
  }
}
