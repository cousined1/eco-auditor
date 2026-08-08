# Eco-Auditor MVP Audit and Implementation Plan

**Audit date:** August 5, 2026  
**Site audited:** [https://ecoauditor.io](https://ecoauditor.io)  
**Previous audit baseline:** July 11, 2026  
**Audit type:** Public SaaS MVP, conversion, product-truth, trust, pricing, accessibility, SEO, and launch-readiness audit  
**Overall status:** **Pilot-ready with restrictions; not ready for broad paid acquisition**

> This is a product, UX, and public-claims audit. It is not legal advice, an assurance engagement, a carbon-accounting validation, or a penetration test.

---

## 1. Executive verdict

Eco-Auditor has made meaningful progress since the July 11 audit. The most serious conversion failure has been repaired: `/login` and `/signup` now display real authentication interfaces rather than returning homepage content. The site also has a dedicated demo flow, improved pricing semantics, production-style legal pages, stronger operator identity, current EPA/eGRID methodology references, and downloadable sample assets.

The release is still blocked from broad launch by product-truth and trust defects rather than basic site architecture. The highest-risk issues are:

1. The Security page publicly exposes an unresolved backup-retention placeholder.
2. The sample-report webpage and downloadable PDF show conflicting data-quality percentages.
3. The downloadable PDF does not contain the factor, methodology, evidence, revision, and traceability detail the page says it contains.
4. A stale California SB 253 deadline remains in public regulatory content.
5. Features marked “Coming soon” or “Roadmap” are described elsewhere as available today, included in demos, or sold as add-ons.
6. The DPA uses generic subprocessor categories while the Security page names actual infrastructure providers.
7. Cookie-banner language conflicts with the Privacy Policy concerning personalized advertising and marketing cookies.
8. `/blog` soft-renders the homepage instead of providing a blog, redirect, or real not-found response.

These defects create avoidable doubt for sustainability, finance, operations, procurement, privacy, and legal reviewers. They are especially important because Eco-Auditor sells traceability and audit preparation; its own public information must therefore be internally consistent and reproducible.

### Recommended launch decision

**Continue controlled pilots, founder-led demos, and invited-user onboarding. Hold broad paid acquisition until every P0 item passes.**

### Current MVP readiness score

**6.9 / 10**

The score is higher than the previous **5.9 / 10** because authentication routing, demo intent, pricing clarity, legal presentation, branding, and several methodology statements have improved. The score remains below launch-ready because public product proof and trust claims still contradict one another.

---

## 2. Audit scope and verification limits

### Public surfaces reviewed

- `/`
- `/pricing/`
- `/methodology/`
- `/security/`
- `/sample-report/`
- Sample PDF linked from `/sample-report/`
- `/demo`
- `/contact/`
- `/privacy/`
- `/terms/`
- `/dpa/`
- `/login`
- `/signup`
- Password-reset route
- `/blog`

### Evaluated

- Positioning and ideal-customer clarity
- Marketing-to-product consistency
- Navigation and CTA destinations
- Signup and login entry points
- Trial and billing disclosure
- Pricing comprehension
- Product-proof credibility
- Methodology and regulatory claims
- Security, privacy, retention, and subprocessor messaging
- Legal-document presentation
- Accessibility risks visible from rendered structure
- Page metadata and route behavior
- MVP launch readiness

### Not verified

- Authenticated dashboard workflows
- Account creation with a real email address
- OAuth completion for Google, Microsoft, or Apple
- Password-reset email delivery
- Contact/demo form delivery
- Stripe checkout, taxation, invoicing, refunds, or cancellation
- Database, tenant isolation, row-level security, or encryption implementation
- Backup behavior and deletion jobs
- Penetration-test status or security-control evidence
- CSV import and calculation correctness inside the app
- Mobile-device screenshots
- Full keyboard and screen-reader behavior
- Core Web Vitals or Lighthouse measurements
- HTTP security headers
- `robots.txt`, sitemap, canonical tags, and structured-data responses
- Unknown-route HTTP status behavior
- Actual consent-manager network behavior

A final launch decision should include a real-browser QA pass and authenticated product audit.

---

## 3. Change review against the July 11 audit

| Previous finding | Current state | Assessment |
|---|---|---|
| `/login` and `/signup` returned homepage content | Real authentication forms now render | **Fixed publicly; end-to-end function still unverified** |
| Legal pages displayed draft banners and placeholders | Draft presentation has been removed and operator details added | **Substantially fixed** |
| Trial and billing descriptions conflicted | Terms now explain no-card trial and post-trial read-only behavior | **Improved; signup still lacks complete plan/trial context** |
| No dedicated demo flow | `/demo` now collects use case, facility count, and deadline | **Fixed publicly; delivery unverified** |
| Pricing inclusion/exclusion was visually ambiguous | Cards now use “Included,” “Not included,” and “Roadmap” labels | **Improved; several labels and add-ons remain misleading** |
| Sample output was not downloadable | PDF and CSV sample links now exist | **Partially fixed; PDF is not credible product proof** |
| Sample data-quality statement was mathematically misleading | Web copy now uses 59%; PDF still uses older 42%/83% values | **Regression/incomplete source-of-truth fix** |
| Methodology used outdated factor naming | EPA Hub 2025 and eGRID2023 are now shown | **Fixed** |
| Operational control was framed as universally recommended | Page now states it is Eco-Auditor’s default and notes alternatives | **Fixed** |
| Confidence scoring looked externally standardized | It is now labeled as an internal indicator, not assurance | **Improved** |
| Compliance language used absolutes | Public wording is more qualified | **Improved; evidence register still needed** |
| Security/retention facts conflicted | TLS language is more coherent | **Incomplete; public placeholder and policy conflicts remain** |
| Brand/operator identity was inconsistent | Developer312 and NIGHT LITE USA LLC are now identified | **Improved** |
| Core pages reused generic metadata | Most reviewed pages now have page-specific titles | **Improved; `/blog` and password reset still need work** |
| Demo/security/DPA intent went to generic contact | Demo has a dedicated page; DPA request path exists | **Improved** |

### Most important positive change

The primary conversion routes now exist and the site presents a fuller commercial product. The next engineering phase should not add more features to the marketing site. It should make every existing claim, download, status label, and legal statement agree with the actual application.

---

## 4. MVP readiness scorecard

| Area | Score | Status | Main risk |
|---|---:|---|---|
| Positioning and ICP clarity | 8.0/10 | Strong | Regulatory and supply-chain applicability still needs maintenance |
| Homepage narrative | 7.5/10 | Good | Feature-status presentation can be misread |
| Conversion and authentication entry | 7.5/10 | Improved | Form completion, OAuth, and context preservation unverified |
| Pricing comprehension | 7.0/10 | Improving | Roadmap add-ons and awkward exclusion labels |
| Product proof | 5.0/10 | At risk | Web/PDF mismatch and weak one-page PDF |
| Methodology credibility | 7.0/10 | Improving | Stale regulatory date and limited factor traceability |
| Security and privacy trust | 5.5/10 | At risk | Public placeholder and policy contradictions |
| Legal readiness | 7.0/10 | Improving | Generic subprocessors and unverified control claims |
| Navigation and information architecture | 6.5/10 | Needs work | `/blog` soft route and inconsistent public navigation |
| Accessibility readiness | 5.5/10 | Unverified | Forms, toggles, icons, focus, and reflow need manual testing |
| Technical UX and SEO | 6.5/10 | Needs verification | Soft route, auth metadata, sitemap/canonical status unknown |
| Activation and analytics | 5.0/10 | Unknown | Authenticated onboarding and funnel instrumentation not audited |
| **Overall launch readiness** | **6.9/10** | **Restricted pilot** | Public claims and product proof must be reconciled |

---

# 5. P0 — Fix before paid acquisition or broad launch

## P0-01 — Remove the public backup-retention placeholder — ✅ Resolved (2026-08-08)

**Area:** Security, privacy, procurement  
**Severity:** Critical  
**Owner:** Security + infrastructure + legal/privacy  
**Effort:** Small after the underlying fact is verified

### Observed issue

The Security page publicly states that backups are deleted within **“(verify before publication) days”** after termination.

This is a production placeholder on one of the site’s most trust-sensitive pages. It tells buyers that the published retention statement has not been verified.

### Resolution

The Security page now publishes the verified termination retention fact: **90 days** after termination (`src/content/trust-facts.ts` — `postTerminationRetentionDays: { value: 90, verified: true }`), rendered via `renderFact()` in `src/pages/Security.tsx`. The placeholder phrase `(verify before publication) days` no longer appears on any public page.

- **Commits:** `162c30e` (removed the unverified backup-retention claim; deleted the stale `audit-live/` snapshot), `148c4f4` (dropped the unverified `backupsDeletionWindowDays: 35` fact from the 2026-07-11 audit), `b961b69` (legal placeholder guardrails).
- **Guardrail implemented:** `scripts/check-legal-placeholders.mjs` runs first in the production build (`package.json`), rejects `"verify before publication"` and related placeholder phrases, and is covered by `tests/legal-placeholders.test.ts`. CI fails when banned placeholder language is introduced.
- **Still open (separate track):** full operational backup-lifecycle documentation (frequency, restore-testing cadence, encryption method) and a formal owner review date. These are not required for the published buyer-facing claim, which is now verified and accurate.

### Suggested guardrail

```ts
const bannedPublicPhrases = [
  "verify before publication",
  "TBD",
  "TO BE CONFIRMED",
  "[PLACEHOLDER]",
  "days of termination)",
];

for (const phrase of bannedPublicPhrases) {
  if (renderedPublicContent.toLowerCase().includes(phrase.toLowerCase())) {
    throw new Error(`Public placeholder detected: ${phrase}`);
  }
}
```

### Acceptance criteria

- [x] No public page contains unresolved operational placeholders.
- [ ] Security, Privacy, Terms, and DPA use the same terminology.
- [ ] Account deletion explains active-data and backup-deletion timing separately.
- [ ] The approved statement has an owner and review date.
- [x] CI fails when banned placeholder language is introduced.

---

## P0-02 — Reconcile the sample webpage and downloadable PDF

**Area:** Product truth, report calculations, sales proof  
**Severity:** Critical  
**Owner:** Reporting engineering + methodology + QA  
**Effort:** Medium

### Observed contradictions

The sample-report webpage states:

```text
59% primary source or better
17% flagged for improvement
```

The linked PDF states:

```text
42% primary source or better
83% industry-average or better
```

Both artifacts present themselves as the same fictional Pacific Freight report. A buyer cannot determine which quality model or dataset is authoritative.

The webpage also says the PDF contains methodology and factor basis. The downloaded PDF is a sparse one-page summary and does not visibly provide:

- Emission-factor identifiers
- Dataset versions
- Activity-data lineage
- Assumptions and exclusions
- Evidence references
- Report identifier
- Export timestamp
- Revision history
- Review/approval status
- Calculation notes

### Required fix

Create one versioned sample fixture and generate every web and downloadable artifact from it.

```ts
export interface SampleReportFixture {
  reportId: string;
  revision: number;
  organization: string;
  reportingPeriod: string;
  boundaryMethod: string;
  scopeTotals: {
    scope1: number;
    scope2: number;
    scope3: number;
  };
  qualityBreakdown: Array<{
    level: string;
    emissionsTco2e: number;
    percentage: number;
    definition: string;
  }>;
  factors: Array<{
    factorId: string;
    source: string;
    datasetVersion: string;
    geography: string;
    unit: string;
  }>;
  assumptions: string[];
  exclusions: string[];
  evidenceItems: Array<{
    id: string;
    fileName: string;
    sourceType: string;
    reviewStatus: string;
  }>;
}
```

Generate from that source:

```text
/sample-report/
/sample-report/pacific-freight-fy2026.pdf
/sample-report/pacific-freight-activity-data.csv
/sample-report/pacific-freight-factor-register.csv
/sample-report/pacific-freight-evidence-index.csv
```

### Report invariants

```ts
expect(scope1 + scope2 + scope3).toBe(total);
expect(sum(qualityPercentages)).toBeCloseTo(100, 1);
expect(webSummary.primaryOrBetter).toBe(pdfSummary.primaryOrBetter);
expect(webReport.revision).toBe(pdfReport.revision);
expect(webReport.factorVersion).toBe(pdfReport.factorVersion);
```

### Acceptance criteria

- [ ] Web and PDF totals are identical.
- [ ] Web and PDF data-quality percentages are identical.
- [ ] Labels use the same documented quality hierarchy.
- [ ] The PDF contains factor sources and versions.
- [ ] The PDF contains assumptions, exclusions, and missing-data flags.
- [ ] Every sample artifact shows a report ID and revision.
- [ ] Every artifact is clearly labeled fictional.
- [ ] PDF and CSV exports are generated by the same code used for production reports.
- [ ] Visual QA confirms the PDF resembles a credible customer deliverable.

---

## P0-03 — Replace the stale SB 253 deadline with maintained regulatory content

**Area:** Regulatory content, trust, SEO  
**Severity:** Critical  
**Owner:** Product content + legal/methodology reviewer  
**Effort:** Small

### Observed issue

The homepage FAQ and Methodology page still state that the first-year California SB 253 Scope 1 and Scope 2 deadline is **August 10, 2026**.

As of this audit, California Air Resources Board materials and its current program communications indicate a proposed/announced move to **November 10, 2026**. Because rulemaking can change, the site should not hard-code this date in several components without a maintained source and review process.

### Required fix

Replace duplicated prose with a regulatory-content record:

```ts
export const regulatoryFacts = {
  californiaSb253: {
    status: "proposed deadline update",
    scope12Deadline: "2026-11-10",
    sourceUrl: "https://ww2.arb.ca.gov/our-work/programs/climate-corporate-data-accountability",
    reviewedAt: "2026-08-05",
    reviewDue: "2026-08-12",
    owner: "Legal/Methodology",
    caveat:
      "Requirements and dates remain subject to final rulemaking and current CARB guidance.",
  },
};
```

### Recommended public wording

```text
CARB has proposed moving the first-year Scope 1 and Scope 2 reporting deadline from August 10 to November 10, 2026. Requirements and dates remain subject to final rulemaking. Review CARB’s current program guidance and obtain legal advice for your organization’s obligations.
```

### Acceptance criteria

- [ ] No public page presents August 10, 2026 as the current unqualified deadline.
- [ ] The date links to the current CARB program page.
- [ ] Regulatory dates are rendered from one maintained source.
- [ ] Each record includes status, owner, source, review date, and caveat.
- [ ] Expired review dates trigger a CI warning or content-review task.
- [ ] Direct legal obligations are distinguished from customer-driven supply-chain requests.

---

## P0-04 — Make feature availability consistent everywhere

**Area:** Product truth, pricing, demos, roadmap  
**Severity:** Critical  
**Owner:** Product + marketing + frontend  
**Effort:** Medium

### Observed inconsistencies

Public pages use conflicting availability signals:

- The homepage marks Emissions Ledger, Reporting Center, Supplier Hub, and other capabilities as “Coming soon.”
- The sample-report page says an in-app ledger is “available today.”
- The demo agenda promises an evidence-index walkthrough.
- Pricing sells or promotes “additional supplier requests” while the Supplier Hub is roadmap.
- Pricing promotes “premium report templates” while custom/reporting-template capabilities are roadmap or restricted.
- Integrations are discussed in Privacy as data recipients even though QuickBooks/Xero integrations are presented as roadmap.

A prospect should not need to infer whether a capability is live, beta, manually delivered, demo-only, or planned.

### Required fix

Create a capability registry consumed by homepage, pricing, demo, FAQ, sample report, signup, and sales copy.

```ts
type CapabilityStatus =
  | "available"
  | "beta"
  | "manual-service"
  | "demo-preview"
  | "roadmap"
  | "retired";

interface Capability {
  id: string;
  name: string;
  status: CapabilityStatus;
  availablePlans: string[];
  purchasable: boolean;
  publicLabel: string;
  limitations?: string[];
  expectedRelease?: string;
  owner: string;
  reviewedAt: string;
}
```

### Public labeling rules

- **Available:** A customer can use it in production now.
- **Beta:** A customer can use it now with stated limitations.
- **Manual service:** The outcome is delivered by the team, not self-service software.
- **Demo preview:** A non-production prototype may be shown.
- **Roadmap:** Not purchasable and not promised as part of the current plan.

Do not sell an add-on whose required base capability is not live.

### Acceptance criteria

- [ ] Every named capability has one status in the registry.
- [ ] Homepage, pricing, demo, sample-report, FAQ, and Privacy agree.
- [ ] Roadmap items cannot be added to checkout.
- [ ] Demo-preview features are labeled as prototypes.
- [ ] Manual services are distinguished from software functionality.
- [ ] Plan cards show only capabilities actually available to that plan.
- [ ] Release dates are omitted unless the team has an approved commitment.

---

## P0-05 — Repair the `/blog` soft route

**Area:** Navigation, SEO, credibility  
**Severity:** Critical for indexing; high for conversion  
**Owner:** Frontend + SEO  
**Effort:** Small

### Observed behavior

`/blog` renders the homepage title and homepage content rather than a blog index, intentional redirect, or real 404 page.

This can produce duplicate content, confusing browser history, inaccurate analytics, and a visibly broken footer destination.

### Required fix

Choose one:

1. **Publish a real blog index** with article routes.
2. **Remove the Blog link** until content exists.
3. **301 redirect `/blog`** to an appropriate resource route if the blog has been retired.

Do not return a successful homepage document at `/blog`.

### Acceptance criteria

- [ ] `/blog` renders a real blog page, returns a deliberate redirect, or returns a real 404.
- [ ] The route has the correct HTTP status.
- [ ] The page title, canonical, and Open Graph URL match the route.
- [ ] The sitemap contains `/blog` only when it is a real indexable page.
- [ ] An automated route test prevents homepage soft-routing.

```ts
test("blog route does not soft-render the homepage", async ({ page }) => {
  const response = await page.goto("/blog");
  expect(response?.status()).toBeLessThan(400);
  await expect(page).toHaveTitle(/blog|resources|insights/i);
  await expect(
    page.getByRole("heading", { name: /carbon accounting as easy as bookkeeping/i })
  ).not.toBeVisible();
});
```

---

## P0-06 — Create one authoritative trust and privacy facts source

**Area:** Security, DPA, Privacy Policy, cookies  
**Severity:** Critical  
**Owner:** Security + privacy + platform engineering  
**Effort:** Medium

### Observed inconsistencies

- Security names Railway and InsForge; the DPA uses generic categories such as “cloud hosting provider.”
- The DPA says Annex III maintains exact subprocessors, but the public annex is not exact.
- The cookie banner says Eco-Auditor does not use personalized advertising.
- The Privacy Policy discusses marketing cookies and personalized advertising with consent.
- The Privacy Policy says Global Privacy Control and Do Not Track signals are honored; actual technical behavior was not verified.
- Security says standard materials need no NDA, while DPA language says detailed security materials are available under NDA. This distinction may be valid but is not sufficiently clear.
- Retention and backup deletion are not yet stated with one verified timeline.

### Required fix

Create one structured trust source that feeds all public and internal surfaces.

```ts
export const trustFacts = {
  encryptionInTransitMinimum: "TLS 1.2",
  preferredTransport: "TLS 1.3",
  encryptionAtRest: "VERIFY BY STORAGE LAYER",
  activeDataDeletionWindowDays: 90,
  backupDeletionWindowDays: "VERIFY",
  personalizedAdvertising: false,
  gpcSupported: "VERIFY",
  dntSupported: "VERIFY OR REMOVE CLAIM",
  standardMaterialsRequireNda: false,
  detailedArchitectureMaterialsRequireNda: true,
  subprocessors: [
    {
      name: "Railway",
      purpose: "Application hosting",
      dataCategories: ["VERIFY"],
      processingLocations: ["VERIFY"],
      documentationUrl: "VERIFY",
    },
    {
      name: "InsForge",
      purpose: "Authentication and data services",
      dataCategories: ["VERIFY"],
      processingLocations: ["VERIFY"],
      documentationUrl: "VERIFY",
    },
    {
      name: "Stripe",
      purpose: "Payment processing",
      dataCategories: ["account and billing data"],
      processingLocations: ["VERIFY"],
      documentationUrl: "VERIFY",
    },
  ],
};
```

Do not publish any `VERIFY` values. Confirm them against architecture, vendor contracts, and observed network behavior.

### Acceptance criteria

- [ ] The DPA names current subprocessors and purposes.
- [ ] Security and DPA distinguish standard versus detailed materials.
- [ ] Cookie banner and Privacy Policy use the same advertising statement.
- [ ] GPC behavior is tested in a real browser.
- [ ] The Do Not Track claim is either tested and defined or removed.
- [ ] Nonessential scripts do not run before consent where required.
- [ ] Retention statements match the product’s real deletion jobs.
- [ ] Every security absolute has evidence, owner, and review date.

---

# 6. P1 — High-impact fixes after the P0 blockers

## P1-01 — Preserve plan and billing context through signup

### Problem

The pricing page offers plan and billing choices, but the signup page appears plan-neutral. It does not visibly summarize:

- Selected plan
- Monthly versus annual cadence
- Trial eligibility
- Post-trial price
- Exact charge behavior
- What becomes read-only at trial end

### Fix

Use plan-aware URLs and a visible signup summary:

```text
/signup?plan=starter&billing=monthly&source=pricing
```

```text
Starter plan
14-day trial · no credit card required
No automatic charge
At trial end, editing and exports become read-only until a paid plan is selected
Monthly subscription after selection: $149/month
```

Use actual approved pricing and behavior.

### Acceptance criteria

- [ ] Pricing selection persists into signup.
- [ ] Signup shows the selected plan and billing cadence.
- [ ] Trial eligibility is explicit for every plan.
- [ ] The user does not choose the same plan twice.
- [ ] Analytics preserve source, plan, and cadence without sensitive data.

---

## P1-02 — Complete authentication end-to-end QA

The public forms now exist, but rendering alone does not establish that authentication works.

Test:

- Account creation
- Duplicate email
- Weak password
- Email verification
- Expired verification link
- Login success and failure
- Locked/rate-limited account
- Password reset request
- Reset-code flow
- Expired reset token
- Google OAuth
- Microsoft OAuth
- Apple OAuth
- Session expiry
- Return-to-requested-route behavior
- Logged-in user visiting `/login` or `/signup`

### Metadata fix

The password-reset page should have a unique title such as:

```text
Reset Your Eco-Auditor Password
```

Auth and account routes should normally use `noindex, nofollow`.

---

## P1-03 — Improve pricing labels and roadmap add-ons

### Issues

- “Not included: 5 facilities” is semantically awkward for Starter. Use “Limited to 1 facility.”
- “Not included: Unlimited facilities” is confusing for Growth. State the exact included limit.
- “Show full feature comparison” did not expose a readable comparison in the retrieved page content.
- Add-ons for supplier requests and premium report templates conflict with roadmap status.
- “Get started” is less specific than “Start free trial” where a trial is available.
- Pro trial eligibility is not as explicit as Starter/Growth.

### Fix

Use four statuses only:

```text
Included
Limited to [quantity]
Available as a live add-on
Not currently available
```

For annual pricing, show both values together:

```text
$124/month equivalent
$1,490 billed annually
Save $298 versus monthly billing
```

### Acceptance criteria

- [ ] Every limit states a positive quantity.
- [ ] No roadmap item is sold as a live add-on.
- [ ] Full comparison is keyboard-accessible and present in the DOM.
- [ ] Billing changes are announced to assistive technology.
- [ ] Trial eligibility is explicit on every plan.
- [ ] CTA labels match the resulting action.

---

## P1-04 — Upgrade the sample PDF into credible product proof

Even after data consistency is fixed, the current one-page PDF is too sparse to support the product’s “reviewable,” “traceable,” and audit-preparation positioning.

### Minimum PDF structure

1. Cover and report metadata
2. Executive summary
3. Organizational and operational boundaries
4. Reporting period and consolidation method
5. Scope 1, 2, and 3 totals
6. Category breakdown
7. Activity-data table
8. Emission-factor register
9. Data-quality summary
10. Missing-data and estimation flags
11. Assumptions and exclusions
12. Evidence index
13. Review and approval status
14. Revision history
15. Methodology and limitations

### Acceptance criteria

- [ ] A buyer can understand how at least one number was calculated.
- [ ] Factor source, identifier, version, unit, geography, and date are shown.
- [ ] Evidence references map to fictional source documents.
- [ ] Tables and charts have accessible text equivalents.
- [ ] Every page identifies the report as fictional sample data.
- [ ] The PDF has bookmarks, tagged headings, and a logical reading order.

---

## P1-05 — Establish a reviewed public-claims register

Claims requiring evidence include:

- “Audit-ready” or “reviewable” reporting
- “Every number” traceability
- Setup in minutes
- Report-generation speed
- Consultant-cost comparisons of $15,000–$40,000
- “All responses” security headers
- Monthly access reviews
- Regular penetration testing
- Tested backup restores
- Redundant infrastructure
- No AI training on customer data
- GPC/DNT support
- Compliance-support statements

### Fix

```yaml
claims:
  - id: every-number-traceable
    text: "Every number traces back to an emission factor and published dataset"
    owner: "Reporting + Methodology"
    evidence: "docs/claims/every-number-traceable.md"
    approved_surfaces:
      - homepage
      - sample-report
    caveat: "Applies to calculated report entries with supported source records."
    reviewed_at: "2026-08-05"
    review_due: "2026-11-05"
```

### Acceptance criteria

- [ ] Every quantitative claim has a source or test result.
- [ ] Every security absolute has technical evidence.
- [ ] Every regulatory claim has a review owner.
- [ ] Cost comparisons cite a defensible source or are removed.
- [ ] Claims expire automatically when review dates pass.

---

## P1-06 — Make public navigation consistent

Rendered public pages do not consistently expose the full product-evaluation navigation. Legal and contact visitors should not reach a dead-end layout.

### Recommended global header

```text
Eco-Auditor | Product | Pricing | Methodology | Security | Sample report | Log in | Start free trial
```

On mobile:

```text
Eco-Auditor | Menu | Log in
```

### Acceptance criteria

- [ ] One shared header is used on every public page.
- [ ] Current-page state is programmatically exposed.
- [ ] A skip link is the first focusable control.
- [ ] Mobile menu traps focus and closes with Escape.
- [ ] Legal in-page navigation does not replace global navigation.

---

## P1-07 — Complete accessibility testing

Target **WCAG 2.2 AA**.

### Priority checks

#### Forms

- Persistent visible labels
- Programmatic required state
- Field-level errors and form-level summary
- Focus moved to error summary or success state
- Correct autocomplete tokens
- Password requirements before submission
- Status messages announced through appropriate live regions

#### Pricing

- Billing toggle has name, role, and state
- Updated prices are announced without excessive live-region output
- Full comparison is keyboard accessible
- Included/limited/roadmap status does not depend on color or opacity

#### Icons and decorative content

Emoji-like symbols on Contact should use `aria-hidden="true"` when decorative. No orphan glyph should appear in the accessibility tree.

#### Responsive behavior

- 320 CSS-pixel reflow
- 200% zoom
- Visible focus indicators
- No content obscured by sticky UI
- Touch targets meet WCAG 2.2 guidance

#### Downloads

- Link text includes file type and, where useful, file size
- PDF is tagged and keyboard navigable
- CSV links have clear descriptions

---

## P1-08 — Verify cookie consent against real network behavior

### Required test

Open a clean browser profile and capture network/storage behavior for:

1. First visit with no consent
2. Reject nonessential cookies
3. Accept all
4. Withdraw consent
5. Global Privacy Control enabled
6. Do Not Track enabled, if the claim remains

Inventory:

- Cookies
- Local-storage keys
- Session-storage keys
- Analytics calls
- Advertising/remarketing calls
- Embedded media or third-party requests

### Acceptance criteria

- [ ] Necessary-only mode keeps core site and signup functional.
- [ ] Reject is as easy as Accept.
- [ ] No nonessential script runs before consent where required.
- [ ] Consent is versioned and can be withdrawn.
- [ ] Cookie table matches observed behavior.
- [ ] Public wording does not claim personalized advertising if none is used.

---

## P1-09 — Validate form delivery and confirmation states

Test `/demo`, `/contact`, DPA requests, signup, and password reset.

Each submission should provide:

- Field validation
- Loading state
- Duplicate-submission protection
- Rate-limit and spam handling
- Network-error recovery
- Success confirmation
- Expected response time
- Reference number for support/legal requests
- Acknowledgment email

Demo, support, security, privacy, billing, and DPA intents should be tracked separately.

---

## P1-10 — Finish metadata, indexing, and route validation

### Required checks

- Unique title and description per indexable page
- Auth/account routes set to `noindex`
- Self-referential canonicals on public pages
- One host and trailing-slash convention
- Open Graph image at 1200×630
- Correct favicon and Apple touch icon
- Sitemap containing only intentional public pages
- `robots.txt` referencing the sitemap
- Real 404 status and useful 404 page
- Server-side redirects where appropriate
- Preview/staging deployments blocked from indexing

### Route test set

```text
/
/pricing/
/methodology/
/security/
/sample-report/
/demo
/contact/
/privacy/
/terms/
/dpa/
/login
/signup
/forgot-password
/blog
/nonexistent-route-test
```

---

# 7. P2 — Improve after stabilization

## P2-01 — Replace illustrative proof with permissioned pilot evidence

Current examples should remain clearly labeled as fictional or illustrative. As pilots mature, publish case studies that include:

- Customer type and permission
- Starting process
- Reporting boundary
- Records imported
- Time to first useful report
- Number of calculation warnings resolved
- Data-quality improvement
- Export or customer-request outcome
- Limitations and assumptions

Do not use logos or quotes without documented permission.

---

## P2-02 — Add buyer-specific use-case pages

Recommended routes:

```text
/use-cases/scope-1-and-2-baseline
/use-cases/customer-carbon-data-requests
/use-cases/supplier-scope-3-collection
/use-cases/rfp-emissions-disclosure
/use-cases/audit-evidence-preparation
/industries/logistics
/industries/light-manufacturing
/industries/food-and-beverage
```

Each page should identify:

- Buyer problem
- Inputs required
- Live product workflow
- Product limitations
- Sample output
- Time to value
- Plan fit
- One primary CTA

Do not build these pages until the underlying capability is live.

---

## P2-03 — Publish factor and methodology change logs

Recommended routes:

```text
/emission-factors
/emission-factors/changelog
/methodology/changelog
```

Show:

- Source organization
- Dataset and version
- Publication date
- Eco-Auditor activation date
- Geographic applicability
- Changed categories
- Whether historical reports change
- Recalculation options
- Data-quality model version

---

## P2-04 — Build a procurement-ready trust center

Include:

- Security overview
- Architecture/data-flow diagram
- Exact subprocessor list
- DPA download/execution flow
- Retention schedule
- Backup and recovery overview
- Access-control summary
- Vulnerability disclosure process
- Incident contact
- Business continuity overview
- Security questionnaire packet
- Certification status only when verified

---

## P2-05 — Optimize first-run activation

Suggested onboarding:

1. Reporting objective
2. Reporting period
3. Industry
4. Organizational boundary
5. Facilities
6. Available records
7. Preferred first output

Then offer:

```text
Use fictional sample data
Upload one utility bill
Import a CSV
Add a facility manually
```

Define activation as the first validated calculation or useful report preview, not account creation.

---

## P2-06 — Instrument the MVP funnel without sensitive data

Do not send uploaded bills, supplier names, invoice text, emissions records, or report content to analytics.

### Acquisition

```text
marketing_page_viewed
pricing_viewed
sample_report_viewed
sample_report_downloaded
demo_started
demo_submitted
primary_cta_clicked
```

### Registration

```text
signup_viewed
signup_started
signup_error
signup_completed
email_verified
login_succeeded
password_reset_completed
```

### Activation

```text
onboarding_started
sample_company_selected
facility_created
source_upload_completed
mapping_completed
first_calculation_completed
first_report_previewed
```

### Conversion

```text
plan_selected
checkout_started
checkout_completed
trial_expired
trial_converted
subscription_canceled
```

### Required dashboards

- Homepage → signup conversion
- Pricing → signup conversion by plan/cadence
- Sample report → signup conversion
- Signup → verified account
- Verified account → first source upload
- First upload → first calculation
- First calculation → report preview
- Trial → paid conversion
- Failure rate by funnel step
- Mobile versus desktop completion

---

# 8. Critical user-flow review

## Flow A — Homepage → trial

### Current public state

```text
Homepage CTA
→ real signup page
→ account workflow not verified
```

### Required state

```text
Homepage CTA
→ plan-neutral or plan-aware signup
→ email verification
→ onboarding
→ sample data or first upload
→ first validated calculation
→ report preview
```

---

## Flow B — Pricing → selected plan → signup

### Current risk

- Plan and cadence may not persist.
- Trial eligibility is not equally explicit for every plan.
- Roadmap add-ons can be mistaken for current purchases.

### Required state

```text
Pricing
→ select plan and cadence
→ signup with selection summary
→ exact trial behavior
→ onboarding
→ checkout only when the user authorizes a paid plan
```

---

## Flow C — Sample report → evaluation → trial

### Current risk

The web sample and PDF disagree, and the PDF does not demonstrate the promised traceability.

### Required state

```text
Sample page
→ inspect consistent web preview
→ download full PDF
→ inspect factor register and evidence index
→ view methodology
→ start trial with the same fictional sample dataset
```

---

## Flow D — Security/legal review → sales

### Required state

```text
Security page
→ view standard trust packet
→ request detailed materials
→ preselected security intent
→ confirmation/reference number
```

```text
DPA page
→ download standard DPA
→ request countersignature
→ preselected privacy/legal intent
→ status confirmation
```

---

## Flow E — Existing user → login

### Required state

```text
Log in
→ authentication
→ MFA where enabled
→ requested workspace or last workspace
```

Include password reset, verification resend, session-expiry explanation, accessible errors, and support routing.

---

# 9. IDE implementation map

The repository was not available, so paths below are conceptual.

## High-value content search

```bash
rg -n \
  "verify before publication|August 10, 2026|42% primary|59% primary|83% industry|available today|Coming soon|Roadmap|additional supplier requests|premium report templates|personalized advertising|Do Not Track|Global Privacy Control|cloud hosting provider|analytics provider|Every number|all responses|penetration testing|Blog" \
  src app pages components content public
```

## Recommended shared modules

```text
src/
  content/
    capabilities.ts
    claims.ts
    pricing.ts
    regulatory-facts.ts
    trust-facts.ts
    legal-metadata.ts
  lib/
    emission-factors/
      registry.ts
      versions.ts
    reports/
      sample-fixture.ts
      calculations.ts
      quality-summary.ts
      pdf-export.ts
      csv-export.ts
    analytics/
      events.ts
  components/
    GlobalHeader.tsx
    GlobalFooter.tsx
    CapabilityStatus.tsx
    CanonicalCta.tsx
    PlanCard.tsx
    BillingToggle.tsx
    ContactForm.tsx
    DownloadCard.tsx
  tests/
    routes.spec.ts
    auth.spec.ts
    pricing.spec.ts
    sample-report.spec.ts
    claims.spec.ts
    legal-placeholders.spec.ts
    consent.spec.ts
    accessibility.spec.ts
```

## Priority commands

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Use framework equivalents where needed.

## Automated checks to add

1. Public-placeholder scanner
2. Capability-status consistency test
3. Regulatory-fact review-date check
4. Web/PDF/CSV report invariant tests
5. Route and soft-404 crawler
6. Duplicate title/canonical scanner
7. Pricing arithmetic and plan-context tests
8. Accessibility smoke test
9. Consent/network test
10. Screenshot regression tests

---

# 10. Recommended five-day stabilization sprint

## Day 1 — Trust blockers

- [x] Verify and publish backup-retention facts.
- Remove every placeholder.
- Build the trust-facts source.
- Reconcile DPA subprocessors.
- Reconcile cookie and Privacy wording.

## Day 2 — Product proof

- Create one sample-report fixture.
- Regenerate web, PDF, and CSV artifacts.
- Add report invariants.
- Expand the PDF into a credible sample deliverable.

## Day 3 — Product truth and regulation

- Update SB 253 content.
- Add regulatory-fact ownership and review dates.
- Build the capability registry.
- Remove or relabel unavailable add-ons.
- Reconcile demo and sample-report availability claims.

## Day 4 — Funnel and routes

- Preserve plan/cadence through signup.
- Test signup, login, verification, OAuth, and reset flows.
- Repair or remove `/blog`.
- Validate contact/demo/DPA delivery.
- Add route-level tests and correct metadata.

## Day 5 — Release validation

- Keyboard and screen-reader smoke tests.
- 320-pixel and 200% zoom tests.
- Chromium, Firefox, Safari, and Edge pass.
- Validate consent/network behavior.
- Validate sitemap, robots, canonicals, 404s, and redirects.
- Measure Core Web Vitals.
- Obtain product, methodology, privacy, legal, and security signoff.

---

# 11. Release-blocking checklist

## Product truth

- [ ] Web and PDF report values match.
- [ ] PDF demonstrates factor and evidence traceability.
- [ ] Capability status is consistent on every page.
- [ ] No roadmap feature is sold as live.
- [ ] Regulatory dates are current and qualified.
- [ ] Claims register is approved.

## Trust and legal

- [ ] No public placeholders remain.
- [ ] Backup and deletion timelines are verified.
- [ ] DPA names real subprocessors.
- [ ] Privacy matches cookie/network behavior.
- [ ] GPC/DNT claims are tested or removed.
- [ ] Security-control claims have evidence.
- [ ] Terms match actual billing and trial behavior.

## Conversion

- [ ] Signup completes successfully.
- [ ] Login completes successfully.
- [ ] Password reset completes successfully.
- [ ] OAuth providers complete successfully or are removed.
- [ ] Plan and billing context persist.
- [ ] Demo and contact forms deliver and confirm.
- [ ] Trial expiry and read-only state are tested.

## Accessibility

- [ ] Keyboard pass completed.
- [ ] Screen-reader smoke test completed.
- [ ] Forms expose errors correctly.
- [ ] Pricing toggle and comparison are accessible.
- [ ] Decorative icons are hidden from assistive technology.
- [ ] 320-pixel reflow and 200% zoom pass.
- [ ] Sample PDF is tagged and navigable.

## Technical UX and SEO

- [ ] `/blog` no longer soft-renders the homepage.
- [ ] Unknown routes return a real 404.
- [ ] Every indexable page has unique metadata.
- [ ] Auth pages are `noindex`.
- [ ] Canonicals, sitemap, and robots are verified.
- [ ] Link crawler passes.
- [ ] Core Web Vitals are measured.
- [ ] Staging deployments are not indexed.

---

# 12. Source references

## Eco-Auditor pages reviewed

- [Homepage](https://ecoauditor.io/)
- [Pricing](https://ecoauditor.io/pricing/)
- [Methodology](https://ecoauditor.io/methodology/)
- [Security](https://ecoauditor.io/security/)
- [Sample report](https://ecoauditor.io/sample-report/)
- [Demo](https://ecoauditor.io/demo)
- [Contact](https://ecoauditor.io/contact/)
- [Privacy Policy](https://ecoauditor.io/privacy/)
- [Terms of Service](https://ecoauditor.io/terms/)
- [Data Processing Addendum](https://ecoauditor.io/dpa/)
- [Login](https://ecoauditor.io/login)
- [Signup](https://ecoauditor.io/signup)
- [Blog route](https://ecoauditor.io/blog)

## Primary standards and regulatory sources

- [California Air Resources Board — Climate Corporate Data Accountability](https://ww2.arb.ca.gov/our-work/programs/climate-corporate-data-accountability)
- [California Air Resources Board — July 2026 regulatory materials](https://ww2.arb.ca.gov/our-work/programs/climate-corporate-data-accountability)
- [U.S. EPA GHG Emission Factors Hub](https://www.epa.gov/climateleadership/ghg-emission-factors-hub)
- [U.S. EPA eGRID](https://www.epa.gov/egrid)
- [GHG Protocol Corporate Standard](https://ghgprotocol.org/corporate-standard)
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Google Core Web Vitals](https://web.dev/articles/vitals)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)

---

# 13. Final recommendation

Eco-Auditor is meaningfully closer to a viable SaaS MVP than it was on July 11. The repaired authentication routes, dedicated demo page, clearer pricing, improved legal presentation, stronger brand identity, and updated methodology language provide a much better foundation.

The next release should prioritize consistency over expansion. The product’s public promise is traceability; therefore, its own sample outputs, feature statuses, regulatory statements, privacy disclosures, and security facts must trace back to one authoritative source.

The highest-impact sequence is:

1. Remove the security placeholder and verify retention facts.
2. Rebuild the sample report from one data source and upgrade the PDF.
3. Update and centralize regulatory dates.
4. Centralize feature availability and remove roadmap-sales conflicts.
5. Reconcile DPA, Privacy, cookie, and subprocessor facts.
6. Repair `/blog` and complete route/indexing validation.
7. Run authenticated funnel, accessibility, consent, and browser regression testing.

After these items pass, Eco-Auditor should be suitable for a controlled commercial launch, targeted outbound sales, and measured acquisition experiments.
