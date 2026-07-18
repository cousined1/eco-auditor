# Eco-Auditor UI/UX MVP Audit and Implementation Plan

**Audit date:** July 11, 2026  
**Site audited:** [https://ecoauditor.io](https://ecoauditor.io)  
**Audit type:** Public SaaS MVP UI/UX, conversion, product truth, trust, accessibility, content, and launch-readiness audit  
**Previous audit baseline:** June 16, 2026  
**Overall status:** **Meaningfully improved, but not ready for paid acquisition or broad launch**

---

## 1. Executive verdict

Eco-Auditor has made substantial progress since the previous audit. The rebuilt public site now includes the major trust and evaluation surfaces that were previously missing:

- Public pricing
- A detailed methodology page
- A security page
- A sample-report experience
- A clearer three-step product workflow
- Better explanation of the target customer and reporting use case
- Transparent labeling of illustrative customer examples

The marketing architecture is now much closer to a credible B2B SaaS MVP.

The current release is nevertheless blocked by several high-severity product-truth and conversion defects:

1. The public `/login` and `/signup` routes resolve to homepage content rather than functioning authentication screens.
2. The Terms, Privacy Policy, and DPA are publicly labeled as drafts and contain unresolved placeholders.
3. The sample report contains a mathematically misleading data-quality statement.
4. Methodology claims use factor versions and standards language that require correction or stronger qualification.
5. Trial, billing, retention, security, and compliance claims are inconsistent across public pages.
6. The sample report is presented as product proof but does not expose a real downloadable report or evidence pack.

These are not cosmetic issues. They affect whether a cautious finance, operations, procurement, sustainability, or legal buyer will trust the product enough to create an account or upload source records.

### Recommended launch decision

**Do not direct paid traffic to the current signup funnel.**

Complete the P0 fixes in this report, run a real-browser regression pass, and then reopen acquisition. The product can remain available for controlled demos or invited pilot users while those fixes are completed.

### Current MVP readiness score

**5.9 / 10**

The score reflects a strong improvement in public product explanation, offset by broken conversion routes and high-risk public trust inconsistencies.

---

## 2. Audit scope and verification limits

### Public surfaces reviewed

- `/`
- `/pricing/`
- `/methodology/`
- `/security/`
- `/sample-report/`
- `/contact/`
- `/privacy/`
- `/terms/`
- `/dpa/`
- `/login`
- `/signup`

### This audit evaluated

- Information architecture
- Navigation and CTA consistency
- Public conversion flow
- Pricing comprehension
- Product proof
- Trust and compliance messaging
- Methodology credibility
- Legal readiness
- Content clarity
- Accessibility risks visible from rendered page structure
- Metadata and indexability risks
- MVP launch readiness

### Not verified in this audit

- Authenticated dashboard behavior
- Source-code implementation
- Database or tenant isolation
- Actual Stripe checkout behavior
- Form submission delivery
- Password reset and OAuth
- Mobile device screenshots
- Full keyboard and screen-reader operation
- Lighthouse or Core Web Vitals measurements
- HTTP response headers
- `robots.txt`, sitemap, canonical tags, or structured data
- Actual security-control implementation
- Legal enforceability

A browser-style public retrieval was used to inspect rendered text and link destinations. Findings involving responsive layout, animation, focus behavior, contrast, and performance require a final manual browser pass.

> This is a product and UX audit, not legal advice, financial advice, assurance, or a penetration test.

---

## 3. What improved since the June 16 audit

| Previous recommendation | Current state | Assessment |
|---|---|---|
| Publish a methodology page | Implemented | Major improvement; now needs claim and source-version hardening |
| Publish a security page | Implemented | Good procurement signal; several statements require reconciliation |
| Add a public sample report | Implemented as a webpage | Useful proof, but calculation copy is wrong and no real download is visible |
| Make pricing public | Implemented | Stronger commercial clarity; inclusion semantics and billing context need work |
| Clarify the homepage workflow | Implemented | The three-step story is much easier to understand |
| Strengthen SMB positioning | Implemented | Audience and use case are clearer |
| Add product proof | Partially implemented | Sample output exists, but not yet a downloadable, defensible artifact |
| Add legal/compliance caveats | Partially implemented | Caveats exist, but public legal documents remain drafts |
| Improve conversion | Regressed or incomplete | Signup and login routes currently fail as product destinations |
| Expand indexable product depth | Improved | Core product pages now exist; metadata remains inconsistent |

### Most important positive change

The site now answers three questions much faster:

1. What is Eco-Auditor?
2. Who is it for?
3. How does the workflow operate?

That is a strong foundation. The next engineering phase should prioritize correctness and funnel reliability rather than adding more marketing sections.

---

## 4. MVP readiness scorecard

| Area | Score | Status | Main risk |
|---|---:|---|---|
| Positioning and ICP clarity | 8/10 | Strong | Could narrow direct versus supply-chain compliance applicability |
| Homepage narrative | 8/10 | Strong | Needs a more concrete product screenshot and reliable CTA destination |
| Conversion and activation | 3/10 | Critical | Login and signup routes resolve to homepage content |
| Pricing comprehension | 6/10 | Improving | Included/excluded features and billing cadence are not explicit enough |
| Product proof | 5/10 | Partial | Sample output exists, but no real downloadable report/evidence pack |
| Methodology credibility | 5/10 | At risk | Factor vintages, scoring language, and standards claims need correction |
| Trust and security | 5/10 | At risk | Strong page, but public claims conflict across documents |
| Legal readiness | 2/10 | Critical | Draft banners and unresolved placeholders are publicly visible |
| Navigation and information architecture | 6/10 | Needs work | Legal/contact headers lose primary navigation; demo routing is generic |
| Accessibility readiness | 5/10 | Unverified | Video fallback, feature semantics, focus, forms, and reflow need testing |
| Technical UX and SEO | 5/10 | Needs verification | Generic titles and soft route behavior may create duplicate/indexing issues |
| Launch analytics | 4/10 | Unknown | Funnel instrumentation is not publicly verifiable |
| Overall launch readiness | **5.9/10** | **Hold broad launch** | Conversion and trust defects must be fixed first |

---

# 5. P0 — Fix before launch or paid traffic

## P0-01 — Repair `/login` and `/signup`

**Area:** Conversion, authentication, routing  
**Severity:** Critical  
**Owner:** Frontend + authentication engineering  
**Effort:** Small to medium

### Observed behavior

The public navigation changes the URL to `/login` or `/signup`, but browser-style retrieval returns the homepage experience instead of a login or registration interface.

This breaks the two most important SaaS actions:

- Existing users cannot reliably access the product.
- New prospects cannot complete the primary homepage and pricing CTAs.

It also creates a possible soft-route or duplicate-content problem if those URLs return a successful status with homepage metadata.

### Required fix

Choose one explicit architecture:

#### Option A — Authentication on the marketing domain

```text
https://ecoauditor.io/login
https://ecoauditor.io/signup
```

Each route must render a real authentication screen.

#### Option B — Authentication on an app subdomain

```text
https://app.ecoauditor.io/login
https://app.ecoauditor.io/signup
```

Marketing CTAs must use server-side redirects to those destinations.

Do not silently render the homepage at authentication URLs.

### Registration requirements

The signup screen should state:

- Trial length
- Whether a payment method is required
- What happens when the trial ends
- Included plan or selected plan
- Data-use summary
- Terms and Privacy links
- Password requirements
- Whether Google or Microsoft sign-in is supported
- A route back to pricing or the sample report

### Preserve acquisition context

Use a plan-aware signup URL:

```text
/signup?plan=starter&billing=annual&source=pricing
```

Store the selection through registration and checkout. Do not force users to choose the plan a second time.

### Acceptance criteria

- [ ] `/login` displays a login heading and functional form.
- [ ] `/signup` displays a create-account heading and functional form.
- [ ] Neither route displays the marketing homepage as its primary content.
- [ ] Logged-in users are redirected intentionally to the dashboard.
- [ ] Logged-out users requesting an app route return to it after authentication.
- [ ] Plan and billing selections survive registration.
- [ ] Auth pages use `noindex, nofollow` unless there is a deliberate SEO reason not to.
- [ ] Invalid credentials, locked accounts, rate limits, and network errors have distinct messages.
- [ ] Password reset and email verification routes are tested.
- [ ] Every public CTA reaches the intended route in an end-to-end test.

### Suggested Playwright tests

```ts
import { expect, test } from "@playwright/test";

test("homepage trial CTA reaches registration", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /start free trial/i }).first().click();

  await expect(page).toHaveURL(/\/signup/);
  await expect(
    page.getByRole("heading", { name: /create|start.*trial|sign up/i })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /carbon accounting as easy as bookkeeping/i })
  ).not.toBeVisible();
});

test("login link reaches authentication", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /log in|sign in/i }).click();

  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByRole("heading", { name: /log in|sign in/i })
  ).toBeVisible();
});

test("pricing selection persists into signup", async ({ page }) => {
  await page.goto("/pricing/");
  await page
    .getByTestId("plan-starter")
    .getByRole("link", { name: /get started/i })
    .click();

  await expect(page).toHaveURL(/plan=starter/);
  await expect(page.getByText(/starter/i)).toBeVisible();
});
```

---

## P0-02 — Remove public legal drafts and placeholders

**Area:** Legal UX, trust, procurement  
**Severity:** Critical  
**Owner:** Legal + product + engineering  
**Effort:** Medium

### Observed problems

The Privacy Policy, Terms, and DPA are publicly presented with draft-for-review language. The Terms include unresolved fields for items such as:

- Effective date
- Liability amount
- Governing jurisdiction
- Dispute-resolution mechanism

A buyer evaluating carbon-accounting software may involve procurement, finance, legal, privacy, or a customer sustainability team. Public placeholders signal that the service is not commercially ready.

### Required fix

Before publishing the next release:

1. Obtain qualified legal review.
2. Replace all placeholders with actual operating terms.
3. Name the legal entity that operates Eco-Auditor.
4. State whether Eco-Auditor is a product name, DBA, or service of NIGHT LITE USA LLC / Developer312.
5. Ensure the billing configuration matches the Terms.
6. Ensure the Privacy Policy matches the actual architecture.
7. Publish an executable DPA or a clear request-and-sign process.
8. Add revision history or at least effective and last-updated dates.
9. Remove the public draft banner only after review is complete.

### Minimum legal-product facts to resolve

- Operator identity
- Business contact
- Subscription cadence
- Auto-renewal behavior
- Trial conversion behavior
- Cancellation effective date
- Refund policy
- Data ownership
- Service license
- Acceptable use
- Retention and deletion
- Subprocessors
- International transfers
- Privacy request process
- Governing law
- Dispute process
- Liability cap
- Warranty disclaimer
- Availability disclaimer
- Compliance/assurance limitations

### CI guardrail

Fail production builds if legal placeholders remain.

```ts
const bannedLegalPhrases = [
  "Date to be set",
  "AMOUNT TO BE SET",
  "Jurisdiction to be set",
  "Dispute resolution mechanism",
  "business draft for review",
  "[PLACEHOLDER]",
  "TBD",
];

for (const phrase of bannedLegalPhrases) {
  if (renderedPublicSite.includes(phrase)) {
    throw new Error(`Production legal placeholder detected: ${phrase}`);
  }
}
```

### Acceptance criteria

- [ ] No public legal document contains brackets, “TBD,” or review placeholders.
- [ ] The operating entity is named consistently.
- [ ] Terms match actual Stripe prices, cadence, trial logic, and cancellation behavior.
- [ ] Privacy language matches actual processors and storage.
- [ ] DPA annexes name actual subprocessors.
- [ ] Legal pages have valid effective and revision dates.
- [ ] A user can save or download the applicable Terms and DPA.
- [ ] All legal documents remain readable without JavaScript.
- [ ] The site does not claim legal or regulatory compliance beyond what counsel and evidence support.

---

## P0-03 — Correct the sample-report data-quality statement

**Area:** Product truth, methodology, report UX  
**Severity:** Critical  
**Owner:** Carbon methodology + frontend + QA  
**Effort:** Small

### Observed report values

The sample report displays:

- Level 1: 8%
- Level 2: 34%
- Level 3: 41%
- Level 4–5: 17%

It then states that **83%** of emissions are supported by “primary source data or better.”

That label does not match the displayed hierarchy:

```text
Level 1 + Level 2 = 8% + 34% = 42%
Level 1 + Level 2 + Level 3 = 83%
```

If Levels 1 and 2 represent direct measurement and primary source records, only 42% is primary-source quality or better. The 83% figure includes Level 3.

### Corrected copy

Use terminology that exactly matches the hierarchy:

```text
42% of emissions are supported by direct measurements or primary source records.

83% are supported by industry-average data or better.

17% rely on proxy or estimated data and are prioritized for improvement.
```

Change the terms to match the actual model if the hierarchy has a different intended definition.

### Required engineering change

Do not hand-write summary percentages. Derive them from the category values.

```ts
type QualityBreakdown = {
  level1: number;
  level2: number;
  level3: number;
  level4: number;
  level5: number;
};

export function summarizeQuality(q: QualityBreakdown) {
  const primaryOrBetter = q.level1 + q.level2;
  const industryAverageOrBetter = primaryOrBetter + q.level3;
  const estimated = q.level4 + q.level5;

  return {
    primaryOrBetter,
    industryAverageOrBetter,
    estimated,
  };
}
```

### Acceptance criteria

- [ ] Labels map exactly to the documented data-quality model.
- [ ] Category values total 100% within a defined rounding tolerance.
- [ ] Summary claims are calculated, not manually entered.
- [ ] Report totals and percentages are covered by unit tests.
- [ ] The web sample and downloadable export use the same calculation source.
- [ ] The quality methodology explains what each level means.
- [ ] A reviewer can inspect which sources contribute to each level.

---

## P0-04 — Correct methodology source versions and standards language

**Area:** Methodology trust, report defensibility  
**Severity:** Critical  
**Owner:** Carbon methodology + legal/product review  
**Effort:** Medium

### Observed risks

The methodology page references:

- EPA GHG Emission Factors Hub 2024
- eGRID 2024
- Annual factor update timing
- Operational control as the GHG Protocol’s “recommended approach”

These statements require stronger source control.

As of this audit:

- EPA publishes a 2025 annual update of its GHG Emission Factors Hub.
- EPA’s current public eGRID page identifies 2023 data as the latest available dataset.
- The GHG Protocol Corporate Standard permits equity share, financial control, and operational control approaches. Calling one approach “recommended” is stronger than the standard’s general framing.

### Required copy changes

#### Replace the organizational-boundary statement

Current concept:

```text
Our organizational boundary default is operational control, consistent with the Protocol's recommended approach.
```

Recommended:

```text
Eco-Auditor defaults to the operational-control approach for initial setup. The GHG Protocol also permits equity-share and financial-control approaches. Organizations should select and document the boundary method appropriate to their structure and reporting requirements.
```

#### Replace static factor-version marketing copy

Recommended:

```text
Eco-Auditor maintains a versioned emission-factor registry. Every calculation records the source organization, dataset, release date, factor identifier, unit, geography, effective period, and the version used in the report.
```

Then show the actual active datasets from the production registry rather than maintaining names manually in marketing copy.

### Build a factor registry

Minimum fields:

```ts
export interface EmissionFactorVersion {
  id: string;
  sourceOrganization: string;
  datasetName: string;
  sourceUrl: string;
  datasetVersion: string;
  publicationDate: string;
  importedAt: string;
  effectiveFrom: string;
  effectiveTo?: string;
  geography: string;
  activityUnit: string;
  outputUnit: string;
  factorValue: number;
  factorGas?: "CO2" | "CH4" | "N2O" | "CO2e";
  gwpBasis?: string;
  checksum: string;
  status: "draft" | "active" | "retired";
}
```

### Product requirements

- Reports must identify the factor version used.
- Historical reports must remain reproducible after factor updates.
- Recalculation must be an explicit user action or versioned report revision.
- Factor changes need a changelog.
- Archived factors must not disappear from report history.
- Marketing pages should read from the same dataset registry where practical.

### Acceptance criteria

- [ ] Active EPA and eGRID references match official source releases.
- [ ] The methodology page links to primary sources.
- [ ] Operational control is presented as Eco-Auditor’s default, not a universal recommendation.
- [ ] Every report records factor source and version.
- [ ] Historical calculations are reproducible.
- [ ] Factor update timing is based on actual source releases, not hard-coded calendar promises.
- [ ] A factor changelog is public or available in the product.
- [ ] Standards language has been reviewed for accuracy.

---

## P0-05 — Reconcile trial, billing, and compliance claims

**Area:** Commercial UX, product truth, legal consistency  
**Severity:** Critical  
**Owner:** Product + billing + legal  
**Effort:** Medium

### Trial contradiction

The homepage says:

```text
No credit card required · 14-day free trial
```

The Terms describe a trial that converts into a charge for the selected plan unless canceled.

Those statements can only coexist if a valid payment method is collected later and the user explicitly authorizes the subscription before charging. A no-card trial cannot automatically charge at expiration without an additional billing step.

### Required trial model

Choose one:

#### Model A — No-card trial

```text
No credit card required.
At the end of 14 days, the workspace becomes read-only until the user selects a paid plan.
No automatic charge occurs.
```

#### Model B — Card-backed trial

```text
Payment method required.
The selected subscription starts automatically after 14 days unless canceled.
The exact charge date and amount appear before confirmation.
```

Do not blend the two.

### Compliance-language contradiction

Marketing language describes GHG Protocol alignment and regulatory readiness, while the Terms disclaim that the service satisfies specific regulations or standards.

A reasonable, defensible middle position is:

```text
Eco-Auditor supports data collection, calculation, documentation, and export workflows designed around recognized reporting frameworks. It does not provide legal advice, independent assurance, certification, or a guarantee that a report satisfies every requirement applicable to a specific organization.
```

Use “supports,” “maps to,” or “designed around” where direct conformity has not been independently verified.

### Acceptance criteria

- [ ] Homepage, pricing, signup, checkout, Terms, FAQ, and cancellation UI describe one trial model.
- [ ] Exact post-trial behavior is visible before account creation.
- [ ] No user is charged without clear authorization.
- [ ] The selected plan, price, cadence, tax treatment, renewal date, and cancellation rule are shown at checkout.
- [ ] Marketing and legal pages use compatible compliance wording.
- [ ] “Aligned,” “compliant,” “audit-ready,” and “assurance” have approved definitions.
- [ ] Regulatory support does not imply filing, legal advice, or certification unless actually provided.
- [ ] Failed payment and trial-expiry states are designed and tested.

---

## P0-06 — Create one source of truth for security, retention, and subprocessors

**Area:** Trust center, privacy, security UX  
**Severity:** Critical  
**Owner:** Security + privacy + platform engineering  
**Effort:** Medium

### Observed inconsistencies

Public pages use overlapping but non-identical statements concerning:

- TLS 1.3 versus TLS 1.2+
- Deletion “on request” versus 90-day post-termination retention
- Retention according to the subscription agreement
- Named infrastructure providers on the security page
- Generic or incomplete subprocessor categories in the DPA
- “GDPR compliant” / “CCPA compliant” while legal pages remain drafts
- Standard security materials without NDA versus detailed documentation under NDA
- Data-at-rest encryption wording

A buyer should not need to compare four pages to determine which statement is authoritative.

### Required fix

Create a structured trust-facts source used by:

- Security page
- Privacy Policy
- DPA
- Signup privacy summary
- In-product data settings
- Sales security responses
- Exported security packet

Example:

```ts
export const trustFacts = {
  encryptionInTransitMinimum: "TLS 1.2",
  preferredTransport: "TLS 1.3",
  encryptionAtRest: "AES-256 or provider-equivalent",
  accountDeletionRequestWindowDays: 30,
  postTerminationRetentionDays: 90,
  backupsDeletionWindowDays: 35,
  contentUsedForModelTraining: false,
  subprocessors: [
    {
      name: "Railway",
      purpose: "Application hosting",
      processingRegion: "VERIFY",
      dpaUrl: "VERIFY",
    },
    {
      name: "InsForge",
      purpose: "Authentication and data services",
      processingRegion: "VERIFY",
      dpaUrl: "VERIFY",
    },
    {
      name: "Stripe",
      purpose: "Payment processing",
      processingRegion: "VERIFY",
      dpaUrl: "VERIFY",
    },
  ],
};
```

Do not publish guessed values. Replace `VERIFY` only after infrastructure and contracts are checked.

### Recommended public wording

Instead of:

```text
GDPR compliant
```

Use:

```text
Privacy and data-processing controls designed to support customers' GDPR and CCPA obligations. See the Privacy Policy and DPA for scope, roles, subprocessors, retention, and request procedures.
```

Use the stronger claim only after counsel and control evidence support it.

### Acceptance criteria

- [ ] TLS wording is consistent and technically verified.
- [ ] Encryption-at-rest wording matches every actual storage layer.
- [ ] Retention periods are identical across product, policy, DPA, and Terms.
- [ ] Account deletion UI explains active data and backup deletion timing.
- [ ] The DPA names actual subprocessors and purposes.
- [ ] The security page distinguishes public materials from NDA materials.
- [ ] “NoNDA” is corrected to “No NDA.”
- [ ] Compliance claims are qualified until verification is complete.
- [ ] Security claims have named internal owners and review dates.
- [ ] A quarterly trust-content review is scheduled.

---

# 6. P1 — High-impact conversion and usability fixes

## P1-01 — Turn the sample report into a real downloadable artifact

**Area:** Product proof  
**Severity:** High  
**Owner:** Product + reporting engineering  
**Effort:** Medium

### Problem

The public sample-report page is useful, but it functions mainly as a web mockup. A buyer evaluating “audit-ready” output needs to inspect the actual deliverable format.

### Required sample assets

Provide fictional, clearly labeled downloads:

```text
/sample-report/pacific-freight-fy2026.pdf
/sample-report/pacific-freight-activity-data.csv
/sample-report/pacific-freight-factor-register.csv
/sample-report/pacific-freight-evidence-index.csv
```

Optional:

```text
/sample-report/pacific-freight-methodology-notes.pdf
/sample-report/pacific-freight-assumptions.csv
```

### The PDF should include

- Organization and reporting period
- Boundary method
- Scope totals
- Category breakdown
- Data-quality summary
- Factor-version register
- Assumptions
- Exclusions
- Missing-data flags
- Evidence references
- Reviewer/signoff status
- Revision history
- Methodology and disclaimer
- Export timestamp
- Report identifier

### Acceptance criteria

- [ ] A visitor can download the sample without creating an account.
- [ ] The sample uses fictional data and says so on every artifact.
- [ ] Web and exported totals match.
- [ ] The report includes traceable factor references.
- [ ] The report distinguishes draft, reviewed, and approved status.
- [ ] The files are keyboard-accessible and have meaningful names.
- [ ] Download events are tracked without collecting sensitive content.

---

## P1-02 — Build a dedicated demo flow

**Area:** Lead conversion  
**Severity:** High  
**Owner:** Product marketing + frontend + sales operations  
**Effort:** Small to medium

### Problem

“Book a Demo” routes users to a generic contact page. The generic form does not preserve demo intent or help the prospect understand what will happen next.

### Recommended route

```text
/demo
```

### Recommended flow

1. Explain the 25–30 minute demo agenda.
2. Let the user select their goal:
   - Customer or RFP request
   - Scope 1 and 2 baseline
   - Supplier/Scope 3 collection
   - SB 253 readiness
   - Internal emissions tracking
   - Consultant/accounting workflow
3. Ask for company size, facilities, and reporting deadline.
4. Offer calendar booking or a clear response workflow.
5. Link to the sample report and methodology while the user waits.
6. Preselect `intent=demo` in CRM or form data.

### Acceptance criteria

- [ ] Every “Book a Demo” CTA reaches `/demo` or a preconfigured scheduler.
- [ ] Demo and support submissions are tracked separately.
- [ ] The confirmation state shows next steps and expected response time.
- [ ] The form has spam, duplicate, error, and rate-limit states.
- [ ] A user can still access the sample report without submitting the form.

---

## P1-03 — Make pricing inclusion and exclusion explicit

**Area:** Pricing UX, accessibility  
**Severity:** High  
**Owner:** Product + frontend  
**Effort:** Small

### Problem

The pricing cards list plan capabilities, but text extraction does not preserve obvious included/excluded semantics for several features. This suggests that meaning may depend on icons, opacity, color, or visual styling.

Examples that need explicit treatment include:

- Scope 3
- AI assistant
- Supplier hub
- Integrations
- Audit exports
- Multi-entity
- Custom reporting
- Team permissions
- API access

### Required markup

```html
<li>
  <span aria-hidden="true">✓</span>
  <span><strong>Included:</strong> Scope 1 and 2 reporting</span>
</li>

<li>
  <span aria-hidden="true">—</span>
  <span><strong>Not included:</strong> Scope 3 reporting</span>
</li>
```

Do not communicate availability only with green/red, check/cross, opacity, or strikethrough.

### Billing display

Use explicit labels:

```text
$149 per month, billed monthly
```

or:

```text
$124 per month equivalent
$1,490 billed annually
Save $298 compared with monthly billing
```

### Add-on behavior

“Add” buttons should not imply immediate purchase before the user has a plan or account. Use one of:

- `Add to selected plan`
- `Talk to sales`
- `Available after signup`
- A real plan configurator with running total

### Acceptance criteria

- [ ] Every feature says Included, Not included, Limited, or Add-on.
- [ ] Billing cadence appears beside every price.
- [ ] Annual savings are mathematically tested.
- [ ] Monthly and annual toggles announce changes to screen readers.
- [ ] The full comparison is available without a hidden inaccessible control.
- [ ] Plan CTAs preserve plan and cadence.
- [ ] Add-ons show price, billing cadence, eligibility, and effect on total.
- [ ] Pricing works at 320 CSS pixels and 200% zoom.

---

## P1-04 — Use one canonical CTA system

**Area:** Navigation, mental model  
**Severity:** High  
**Owner:** Product design + frontend  
**Effort:** Small

### Recommended CTA taxonomy

| Intent | Canonical label | Destination |
|---|---|---|
| Create an account | **Start free trial** | `/signup` |
| See output | **View sample report** | `/sample-report/` |
| Meet sales | **Book a demo** | `/demo` |
| Existing customer | **Log in** | `/login` |
| Review plans | **View pricing** | `/pricing/` |
| Ask a non-sales question | **Contact support** | `/contact/?topic=support` |
| Security request | **Request security materials** | `/contact/?topic=security` |
| DPA request | **Request a DPA** | `/contact/?topic=dpa` |

Avoid alternating among “Get started,” “Start free,” “Start trial,” and “Try now” for the same action unless there is a measured reason.

### Acceptance criteria

- [ ] One label maps to one intent.
- [ ] CTA destinations are identical across header, hero, pricing, reports, and footer.
- [ ] Demo links preserve demo intent.
- [ ] Security and DPA links preselect the correct contact topic.
- [ ] Analytics event names use the same intent taxonomy.

---

## P1-05 — Restore persistent navigation on contact and legal pages

**Area:** Information architecture  
**Severity:** High  
**Owner:** Frontend  
**Effort:** Small

### Problem

The contact and legal pages appear to use a reduced header that primarily exposes the logo. A prospect who reaches a policy or contact page should retain an easy route back to product evaluation.

### Recommended minimum header

```text
Eco-Auditor | Product | Pricing | Methodology | Security | Sample report | Log in | Start free trial
```

On narrow screens, preserve:

```text
Eco-Auditor | Menu | Log in
```

### Acceptance criteria

- [ ] The same global navigation component is used on all public pages.
- [ ] The active page is conveyed accessibly.
- [ ] A skip link is the first focusable element.
- [ ] Mobile navigation traps focus while open and closes with Escape.
- [ ] Legal in-page navigation does not replace global navigation.
- [ ] Footer content appears once, not twice in the accessibility tree.

---

## P1-06 — Fix contact-page polish and intent handling

**Area:** Form UX  
**Severity:** High  
**Owner:** Frontend + support operations  
**Effort:** Small

### Observed risks

- A stray standalone symbol appears near the “How can we help?” area in rendered text.
- Copyright/footer content appears duplicated in page order.
- The form uses a generic subject selector for sales, billing, product, legal/privacy, DPA, and other inquiries.
- Demo and security CTAs route into this generic experience.

### Required fixes

- Remove orphan icons or give them correct accessible labels.
- Ensure decorative icons use `aria-hidden="true"`.
- Remove duplicate footer or copyright nodes.
- Preselect the subject from query parameters.
- Provide field-level errors and a form-level summary.
- Show a meaningful confirmation state.
- Send an acknowledgment email with a reference number.
- Publish one monitored Eco-Auditor-domain address where possible.

Example:

```text
support@ecoauditor.io
security@ecoauditor.io
privacy@ecoauditor.io
```

These may route internally to existing Developer312 systems, but the customer-facing identity should remain coherent.

### Acceptance criteria

- [ ] No orphan glyph appears in screen-reader or copied text.
- [ ] Footer and copyright are rendered once.
- [ ] `/contact/?topic=dpa` preselects DPA.
- [ ] Form errors are associated with fields.
- [ ] Errors and success states receive focus.
- [ ] The stated response target matches real staffing.
- [ ] Email fallback works without JavaScript.
- [ ] Submission delivery is covered by an end-to-end test.

---

## P1-07 — Give every core page unique metadata

**Area:** SEO, browser UX, sharing  
**Severity:** High  
**Owner:** SEO + frontend  
**Effort:** Small

### Problem

Several core product pages use the same broad Eco-Auditor title instead of page-specific titles. This weakens:

- Browser-tab recognition
- Search-result differentiation
- Social sharing
- Analytics debugging
- Accessibility for users navigating page history

### Suggested titles

```text
Eco-Auditor Pricing | Carbon Accounting Plans for SMBs
Carbon Accounting Methodology | Eco-Auditor
Eco-Auditor Sample GHG Report | Scope 1, 2, and 3
Eco-Auditor Security and Data Protection
Contact Eco-Auditor
Log In to Eco-Auditor
Start an Eco-Auditor Free Trial
```

### Required metadata

- Unique `<title>`
- Unique meta description
- Canonical URL
- Open Graph title, description, image, URL
- X/Twitter card
- Appropriate robots directive
- SoftwareApplication or Organization structured data where valid
- Breadcrumb structured data on deeper public pages where valid

### Acceptance criteria

- [ ] No two indexable pages share the same title and description.
- [ ] Login, signup, account, billing, and dashboard pages are `noindex`.
- [ ] Canonicals use one host and slash convention.
- [ ] Social previews use a real 1200×630 image.
- [ ] Structured data validates without misleading ratings or claims.
- [ ] The sitemap contains every intended public page.
- [ ] `robots.txt` references the sitemap.

---

## P1-08 — Explain the proprietary data-confidence model

**Area:** Methodology UX  
**Severity:** High  
**Owner:** Carbon methodology + product design  
**Effort:** Medium

### Problem

The methodology page displays confidence ranges by data-quality level. Those percentages can look like externally standardized certainty values unless the site clearly identifies them as Eco-Auditor’s internal model.

### Required explanation

Add:

```text
Eco-Auditor data-confidence score

This score is an internal decision-support indicator, not an assurance opinion or a GHG Protocol certification. It combines source type, source recency, coverage, estimation method, factor specificity, and review status. Users can inspect the inputs and override classifications with a recorded reason.
```

Document:

- Formula or weighting approach
- Source classifications
- Missing-data treatment
- Recency effects
- Factor specificity
- Reviewer effects
- Override rules
- Rounding
- Known limitations
- Validation plan

### Acceptance criteria

- [ ] The model is labeled as proprietary/internal.
- [ ] It is not presented as auditor assurance.
- [ ] Users can inspect why a record received its level.
- [ ] Overrides create an audit-log entry.
- [ ] The score is versioned.
- [ ] Report exports identify the scoring-model version.
- [ ] Confidence ranges are not used without validation evidence.

---

## P1-09 — Improve video fallback and reduced-motion behavior

**Area:** Accessibility, resilience  
**Severity:** High  
**Owner:** Frontend + design  
**Effort:** Small

### Problem

The homepage product video exposes a generic “Your browser does not support the video tag” fallback. That does not help:

- Users with unsupported browsers
- Users blocking media
- Screen-reader users
- Users on constrained connections
- Search and agentic clients
- Users who prefer reduced motion

### Required implementation

```html
<video
  controls
  preload="metadata"
  poster="/images/product-workflow-poster.webp"
  aria-describedby="product-video-description"
>
  <source src="/video/product-workflow.webm" type="video/webm" />
  <source src="/video/product-workflow.mp4" type="video/mp4" />
  <track
    kind="captions"
    src="/video/product-workflow.en.vtt"
    srclang="en"
    label="English"
    default
  />
  <p>
    Watch the <a href="/demo">interactive product walkthrough</a>
    or read the <a href="/product-tour">text transcript</a>.
  </p>
</video>
```

### Acceptance criteria

- [ ] Captions are available.
- [ ] A transcript is available.
- [ ] A poster provides product context without autoplay.
- [ ] Autoplay is disabled or silent and nonessential.
- [ ] Reduced-motion users receive a static alternative.
- [ ] Video controls are keyboard accessible.
- [ ] The fallback links to equivalent information.

---

## P1-10 — Tighten claims and supporting evidence

**Area:** Trust, copy accuracy  
**Severity:** High  
**Owner:** Product marketing + legal/methodology review  
**Effort:** Small

### Claims requiring review

- “Audit-ready”
- “Compliance-ready”
- “GDPR compliant”
- “CCPA compliant”
- Consultant cost comparisons such as $15,000–$40,000
- Setup in under 10 minutes
- Report generation speed
- Regulatory readiness
- “No proprietary formats”
- “Every number” traceability
- Security-control absolutes such as “all responses”
- Update-cadence promises
- Data-deletion timing

### Claim register

Create a maintained file:

```yaml
claims:
  - id: audit-ready
    text: "Audit-ready reporting"
    owner: "Product + Methodology"
    evidence: "docs/claims/audit-ready.md"
    approved_surfaces:
      - homepage
      - pricing
    caveat: "Does not constitute independent assurance."
    reviewed_at: "2026-07-11"
    review_due: "2026-10-11"
```

### Acceptance criteria

- [ ] Every quantitative claim has a source or test.
- [ ] Every security absolute has technical evidence.
- [ ] Every regulatory claim has legal/methodology approval.
- [ ] Cost comparisons cite a defensible source or are removed.
- [ ] Setup-time claims are supported by usability tests.
- [ ] “Audit-ready” has a public definition.
- [ ] The same approved wording is reused across pages.

---

## P1-11 — Clarify direct regulatory applicability

**Area:** ICP, expectation setting  
**Severity:** High  
**Owner:** Product marketing + legal review  
**Effort:** Small

### Problem

The site discusses California climate disclosure and CBAM in an SMB-focused product. Many SMBs will not be directly subject to the same thresholds but may receive data requests from customers, procurement teams, lenders, or supply-chain partners.

### Recommended framing

```text
Prepare for direct reporting obligations and customer-driven data requests.

Eco-Auditor helps organizations assemble traceable emissions data and supporting evidence. Applicability depends on company size, revenue, jurisdiction, corporate structure, and supply-chain role.
```

For SB 253:

```text
California's first-year Scope 1 and Scope 2 reporting deadline is August 10, 2026, for covered entities. Smaller suppliers may still receive emissions-data requests from covered customers.
```

For CBAM:

```text
Eco-Auditor can support the collection and organization of emissions inputs used in CBAM-related workflows. It does not replace an authorized declarant, customs filing, legal review, or required verification.
```

### Acceptance criteria

- [ ] Direct obligations and customer-driven requests are distinguished.
- [ ] Thresholds and dates link to official sources.
- [ ] Dates are maintained through a reviewed content source.
- [ ] Product support is not described as filing or legal determination.
- [ ] Industry/use-case pages identify who is likely to use each workflow.

---

## P1-12 — Simplify the cookie-consent experience

**Area:** Privacy UX  
**Severity:** High  
**Owner:** Privacy + frontend  
**Effort:** Small to medium

### Problem

The banner refers to personalized content and nonessential cookies. For an early B2B SaaS, unnecessary marketing technology can create more trust friction than value.

### Required decisions

- Inventory every cookie and local-storage key.
- Remove unused marketing and personalization technologies.
- Categorize actual purposes.
- Block nonessential scripts until consent where required.
- Honor withdrawal.
- Test Global Privacy Control behavior if claimed.
- Ensure Accept and Reject have equivalent prominence.
- Do not use dark patterns.

### Acceptance criteria

- [ ] The cookie table matches network behavior.
- [ ] Reject is as easy as Accept.
- [ ] Necessary-only mode leaves the core site functional.
- [ ] Consent is stored with version and timestamp.
- [ ] Users can reopen preferences from the footer.
- [ ] No nonessential tag fires before permission where required.
- [ ] Privacy copy does not promise unsupported DNT/GPC behavior.

---

## P1-13 — Make brand and operator identity consistent

**Area:** B2B trust  
**Severity:** High  
**Owner:** Brand + legal + frontend  
**Effort:** Small

### Current identity variants to reconcile

- Eco-Auditor
- EcoAuditor
- ecoauditor.io
- Developer312
- NIGHT LITE USA LLC

### Recommended hierarchy

```text
Product: Eco-Auditor
Domain: ecoauditor.io
Operator: [Verified legal entity]
Product studio/brand: Developer312, where relevant
```

Example footer:

```text
Eco-Auditor is a carbon-accounting software product operated by [LEGAL ENTITY].
© 2026 [LEGAL ENTITY]. All rights reserved.
```

### Acceptance criteria

- [ ] One product spelling is used in headings, metadata, emails, and exports.
- [ ] The operator is named in the footer, Terms, Privacy Policy, invoices, and checkout.
- [ ] Customer-facing support uses the Eco-Auditor domain where feasible.
- [ ] Cross-links to unrelated products do not dominate the primary product footer.
- [ ] Report headers identify both product and legal operator appropriately.

---

# 7. P2 — Improve after the launch blockers are resolved

## P2-01 — Replace testimonial-shaped composites with validated proof

The site correctly discloses that current examples are illustrative composites. That is better than implying they are real customers.

Next step:

- Present them as “Example outcomes” rather than testimonial cards.
- Add assumptions and calculation basis.
- Replace them with permissioned pilot results when available.
- Do not use company logos without authorization.

Acceptance criteria:

- [ ] Illustrative examples cannot be mistaken for actual customer endorsements.
- [ ] Real case studies state timeframe, baseline, workflow, and measurable result.
- [ ] Every quote has documented permission.

---

## P2-02 — Add buyer-specific landing pages

Recommended routes:

```text
/industries/food-and-beverage
/industries/light-manufacturing
/industries/logistics
/use-cases/customer-carbon-data-requests
/use-cases/scope-1-and-2-baseline
/use-cases/supplier-scope-3-collection
/use-cases/rfp-emissions-disclosure
/use-cases/audit-evidence-preparation
```

Each page should include:

- Buyer problem
- Input records
- Workflow
- Sample output
- Applicable caveats
- Time-to-value
- Plan fit
- One primary CTA

---

## P2-03 — Publish factor and methodology change logs

Recommended routes:

```text
/methodology/changelog
/emission-factors
/emission-factors/changelog
```

Show:

- Dataset
- Version
- Publication date
- Activation date
- Changed categories/geographies
- Whether historical reports are affected
- Recalculation options
- Model version

---

## P2-04 — Add procurement-ready trust materials

Recommended trust packet:

- Security overview
- Architecture/data-flow diagram
- Subprocessor list
- DPA
- Retention schedule
- Backup/recovery overview
- Access-control summary
- Vulnerability disclosure process
- Incident contact
- Business continuity overview
- Insurance/certification status, only when verified
- Standard security questionnaire answers

---

## P2-05 — Improve first-run activation

Recommended onboarding:

1. Reporting objective
2. Reporting period
3. Industry
4. Organizational boundary
5. Facilities
6. Available records
7. Preferred first output

Then offer:

```text
Upload one utility bill
Use fictional sample data
Import a CSV
Connect an integration
```

Activation goal:

```text
New user sees a useful first report preview in under 10 minutes.
```

Do not count account creation as activation. Use first validated calculation or report preview.

---

## P2-06 — Add contextual empty and error states

Examples:

```text
No facilities yet
Add your first location to organize utility, fuel, fleet, and refrigerant data.
[Add facility]
```

```text
We could not match 4 rows
Download the error file, correct the highlighted units, and upload again.
[Download errors] [Review mappings]
```

Every error should state:

- What happened
- What was preserved
- What the user can do
- Whether support is needed
- A retry action

---

# 8. Critical user-flow audit

## Flow A — Homepage → free trial

### Current state

```text
Homepage CTA → /signup → homepage content
```

### Required state

```text
Homepage CTA
→ plan-neutral or plan-aware signup
→ verification
→ onboarding
→ sample data or first upload
→ report preview
```

### Funnel events

```text
home_viewed
trial_cta_clicked
signup_viewed
signup_started
signup_completed
email_verified
onboarding_started
onboarding_completed
sample_data_selected
first_source_uploaded
first_calculation_completed
first_report_previewed
```

---

## Flow B — Pricing → plan selection → trial

### Current risk

- Plan selection may not persist.
- Annual equivalent pricing can be misunderstood.
- Included and excluded capabilities are not sufficiently explicit.
- Signup route is not functioning as expected.

### Required state

```text
Pricing
→ select plan and cadence
→ signup with selection summary
→ trial behavior disclosure
→ onboarding
→ upgrade/checkout only when required
```

### Required selection summary

```text
Starter
$1,490 billed annually
14-day no-card trial
No automatic charge
Workspace becomes read-only at trial end until a paid plan is selected
```

Use the actual approved model.

---

## Flow C — Sample report → evaluation → trial

### Current state

The page provides helpful fictional output, but the strongest evidence is not downloadable.

### Required state

```text
Sample-report page
→ download report
→ inspect evidence index
→ view methodology
→ start trial with sample dataset
```

Track:

```text
sample_report_viewed
sample_pdf_downloaded
sample_evidence_downloaded
methodology_opened_from_sample
trial_started_from_sample
```

---

## Flow D — Security or legal review → sales

### Current state

Security/DPA/demo calls commonly route to a general contact form.

### Required state

```text
Security page
→ request standard packet or detailed review
→ preselected security intent
→ confirmation and reference number
```

```text
DPA page
→ download standard DPA or request signature
→ preselected privacy/legal intent
```

Do not force security buyers to explain what document they are requesting in an unstructured message.

---

## Flow E — Existing user → login

### Required state

```text
Log in
→ authentication
→ MFA where enabled
→ last workspace or workspace chooser
```

Include:

- Forgot password
- Email verification resend
- SSO route where available
- Accessible error recovery
- Support path
- Session-expiry explanation

---

# 9. Recommended homepage hierarchy

```text
Global header
  Product
  Pricing
  Methodology
  Security
  Sample report
  Log in
  Start free trial

Hero
  Carbon accounting for SMBs that need traceable Scope 1–3 reporting.
  Turn utility bills, fuel records, fleet data, and supplier inputs into reviewable calculations and exports.
  [Start free trial] [View sample report]
  14-day trial behavior · payment-method rule · setup expectation

Product proof
  Real product screenshot or interactive report panel
  Scope totals · evidence status · factor version · missing-data flags

How it works
  Collect → Calculate → Review → Export

What the report contains
  Boundaries
  Activity data
  Emission factors
  Assumptions
  Data quality
  Evidence index
  Revision history

Who it is for
  Operations
  Finance
  Sustainability
  Consultants/accountants

Methodology and trust
  GHG Protocol workflow support
  Versioned factors
  Security and data handling
  Clear assurance/compliance caveat

Sample report
  Web preview
  PDF download
  CSV/evidence download

Pricing preview
  Exact monthly and annual billing
  Included/excluded features
  Trial behavior

FAQ
  Data retention
  Factor updates
  Scope 3
  Compliance applicability
  Cancellation

Final CTA
  Start free trial
  Book a demo

Footer
  Product
  Resources
  Company/operator
  Security
  Legal
  Support
  Cookie preferences
```

---

# 10. Accessibility implementation checklist

Target **WCAG 2.2 AA**.

## Navigation

- [ ] Skip link is visible on focus.
- [ ] Header landmarks are unique and labeled.
- [ ] Mobile menu is fully keyboard operable.
- [ ] Focus is trapped in the open menu.
- [ ] Escape closes overlays.
- [ ] Current-page state is exposed.
- [ ] Focus does not disappear behind sticky headers.

## Forms

- [ ] Every input has a persistent visible label.
- [ ] Required state is programmatically conveyed.
- [ ] Help text uses `aria-describedby`.
- [ ] Errors appear beside fields and in a summary.
- [ ] Error summary receives focus.
- [ ] Success state is announced.
- [ ] Password rules appear before submission.
- [ ] Autocomplete tokens are correct.
- [ ] No placeholder is used as the only label.

## Pricing

- [ ] Toggle has an accessible name and state.
- [ ] Price changes are announced without excessive live-region noise.
- [ ] Included/excluded status is textual.
- [ ] Cards follow a logical reading order.
- [ ] Comparison table has headers and captions.
- [ ] Horizontal overflow remains usable.

## Report data

- [ ] Charts have text summaries.
- [ ] Tables have row/column headers.
- [ ] Color is not the only indicator.
- [ ] Tooltips are keyboard and touch accessible.
- [ ] Download links include file type and size.
- [ ] Data quality has plain-language definitions.

## Media and motion

- [ ] Video includes captions and transcript.
- [ ] Motion respects `prefers-reduced-motion`.
- [ ] No essential information exists only in animation.
- [ ] Autoplay is avoided.
- [ ] Poster text meets contrast requirements.

## Visual

- [ ] Text contrast meets 4.5:1, or 3:1 for qualifying large text.
- [ ] UI components and focus indicators meet 3:1.
- [ ] Focus indicators are not obscured.
- [ ] Page works at 200% zoom.
- [ ] Page reflows at 320 CSS pixels.
- [ ] Touch targets meet WCAG 2.2 target-size guidance.
- [ ] Error, warning, and success colors include icons/text.

## Legal documents

- [ ] Heading order is logical.
- [ ] In-page table of contents is keyboard accessible.
- [ ] Anchor targets are not hidden under sticky UI.
- [ ] Long paragraphs have reasonable line length.
- [ ] Print stylesheet produces readable documents.
- [ ] Effective and updated dates are exposed as text.

---

# 11. Technical UX and SEO checklist

## Routing

- [ ] Every header and footer link has an automated route test.
- [ ] Public routes return the correct content and status.
- [ ] Auth routes do not soft-render the homepage.
- [ ] Unknown routes return a real 404 status and helpful page.
- [ ] Redirects are server-side where appropriate.
- [ ] Trailing-slash behavior is consistent.

## Indexing

- [ ] Public marketing pages are indexable.
- [ ] Authenticated and account routes are `noindex`.
- [ ] Canonicals are self-referential and use one host.
- [ ] Sitemap includes intended public routes.
- [ ] `robots.txt` references sitemap.
- [ ] Staging and preview deployments are blocked from indexing.

## Metadata

- [ ] Unique title and description per page.
- [ ] Open Graph image exists.
- [ ] Social metadata uses absolute URLs.
- [ ] Favicon and Apple touch icon exist.
- [ ] Organization schema names the real operator.
- [ ] SoftwareApplication schema does not invent ratings.
- [ ] FAQ schema is used only for visible eligible content.

## Performance

Measure, do not assume:

- [ ] LCP ≤ 2.5 seconds at the 75th percentile
- [ ] INP ≤ 200 milliseconds at the 75th percentile
- [ ] CLS ≤ 0.1 at the 75th percentile
- [ ] Hero video is not the blocking LCP element.
- [ ] Fonts use appropriate preload and fallback.
- [ ] Below-fold media is lazy-loaded.
- [ ] Marketing pages do not ship authenticated dashboard bundles.
- [ ] Third-party scripts have owners and budgets.

## Resilience

- [ ] Static marketing content renders without client-side hydration.
- [ ] Critical CTAs remain usable if analytics fails.
- [ ] Contact form handles network failure.
- [ ] Downloads use stable URLs.
- [ ] Consent manager failure does not block necessary navigation.
- [ ] Product screenshots have static alternatives.

---

# 12. Analytics and MVP measurement plan

Do not place uploaded bills, supplier names, invoice text, emissions records, or report content in analytics payloads.

## Acquisition

```text
marketing_page_viewed
primary_cta_clicked
sample_report_viewed
sample_report_downloaded
pricing_viewed
demo_started
demo_submitted
```

## Registration

```text
signup_viewed
signup_started
signup_error
signup_completed
email_verification_sent
email_verified
login_succeeded
login_failed
password_reset_started
```

## Activation

```text
onboarding_started
reporting_goal_selected
sample_company_selected
facility_created
source_upload_started
source_upload_completed
source_upload_failed
mapping_completed
first_calculation_completed
first_report_previewed
```

## Conversion

```text
plan_selected
checkout_started
checkout_completed
checkout_failed
trial_expiring
trial_converted
trial_expired
upgrade_started
subscription_canceled
```

## Product quality

```text
calculation_warning_viewed
missing_data_flag_viewed
factor_citation_opened
report_exported
report_review_requested
report_approved
```

## Required dashboards

- Homepage → signup conversion
- Pricing → signup conversion by plan
- Sample report → signup conversion
- Signup → verified account
- Verified account → first source upload
- First upload → first calculation
- First calculation → report preview
- Trial → paid conversion
- Failure rate by funnel step
- Mobile versus desktop completion
- Most common import and validation errors

---

# 13. IDE implementation map

The exact repository structure was not available. Use the following as a search-and-fix map.

## High-value search command

```bash
rg -n \
  "Start Free Trial|Log In|Book a Demo|83% of total emissions|primary source data or better|EPA GHG Factor Hub 2024|eGRID 2024|recommended approach|Date to be set|AMOUNT TO BE SET|Jurisdiction to be set|Dispute resolution mechanism|business draft for review|NoNDA|GDPR compliant|CCPA compliant|90 days|No credit card required|automatically charged" \
  src app pages components content public
```

Adjust directories to the framework.

## Likely route targets

```text
/
/login
/signup
/pricing
/methodology
/security
/sample-report
/contact
/privacy
/terms
/dpa
/demo
```

## Recommended shared modules

```text
src/
  content/
    claims.ts
    trust-facts.ts
    pricing.ts
    methodology.ts
    legal-metadata.ts
  lib/
    emission-factors/
      registry.ts
      versions.ts
    reports/
      calculations.ts
      quality-summary.ts
    analytics/
      events.ts
  components/
    GlobalHeader.tsx
    GlobalFooter.tsx
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
    legal-placeholders.spec.ts
    accessibility.spec.ts
```

## Priority test commands

```bash
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Add framework equivalents where missing.

## Suggested automated checks

```text
1. Link crawler
2. Legal-placeholder scanner
3. Duplicate-title scanner
4. Accessibility smoke test
5. Pricing arithmetic tests
6. Report invariant tests
7. Auth-route tests
8. Screenshot regression tests
9. Sitemap/canonical validation
10. Claim-register review-date check
```

---

# 14. Recommended seven-day stabilization sprint

## Day 1 — Restore the funnel

- Fix `/login`.
- Fix `/signup`.
- Repair every trial/login CTA.
- Preserve plan and cadence.
- Add route-level end-to-end tests.
- Verify real HTTP statuses.

## Day 2 — Remove public trust blockers

- Complete legal review or temporarily unpublish incomplete legal claims.
- Remove all placeholders.
- Reconcile operator identity.
- Align trial and billing terms.
- Replace unsupported compliance absolutes.

## Day 3 — Correct product truth

- Fix the 42% / 83% sample-report statement.
- Add report arithmetic tests.
- Correct factor-version references.
- Rewrite operational-control language.
- Label the internal confidence model.

## Day 4 — Strengthen product proof

- Generate a real sample PDF.
- Publish evidence-index and activity-data downloads.
- Add file metadata and accessible download cards.
- Create factor/version display.
- Verify all sample totals.

## Day 5 — Clarify pricing and demo

- Add explicit included/excluded labels.
- Clarify annual equivalent versus billed amount.
- Make add-on behavior concrete.
- Create `/demo`.
- Preselect contact intent.

## Day 6 — Accessibility and metadata

- Run axe automated checks.
- Perform keyboard-only test.
- Add captions/transcript/video poster.
- Restore consistent global navigation.
- Add unique page titles and descriptions.
- Remove duplicate footer nodes and orphan glyphs.

## Day 7 — Release validation

- Run full end-to-end suite.
- Test at 320 px, tablet, desktop, and 200% zoom.
- Test Safari, Firefox, Chromium, and Edge.
- Validate forms and email delivery.
- Validate analytics without sensitive payloads.
- Verify sitemap, robots, canonicals, headers, and 404s.
- Conduct product, legal, methodology, and security signoff.

---

# 15. Release-blocking checklist

## Conversion

- [ ] Login works.
- [ ] Signup works.
- [ ] Trial CTA reaches signup.
- [ ] Plan choice persists.
- [ ] Trial behavior is explicit.
- [ ] Demo has a dedicated flow.
- [ ] Contact intent is preserved.

## Product truth

- [ ] Sample-report percentages are correct.
- [ ] Report values are calculated from one source.
- [ ] Factor versions are current and traceable.
- [ ] Organizational-boundary language is accurate.
- [ ] Internal confidence scoring is labeled.
- [ ] Claims register is approved.

## Legal and trust

- [ ] No draft banners or placeholders.
- [ ] Operator identity is consistent.
- [ ] Terms match billing.
- [ ] Privacy matches architecture.
- [ ] DPA names real subprocessors.
- [ ] Retention is consistent.
- [ ] Security statements are verified.
- [ ] Compliance language is qualified.

## Accessibility

- [ ] Keyboard pass completed.
- [ ] Screen-reader smoke test completed.
- [ ] Mobile reflow completed.
- [ ] Pricing semantics are textual.
- [ ] Forms expose errors correctly.
- [ ] Video has captions and transcript.
- [ ] Focus states are visible.

## Technical UX

- [ ] No soft homepage at auth routes.
- [ ] Real 404 status.
- [ ] Unique metadata.
- [ ] Canonicals verified.
- [ ] Sitemap and robots verified.
- [ ] Core Web Vitals measured.
- [ ] Link checker passes.
- [ ] No duplicate footer content.

## Product proof

- [ ] Sample PDF downloads.
- [ ] Evidence index downloads.
- [ ] Web and PDF totals match.
- [ ] Fictional-data disclosure is clear.
- [ ] Report includes factor and methodology versions.

---

# 16. Suggested replacement copy

## Homepage trust line

```text
Start with sample data or your own records. Your workspace stays private, and uploaded content is not used to train public AI models. See Security and Privacy for retention, processors, and deletion details.
```

Use only after verifying each statement.

## Methodology boundary copy

```text
Eco-Auditor defaults to the operational-control approach for initial setup. The GHG Protocol also permits equity-share and financial-control approaches. Select and document the method appropriate to your organizational structure and reporting requirements.
```

## Factor-version copy

```text
Every calculation records its emission-factor source, dataset version, geography, unit, effective period, and report revision. Historical reports retain the factor versions used when they were generated.
```

## Sample data-quality copy

```text
42% of emissions are supported by direct measurements or primary source records. 83% are supported by industry-average data or better. The remaining 17% uses proxy or estimated data and is prioritized for improvement.
```

## Compliance caveat

```text
Eco-Auditor supports emissions-data collection, calculation, documentation, and export workflows designed around recognized reporting frameworks. It does not provide legal advice, independent assurance, certification, or a guarantee that a report satisfies every requirement applicable to a specific organization.
```

## No-card trial copy

```text
Try Eco-Auditor for 14 days without a credit card. No automatic charge occurs. At the end of the trial, select a paid plan to continue editing and exporting reports.
```

Use only if this is the approved product behavior.

## Security qualification

```text
Eco-Auditor uses documented access, encryption, retention, and deletion controls designed to support customer privacy and security requirements. Review the Security page, Privacy Policy, and DPA for scope and current control details.
```

---

# 17. Source and standards references

## Eco-Auditor pages reviewed

- [Homepage](https://ecoauditor.io/)
- [Pricing](https://ecoauditor.io/pricing/)
- [Methodology](https://ecoauditor.io/methodology/)
- [Security](https://ecoauditor.io/security/)
- [Sample report](https://ecoauditor.io/sample-report/)
- [Contact](https://ecoauditor.io/contact/)
- [Privacy Policy](https://ecoauditor.io/privacy/)
- [Terms of Service](https://ecoauditor.io/terms/)
- [Data Processing Addendum](https://ecoauditor.io/dpa/)
- [Login](https://ecoauditor.io/login)
- [Signup](https://ecoauditor.io/signup)

## Primary reference standards and sources

- [GHG Protocol Corporate Standard](https://ghgprotocol.org/corporate-standard)
- [US EPA GHG Emission Factors Hub](https://www.epa.gov/climateleadership/ghg-emission-factors-hub)
- [US EPA eGRID](https://www.epa.gov/egrid)
- [California Air Resources Board climate corporate data accountability](https://ww2.arb.ca.gov/our-work/programs/climate-corporate-data-accountability)
- [European Commission Carbon Border Adjustment Mechanism](https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en)
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Google Core Web Vitals](https://web.dev/articles/vitals)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)

---

# 18. Final recommendation

The new engineering work solved much of the previous site-architecture problem. Eco-Auditor now looks like a more complete SaaS offering because buyers can inspect pricing, methodology, security, and sample output before creating an account.

The next release should not add more surface area. It should make the existing promise reliable.

The highest-impact sequence is:

1. Repair login and signup.
2. Replace public legal drafts with reviewed production documents.
3. Correct the sample-report quality statement.
4. Version and verify methodology sources.
5. Reconcile trial, compliance, security, retention, and subprocessor language.
6. Publish a real downloadable sample report and evidence pack.
7. Complete accessibility, metadata, route, and form regression testing.

Once those items pass, Eco-Auditor will have a credible MVP foundation for pilot onboarding, outbound sales, SEO growth, and paid acquisition.
