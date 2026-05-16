---
type: pattern
tags: [ecoauditor, insforge, oauth, social-login]
confidence: high
created: 2026-05-15
source: "social-login implementation - trace: [helper tests: COMPLETED, login route: COMPLETED, callback route: COMPLETED, lint/test/build: COMPLETED] outcome: SUCCESS"
supersedes: null
---

# InsForge OAuth Entry Point

EcoAuditor uses a dedicated `/login` route for social sign-in instead of sending public CTAs directly to `/app`. The login page calls `insforge.auth.signInWithOAuth()` for Google and Apple, with `/auth/callback` as the app redirect target.

## When This Applies

Use this pattern for browser-based OAuth in the Vite app. The InsForge SDK handles the PKCE callback exchange when initialized on the callback page.

## When This Does Not Apply

Do not use this pattern for SSR-managed cookies or backend-only OAuth exchange. EcoAuditor is currently a Vite SPA.
