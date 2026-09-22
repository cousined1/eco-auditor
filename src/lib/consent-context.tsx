/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export type ConsentCategories = {
  strictlyNecessary: boolean;
  analytics: boolean;
  preferences: boolean;
  marketing: boolean;
};

export type ConsentState = {
  consent: ConsentCategories;
  timestamp: string | null;
  policyVersion: string;
  hasConsented: boolean;
};

export type PrivacySignals = {
  gpc: boolean;
  dnt: boolean;
};

export type ConsentMethod = 'accept_all' | 'reject_all' | 'custom' | 'privacy_signal' | 'reset';

export type ConsentContextType = {
  consentState: ConsentState;
  privacySignals: PrivacySignals;
  updateConsent: (categories: Partial<ConsentCategories>, method?: ConsentMethod) => void;
  acceptAll: () => void;
  rejectAll: () => void;
  resetConsent: () => void;
};

const CONSENT_STORAGE_KEY = 'eco_consent';
const CONSENT_VISITOR_KEY = 'eco_consent_visitor';
const POLICY_VERSION = '1.0.0';

const defaultConsent: ConsentCategories = {
  strictlyNecessary: true,
  analytics: false,
  preferences: false,
  marketing: false,
};

const defaultConsentState: ConsentState = {
  consent: defaultConsent,
  timestamp: null,
  policyVersion: POLICY_VERSION,
  hasConsented: false,
};

const ConsentContext = createContext<ConsentContextType | undefined>(undefined);

function readConsentFromStorage(): ConsentState {
  if (typeof window === 'undefined') return defaultConsentState;
  try {
    const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ConsentState>;
      if (parsed.policyVersion !== POLICY_VERSION) {
        localStorage.removeItem(CONSENT_STORAGE_KEY);
        return defaultConsentState;
      }
      return { ...defaultConsentState, ...parsed, policyVersion: POLICY_VERSION };
    }
  } catch {
    // ignore parse errors
  }
  return defaultConsentState;
}

// Detects browser opt-out preference signals: Global Privacy Control (GPC)
// and the legacy Do Not Track (DNT) header.
function detectPrivacySignals(): PrivacySignals {
  if (typeof navigator === 'undefined') return { gpc: false, dnt: false };
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const win = typeof window !== 'undefined' ? (window as Window & { doNotTrack?: string }) : undefined;
  const dntValue = nav.doNotTrack ?? nav.msDoNotTrack ?? win?.doNotTrack ?? null;
  return {
    gpc: nav.globalPrivacyControl === true,
    dnt: dntValue === '1' || dntValue === 'yes',
  };
}

// When a privacy signal is present and the visitor has no stored decision,
// honor the signal by auto-rejecting non-essential categories (no banner).
function initialConsentState(signals: PrivacySignals): ConsentState {
  const stored = readConsentFromStorage();
  if (stored.hasConsented || (!signals.gpc && !signals.dnt)) return stored;
  return { ...defaultConsentState, hasConsented: true };
}

function getVisitorId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    let id = localStorage.getItem(CONSENT_VISITOR_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CONSENT_VISITOR_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

// Best-effort server-side audit trail; failures never block the UI.
// UXE-006: a failure is no longer swallowed silently. The server answers
// 503 {retryable:true} when it could not persist the record (GDPR/CCPA
// evidence); the client retries once and then surfaces the failure loudly
// (console.warn) so outages are observable instead of silent evidence loss.
function recordConsentAudit(consent: ConsentCategories, signals: PrivacySignals, method: ConsentMethod): void {
  if (typeof fetch === 'undefined') return;
  const post = (): Promise<Response> => fetch('/api/consent-audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      visitorId: getVisitorId(),
      consent,
      policyVersion: POLICY_VERSION,
      method,
      gpc: signals.gpc,
      dnt: signals.dnt,
    }),
    keepalive: true,
    signal: AbortSignal.timeout(15000), // RT-06: bounded fetch
  });
  const attempt = (retriesLeft: number): void => {
    post().then((res) => {
      if (res.ok) return;
      if (retriesLeft > 0 && res.status === 503) {
        window.setTimeout(() => attempt(retriesLeft - 1), 1000);
        return;
      }
      console.warn(`[ConsentAudit] consent record not persisted (HTTP ${res.status})`);
    }).catch(() => {
      if (retriesLeft > 0) {
        window.setTimeout(() => attempt(retriesLeft - 1), 1000);
        return;
      }
      console.warn('[ConsentAudit] consent record not persisted (network failure)');
    });
  };
  attempt(1);
}

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [privacySignals] = useState<PrivacySignals>(() => detectPrivacySignals());
  const [consentState, setConsentState] = useState<ConsentState>(() => initialConsentState(privacySignals));

  // Persist and audit the auto-applied privacy-signal rejection once.
  useEffect(() => {
    if (!privacySignals.gpc && !privacySignals.dnt) return;
    try {
      const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
      if (stored && (JSON.parse(stored) as Partial<ConsentState>).hasConsented) return;
    } catch {
      // fall through and write a fresh record
    }
    const record: ConsentState = { ...consentState, timestamp: new Date().toISOString() };
    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
    } catch {
      // Storage may be blocked (SecurityError, e.g. "Block all cookies"); keep
      // the in-memory state and skip persistence instead of throwing above the
      // app ErrorBoundary (FEW-01, same guard as useTheme).
    }
    recordConsentAudit(record.consent, privacySignals, 'privacy_signal');
  }, [consentState, privacySignals]);

  const updateConsent = useCallback((categories: Partial<ConsentCategories>, method: ConsentMethod = 'custom') => {
    const updated: ConsentCategories = {
      ...consentState.consent,
      ...categories,
      strictlyNecessary: true, // always on
      // Privacy signals are opt-outs the user set at the browser level;
      // they take precedence over in-page consent choices.
      ...(privacySignals.dnt ? { analytics: false } : {}),
      ...(privacySignals.gpc ? { marketing: false } : {}),
    };
    const timestamp = new Date().toISOString();
    const next: ConsentState = {
      consent: updated,
      timestamp,
      policyVersion: POLICY_VERSION,
      hasConsented: true,
    };
    setConsentState(next);
    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Blocked storage must not escape the click handler: consent still
      // applies for this session via the in-memory state (FEW-01).
    }
    recordConsentAudit(updated, privacySignals, method);
  }, [consentState, privacySignals]);

  const acceptAll = useCallback(() => {
    updateConsent({
      analytics: true,
      preferences: true,
      marketing: true,
    }, 'accept_all');
  }, [updateConsent]);

  const rejectAll = useCallback(() => {
    updateConsent({
      analytics: false,
      preferences: false,
      marketing: false,
    }, 'reject_all');
  }, [updateConsent]);

  const resetConsent = useCallback(() => {
    try {
      localStorage.removeItem(CONSENT_STORAGE_KEY);
    } catch {
      // Storage unavailable — fall through and reset the in-memory state.
    }
    setConsentState({ ...defaultConsentState, hasConsented: false });
    recordConsentAudit(defaultConsent, privacySignals, 'reset');
  }, [privacySignals]);

  return (
    <ConsentContext.Provider value={{ consentState, privacySignals, updateConsent, acceptAll, rejectAll, resetConsent }}>
      {children}
    </ConsentContext.Provider>
  );
}

export function useConsent() {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error('useConsent must be used inside <ConsentProvider>');
  return ctx;
}
