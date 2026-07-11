type InsForgeLikeClient = {
  getHttpClient?: () => {
    getHeaders?: () => Record<string, string>;
  };
};

export function buildApiRequestInit(client: InsForgeLikeClient): RequestInit {
  const sdkHeaders = client.getHttpClient?.().getHeaders?.() || {};
  const authorization = sdkHeaders.Authorization || sdkHeaders.authorization;

  return {
    headers: authorization ? { Authorization: authorization } : {},
  };
}

export type PlanId = 'starter' | 'growth' | 'pro';

export interface UpgradeRequired {
  requiredPlan: PlanId;
  message?: string;
}

// Detects the server's plan-gate 402 response (`{ code: 'upgrade_required',
// requiredPlan }`) so callers can show an upgrade paywall instead of a generic
// error. Uses res.clone() so the caller can still read the body on the happy path.
export async function getUpgradeRequired(res: Response): Promise<UpgradeRequired | null> {
  if (res.status !== 402) return null;
  try {
    const body = await res.clone().json();
    if (body && body.code === 'upgrade_required') {
      const plan = body.requiredPlan;
      const requiredPlan: PlanId = plan === 'growth' || plan === 'pro' ? plan : 'starter';
      return { requiredPlan, message: typeof body.error === 'string' ? body.error : undefined };
    }
  } catch {
    /* not JSON / no body — fall through */
  }
  return null;
}
