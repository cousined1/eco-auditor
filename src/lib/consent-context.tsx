/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback } from 'react';

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

export type ConsentContextType = {
  consentState: ConsentState;
  updateConsent: (categories: Partial<ConsentCategories>) => void;
  acceptAll: () => void;
  rejectAll: () => void;
  resetConsent: () => void;
};

const CONSENT_STORAGE_KEY = 'eco_consent';
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
      return JSON.parse(stored);
    }
  } catch {
    // ignore parse errors
  }
  return defaultConsentState;
}

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [consentState, setConsentState] = useState<ConsentState>(() => readConsentFromStorage());

  const updateConsent = useCallback(async (categories: Partial<ConsentCategories>) => {
    const updated: ConsentCategories = {
      ...consentState.consent,
      ...categories,
      strictlyNecessary: true, // always on
    };
    const timestamp = new Date().toISOString();
    const next: ConsentState = {
      consent: updated,
      timestamp,
      policyVersion: POLICY_VERSION,
      hasConsented: true,
    };
    setConsentState(next);
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(next));
  }, [consentState]);

  const acceptAll = useCallback(() => {
    updateConsent({
      analytics: true,
      preferences: true,
      marketing: true,
    });
  }, [updateConsent]);

  const rejectAll = useCallback(() => {
    updateConsent({
      analytics: false,
      preferences: false,
      marketing: false,
    });
  }, [updateConsent]);

  const resetConsent = useCallback(() => {
    localStorage.removeItem(CONSENT_STORAGE_KEY);
    setConsentState({ ...defaultConsentState, hasConsented: false });
  }, []);

  return (
    <ConsentContext.Provider value={{ consentState, updateConsent, acceptAll, rejectAll, resetConsent }}>
      {children}
    </ConsentContext.Provider>
  );
}

export function useConsent() {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error('useConsent must be used inside <ConsentProvider>');
  return ctx;
}
