/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { applyPrivacySignals, syncConsentMode } from './consent-mode';
import { flushConsentAuditOutbox, submitConsentAudit } from './consent-audit';

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

type InitialConsent = {
  state: ConsentState;
  // True when a privacy signal decided (or overrode) the state on this load, so
  // the mount effect persists it and writes the evidence record.
  recordSignal: boolean;
};

// The state a page load starts from, with the browser's privacy signals applied
// on EVERY load, not only when nothing is stored (F-F-05):
//  - no stored decision and a signal: auto-reject non-essential categories, no banner;
//  - a stored decision the signal contradicts (an "Accept" given before the visitor
//    turned on Global Privacy Control): the signal wins and the change is recorded.
// Once the override is stored it no longer contradicts the signal, so the next load
// writes nothing: one evidence record per conflict.
function resolveInitialConsent(signals: PrivacySignals): InitialConsent {
  const stored = readConsentFromStorage();
  if (stored.hasConsented) {
    const consent = applyPrivacySignals(stored.consent, signals);
    const contradicted = consent.analytics !== stored.consent.analytics || consent.marketing !== stored.consent.marketing;
    return contradicted ? { state: { ...stored, consent }, recordSignal: true } : { state: stored, recordSignal: false };
  }
  if (signals.gpc || signals.dnt) return { state: { ...defaultConsentState, hasConsented: true }, recordSignal: true };
  return { state: stored, recordSignal: false };
}

function persistConsent(state: ConsentState): void {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be blocked (SecurityError, e.g. "Block all cookies"); keep the
    // in-memory state and skip persistence instead of throwing above the app
    // ErrorBoundary (FEW-01, same guard as useTheme).
  }
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

// Server-side audit trail (GDPR/CCPA evidence). Delivery, retry with Retry-After
// and the durable outbox live in consent-audit.ts (UXE-006, F-X1-02); failures
// never block the UI. Every decision calls this exactly once.
function recordConsentAudit(consent: ConsentCategories, signals: PrivacySignals, method: ConsentMethod): void {
  submitConsentAudit({
    visitorId: getVisitorId(),
    consent,
    policyVersion: POLICY_VERSION,
    method,
    gpc: signals.gpc,
    dnt: signals.dnt,
  });
}

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [privacySignals] = useState<PrivacySignals>(() => detectPrivacySignals());
  const [initial] = useState<InitialConsent>(() => resolveInitialConsent(privacySignals));
  const [consentState, setConsentState] = useState<ConsentState>(initial.state);
  const handledMount = useRef(false);

  // Once per page load (not on every consent change: that wrote a second, spurious
  // record when "Cookie preferences" reset the choice, F-F-16): deliver records an
  // earlier load could not, and persist and audit a choice a privacy signal made.
  useEffect(() => {
    if (handledMount.current) return;
    handledMount.current = true;
    flushConsentAuditOutbox();
    if (!initial.recordSignal) return;
    const record: ConsentState = { ...initial.state, timestamp: new Date().toISOString() };
    persistConsent(record);
    recordConsentAudit(record.consent, privacySignals, 'privacy_signal');
  }, [initial, privacySignals]);

  // Google's tags learn the choice here, including the Marketing toggle and a
  // withdrawal after the container has loaded (F-F-05).
  useEffect(() => {
    syncConsentMode(consentState.consent, privacySignals);
  }, [consentState.consent, privacySignals]);

  const updateConsent = useCallback((categories: Partial<ConsentCategories>, method: ConsentMethod = 'custom') => {
    // Privacy signals are opt-outs the user set at the browser level; they take
    // precedence over in-page consent choices.
    const updated = applyPrivacySignals({ ...consentState.consent, ...categories }, privacySignals);
    const timestamp = new Date().toISOString();
    const next: ConsentState = {
      consent: updated,
      timestamp,
      policyVersion: POLICY_VERSION,
      hasConsented: true,
    };
    setConsentState(next);
    // Blocked storage must not escape the click handler: consent still applies for
    // this session via the in-memory state (FEW-01).
    persistConsent(next);
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
