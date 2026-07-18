# Eco-Auditor — Legal Documents Draft Outline

**Purpose:** Feed this to an LLM to generate first-draft **Terms of Service**, **Privacy Policy**, and **Data Processing Addendum (DPA)** for review by a qualified attorney. These drafts are NOT legal advice — counsel must review before publication. The build gate (`scripts/check-legal-placeholders.mjs`) currently FAILS while 6 placeholder tokens remain in the three legal pages; this outline tells you exactly what to fill so the gate clears.

**Hard constraint (A3):** Each legal page already carries a "business draft for review" banner sentence. That banner is INTENTIONAL and is NOT a banned token — keep it in the final docs.

---

## A. Facts you must supply (entity + operations)
The LLM needs these to draft accurately. Fill in real values:
- **Legal entity:** Developer312 (confirm full legal name and any DBA)
- **Jurisdiction of incorporation:** e.g., California or Delaware
- **Registered address + legal-notice contact email**
- **Service:** Eco-Auditor (ecoauditor.io)
- **Pricing tiers:** Free · $49/mo (Pro) · $499/mo (Enterprise) — confirm exact names/prices
- **Sub-processors:** InsForge (backend/DB/auth), Railway (hosting), Stripe (billing). List any others (analytics, email, error tracking).
- **Data collected:** account data, shop/audit data, AI-extracted outputs, usage logs. State personal-data scope.
- **Retention periods:** account, logs, audit data (distinct values)
- **International transfers:** if EU→US, note transfer mechanism (SCCs, etc.)
- **Breach notification timeline:** e.g., within 72 hours
- **AI disclosure:** service uses AI for guidance/extraction — keep claims consistent (AI-guided vs AI-powered) with what's actually built

---

## B. Document 1 — Terms of Service (`src/pages/TermsOfService.tsx`)
Sections to include:
1. Last updated date → **PLACEHOLDER #1**
2. Acceptance of terms / eligibility
3. Description of service
4. Accounts & user responsibilities
5. Acceptable use
6. Subscription / billing / cancellation / refunds (Free / $49 / $499)
7. Intellectual property
8. Disclaimers of warranties
9. Limitation of liability → **PLACEHOLDER #2** (liability cap)
10. Indemnification
11. Termination
12. Governing law → **PLACEHOLDER #3** (jurisdiction)
13. Dispute resolution → **PLACEHOLDER #4** (mechanism)
14. Changes to terms
15. Contact
Keep the "business draft for review" banner.

## C. Document 2 — Privacy Policy (`src/pages/PrivacyPolicy.tsx`)
Sections:
1. Last updated → **PLACEHOLDER #5**
2. Who we are (controller identity + contact)
3. What we collect (personal-data categories)
4. How we use it
5. Legal bases (GDPR) / business purposes (CCPA/CPRA)
6. Sharing / sub-processors (InsForge, Railway, Stripe)
7. International transfers
8. Data retention
9. Your rights (GDPR Art. 15–22; CCPA/CPRA: access, delete, opt-out of sale/sharing)
10. Cookies / tracking
11. Security
12. Children
13. Changes
14. Contact / DPO
Keep the banner.

## D. Document 3 — Data Processing Addendum (`src/pages/DataProcessingAddendum.tsx`)
Sections:
1. Last updated → **PLACEHOLDER #6**
2. Roles (Controller/Processor) — Eco-Auditor acts as processor for customer end-user data
3. Scope & subject matter
4. Categories of data & data subjects
5. Sub-processors list + authorization + change-notice process
6. Data-subject-rights assistance
7. Security measures
8. Breach notification (timeline)
9. Deletion / return on termination
10. International transfers / safeguards
11. Audit rights
12. Governing law
Keep the banner.

---

## E. The 6 exact placeholders that block the build
Replace these exact strings in the three `.tsx` files:

| # | File : line | Token (verbatim) | Replace with |
|---|-------------|------------------|--------------|
| 1 | TermsOfService.tsx:49 | `[Date to be set upon legal review]` | Publication / "last updated" date |
| 2 | TermsOfService.tsx:166 | `[AMOUNT TO BE SET …]` (liability cap) | Cap amount, e.g. "the greater of $[X] or the fees you paid in the prior 12 months" |
| 3 | TermsOfService.tsx:186 | `[Jurisdiction to be set upon legal review]` | Governing law, e.g. "the State of California" |
| 4 | TermsOfService.tsx:187 | `[Dispute resolution mechanism to be set upon legal review]` | e.g. "binding arbitration in [County], California" or "the courts of [Jurisdiction]" |
| 5 | PrivacyPolicy.tsx:58 | `[Date to be set upon legal review]` | Publication date |
| 6 | DataProcessingAddendum.tsx:50 | `[Date to be set upon legal review]` | Publication date |

After replacing, run the build / `node scripts/check-legal-placeholders.mjs` — it must report **0 banned tokens**. (The "business draft for review" banner is intentionally NOT banned and must remain.)

---

## F. Process to unblock PR #6
1. Fill Section A facts → give this outline + facts to your LLM → generate 3 drafts.
2. Send drafts to your lawyer; incorporate edits.
3. Replace the 6 placeholders in the 3 `.tsx` files with final values.
4. `npm run build` passes (gate clears) → tell Javante **"merge"** → squash-merge PR #6, delete branch, fast-forward (per SOP).

> Note: Separately from legal docs, PR #6 also waits on your **3 product-truth override decisions** (disputed marketing claims where you override the master-safe resolution). Those are a business call, not a legal document — handle alongside or after the legal gate.
