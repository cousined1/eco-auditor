# eco-auditor — Legal-Gate Placeholder Draft (COUNSEL-READY, NOT APPLIED)

**Generated:** 2026-07-11 by Javante (CTO) using the repo's legal-gate scan (`scripts/check-legal-placeholders.mjs`).
**Status:** DRAFT FOR REVIEW BY QUALIFIED LEGAL COUNSEL. Do NOT paste into source files without attorney sign-off — doing so flips the P0-02 launch gate and makes `npm run build` pass.
**Entity of record:** Developer312, a subsidiary of **NIGHT LITE USA LLC** (already named, not a placeholder).
**Gate tokens:** `[Date to be set upon legal review]`, `[AMOUNT TO BE SET …]`, `[Jurisdiction to be set …]`, `[Dispute resolution mechanism …]`.

---

## 1. TermsOfService.tsx — L49 (Last updated)
Current: `Last updated: [Date to be set upon legal review]`
Draft: `Last updated: July 11, 2026`  ← set to the date counsel approves publication.

## 2. TermsOfService.tsx — L166 (Liability cap, clause B)
Current: `...OR (B) [AMOUNT TO BE SET UPON LEGAL REVIEW].`
Draft: `...OR (B) One Hundred Dollars ($100.00 USD).`
⚠️ Financial/legal judgment. Common SaaS floor is a nominal sum; confirm with counsel + insurance.

## 3. TermsOfService.tsx — L186 (Governing law)
Current: `...laws of [Jurisdiction to be set upon legal review]...`
Draft option A (if NIGHT LITE USA LLC is CA-based): `...laws of the State of California...`
Draft option B (if DE-incorporated): `...laws of the State of Delaware...`
⚠️ Confirm the entity's state of formation/principal place of business.

## 4. TermsOfService.tsx — L187 (Dispute resolution)
Current: `...resolved through [Dispute resolution mechanism to be set upon legal review — e.g., arbitration, mediation, or courts of specified jurisdiction].`
Draft option A (binding arbitration, common for SaaS):
`...resolved through binding arbitration administered by JAMS under its Comprehensive Arbitration Rules, seated in [County], California, except that either party may seek injunctive relief in court.`
Draft option B (courts):
`...resolved exclusively in the state and federal courts located in [County], California.`
⚠️ Arbitration vs litigation is a material legal choice; counsel decides.

## 5. PrivacyPolicy.tsx — L58 (Last updated)
Current: `Last updated: [Date to be set upon legal review]`
Draft: `Last updated: July 11, 2026`  ← match Terms date.

## 6. DataProcessingAddendum.tsx — L50 (Last updated)
Current: `Last updated: [Date to be set upon legal review]`
Draft: `Last updated: July 11, 2026`  ← match Terms date.

---

## How to apply (once counsel signs off)
Replace the 6 tokens above in the three files, then:
`npm run build`  → legal-gate passes → PR #6 can be merged + deployed.
Until then, the build intentionally fails the gate. This draft is NOT a substitute for attorney review.
