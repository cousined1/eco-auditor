# Eco-Auditor — Customer Experience Audit Report

**Date**: 2026-08-16
**Auditor**: Automated (codebase + live-site SEO/security findings)
**Scope**: Full customer journey — landing, marketing, auth, app shell, states, trust, mobile, accessibility, performance, code quality

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | — |
| High | 4 | All fixed |
| Medium | 6 | All fixed |
| Low | 3 | All fixed |

---

## Issues Found and Fixed

### HIGH-01: Redundant "Import" step titles on landing page
- **Page**: Landing page — 3-step quick-start + "How It Works" section
- **Problem**: Step 1 "Import your data" and step 2 "Import & calculate" both lead with "Import", making the workflow look like two identical steps. "How It Works" step 2 "Import & Map" had the same redundancy.
- **Impact**: Confuses first-time visitors about the actual workflow; looks like the product does the same thing twice.
- **Root cause**: Copy written incrementally without reviewing adjacent step titles.
- **Fix applied**: Step 2 renamed to "Apply factors & calculate" with improved description. "How It Works" step 2 renamed to "Apply Factors" with corrected copy.

### HIGH-02: Off-brand email addresses (hello@developer312.com) on customer-facing pages
- **Pages**: ContactUs, Demo, PrivacyPolicy, TermsOfService, DataProcessingAddendum, Security
- **Problem**: 22 references to `hello@developer312.com` — an off-brand developer domain — on customer-facing surfaces including legal pages, demo forms, and contact pages.
- **Impact**: A buyer evaluating the product sees a developer personal-domain email on legal/security pages, which undercuts trust and professionalism.
- **Root cause**: Original developer email never fully replaced when the branded `ecoauditor.io` domain was added.
- **Fix applied**: All 22 occurrences replaced with `support@ecoauditor.io`.

### HIGH-03: Missing CSS badge classes (badge-blue, badge-gray) in Settings
- **Page**: Settings → Billing subscription status
- **Problem**: Settings.tsx uses `badge-blue` (for trialing status) and `badge-gray` (for inactive status) classes that were never defined in `src/index.css`. Only `badge-green`, `badge-amber`, `badge-red` existed.
- **Impact**: Subscription status badges render without background/text colors, making the status invisible or broken-looking.
- **Root cause**: Badge classes added incrementally to Settings without updating the shared CSS.
- **Fix applied**: Added `badge-blue` and `badge-gray` class definitions to `src/index.css` with appropriate light/dark theme variants.

### HIGH-04: Build fingerprint disclosure via /health and /api/version
- **Page/Endpoint**: `GET /health`, `GET /api/health`, `GET /api/version`
- **Problem**: Health and version endpoints returned the deploy commit SHA (`buildSha()`), exact uptime, and build alias — all unauthenticated. An attacker can fingerprint the exact deploy version.
- **Impact**: Security information disclosure — lowers the cost of targeted attacks against known vulnerabilities.
- **Root cause**: AF-2 impl-spec required SHA self-reporting; security audit flagged it as unnecessary disclosure.
- **Fix applied**: Removed `sha`, `build`, `uptime` from health payload. Removed `build` from version endpoint. Removed unused `buildSha()` function. Updated tests to verify these fields are absent.

### MEDIUM-01: Heading hierarchy violations (h1 → h3 skip)
- **Pages**: Landing page (3-step cards), Pricing (plan names), Privacy/Terms/DPA ("On This Page" h2 before h1)
- **Problem**: Multiple pages had heading level skips (h1 → h3, h2 → h4) or out-of-order headings (h2 before h1 in sidebar).
- **Impact**: Screen reader users lose navigational context; SEO crawlers may misinterpret page structure.
- **Root cause**: Heading tags chosen for visual size rather than semantic hierarchy.
- **Fix applied**: Quick-start card titles h3→h2. Pricing plan names h3→h2, subsection h4→h3, add-on titles h4→h3. "On This Page" sidebar label h2→p in all legal pages. DPA annex subsections h4→h3. Privacy Policy subsections h4→h3.

### MEDIUM-02: Homepage meta description too long (201 chars)
- **Page**: Landing page (`index.html` template + client-side override)
- **Problem**: Meta description was 201 characters, exceeding the ~160-char SERP truncation limit. Client-side override was 230 chars.
- **Impact**: Google truncates the description in search results, cutting off key messaging.
- **Root cause**: Description written before truncation limits were checked.
- **Fix applied**: Template description trimmed to 143 chars. Client-side override trimmed to 146 chars.

### MEDIUM-03: Missing COOP/CORP security headers
- **Endpoint**: All server responses
- **Problem**: No `Cross-Origin-Opener-Policy` or `Cross-Origin-Resource-Policy` headers were set.
- **Impact**: Missing cross-origin isolation increases exposure to side-channel attacks (Spectre-class).
- **Root cause**: Headers not included when the security header set was originally configured.
- **Fix applied**: Added `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-origin` to `buildSecurityHeaders()` in `server-security.cjs`.

### MEDIUM-04: Lint error (no-explicit-any) in test file
- **File**: `tests/publish-endpoint.test.ts`
- **Problem**: `body: any` type annotation triggered `@typescript-eslint/no-explicit-any` lint error.
- **Impact**: CI lint gate fails; blocks clean commits.
- **Root cause**: Loose typing in test helper.
- **Fix applied**: Changed `body: any` to `body: unknown`.

### LOW-01: Dead code — unused buildSha() function
- **File**: `server.cjs`
- **Problem**: After removing SHA from health payload, `buildSha()` became dead code.
- **Fix applied**: Removed the function.

### LOW-02: Test assertions updated for security-hardened health endpoint
- **File**: `tests/server-health.test.ts`
- **Problem**: Tests expected `sha`, `build`, `uptime` fields that were removed for security.
- **Fix applied**: Updated tests to verify status and db fields only, and assert sha/build/uptime are undefined.

### LOW-03: Contact page test updated for branded email replacement
- **File**: `tests/contact-page.test.tsx`
- **Problem**: Test expected `hello@developer312.com` to still be present as a "backstop".
- **Fix applied**: Test now asserts `developer312` is NOT present in the contact page source.

---

## Verification

- ✅ Build passes (`tsc -b` + `vite build` + prerender: 14/14 routes)
- ✅ All 189 tests pass (23 test files)
- ✅ Lint passes clean (0 errors, 0 warnings)
- ✅ Heading hierarchy verified: no h1→h3 skips on landing or pricing
- ✅ All `developer312.com` references removed from source
- ✅ Badge classes defined and available
- ✅ Health endpoint no longer exposes build fingerprint
- ✅ COOP/CORP headers added to security header set

---

## Remaining Risks

1. **`'unsafe-inline'` in CSP script-src** — GTM requires inline scripts; removing unsafe-inline would break analytics. Mitigation: add nonces when GTM supports it.
2. **Blog posts fetched client-side only** — prerendered `/blog` shows "Loading posts…" until JS runs. Acceptable for now; SSR data fetching would improve SEO further.
3. **`src/content/claims.ts` has zero fan-in** — identified by fallow as dead code. It serves as a documentation/audit trail for marketing claims; keeping it intentionally.
4. **server.cjs complexity** — 2300+ LOC, fallow score 64.7. Refactoring into modules is a larger effort; not a customer-facing issue.
