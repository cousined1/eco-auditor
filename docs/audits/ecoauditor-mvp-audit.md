# Eco-Auditor MVP Audit and Fix Plan

Audit date: 2026-06-16  
Site audited: https://ecoauditor.io  
Audit type: Public MVP readiness audit, positioning, conversion flow, technical SEO, trust, compliance messaging, accessibility, and launch readiness.

## Executive Summary

Eco-Auditor has a strong MVP direction: carbon accounting for small and mid-size businesses that need audit-ready Scope 1, 2, and 3 emissions reporting without hiring an enterprise sustainability team. The strongest parts of the current public footprint are the focused promise, the GHG Protocol alignment claim, the SMB positioning, and external messaging around contract readiness, cost avoidance, and audit defensibility.

The biggest launch risk is trust. Carbon accounting is a compliance-sensitive category. Buyers will not upload bills, utility data, supplier records, invoices, or operational data unless the site clearly explains methodology, data handling, report defensibility, and what "audit-ready" does and does not mean.

The second biggest launch risk is discoverability. Search results show the homepage, contact, privacy, and DPA pages, but pricing, feature, demo, sample report, industry pages, and educational content are not strongly visible. For a SaaS MVP, the site needs more indexable product depth and buyer-intent pages before paid ads or outbound campaigns scale.

Overall MVP status: **Promising but not launch-tight yet.** Fix trust, demo proof, pricing visibility, methodology detail, and SEO content depth before heavy traffic generation.

## Public Evidence Observed

The public index and accessible snippets showed these claims and pages:

- Homepage indexed as "Eco-Auditor - GHG Carbon Accounting for SMBs."
- Core homepage promise: Eco-Auditor gives small and mid-size businesses audit-ready GHG emissions data.
- Product workflow described publicly: upload bills, connect integrations, and generate Scope 1-3 reports aligned with the GHG Protocol.
- Contact page is indexed, but appears to use the same broad title pattern as other pages.
- Privacy page is indexed and mentions cookies, session state, and usage analytics.
- DPA page is indexed, which is good for B2B trust.
- External promotional copy mentions:
  - Plans starting at $149/month.
  - Starter at $149/month, Growth at $399/month, Pro at $999/month.
  - Fit for food and beverage, light manufacturing, and SMBs without sustainability teams.
  - Automated Scope 1, 2, and 3 tracking.
  - Contract-readiness scoring.
  - Audit-defensible reports generated in minutes.

Verification limits:

- The site blocked direct command-line fetching with a 403 response, while search results can still see indexed snippets. This should be verified with browser-based SEO tools and Google Search Console rather than treated as a confirmed crawler problem.
- The source repository was not available in the workspace, so this is a public-site MVP audit, not a code-level audit.
- I could not fully inspect rendered design, Lighthouse scores, JavaScript bundle behavior, form validation, or authenticated product flows.

## MVP Readiness Scorecard

| Area | Score | Status | Main Risk |
|---|---:|---|---|
| Positioning | 7/10 | Good direction | Strong category, but homepage should narrow the buyer and use case faster |
| Trust and compliance | 4/10 | Needs work | "Audit-ready" needs methodology, caveats, data provenance, and security proof |
| Activation | 4/10 | Needs work | Visitor needs a no-login sample flow or sample report to understand output |
| Pricing clarity | 5/10 | Needs verification | Pricing appears in external copy but is not strongly visible in search |
| SEO foundation | 4/10 | Needs work | Indexed footprint is thin for a product selling compliance confidence |
| Content marketing | 3/10 | Early | Needs carbon accounting, GHG Protocol, industry, and procurement content clusters |
| Demo credibility | 4/10 | Needs work | Product claims require visible sample reports, source trails, and calculations |
| Accessibility | 5/10 | Needs testing | File uploads, forms, tables, and dashboards need explicit accessibility QA |
| Analytics | 4/10 | Unknown | MVP needs event tracking before growth campaigns |
| Retention loop | 5/10 | Early | Needs saved reports, audit history, export workflows, and reminders |

## Priority Fixes

### P0-1: Add a Methodology Page Before Scaling Traffic

Severity: Critical  
Owner: Product + compliance + engineering  
Effort: Medium  

Problem:

The homepage claims audit-ready GHG emissions reporting aligned with the GHG Protocol. That is a strong promise, but the site needs a visible methodology explanation so buyers understand why the outputs are defensible.

Fix:

Create a public `/methodology` page linked from the hero, footer, pricing page, sample report, and report export screens.

Include:

- Scope 1, Scope 2, and Scope 3 definitions in plain language.
- Which activity data Eco-Auditor accepts: utility bills, fuel receipts, fleet logs, invoices, ERP exports, supplier files, and manual entries.
- Which emission factors are used and how versions are tracked.
- How calculations are logged.
- How source documents are connected to final numbers.
- How assumptions, estimates, and missing data are flagged.
- What "audit-ready" means: organized, traceable, reviewable documentation.
- What it does not mean: automatic third-party assurance, legal certification, or guaranteed regulatory compliance.

Acceptance criteria:

- The page is indexable.
- It has a unique title and meta description.
- It links to the Privacy Policy, DPA, and sample report.
- It includes a short compliance caveat reviewed by a qualified advisor.
- Every exported report includes a methodology/version reference.

Suggested page title:

```text
Carbon Accounting Methodology for SMBs | Eco-Auditor
```

Suggested meta description:

```text
See how Eco-Auditor calculates Scope 1, 2, and 3 emissions, tracks source records, applies emission factors, and creates audit-ready carbon reports for SMBs.
```

### P0-2: Create a No-Login Sample Report

Severity: Critical  
Owner: Product + frontend + backend  
Effort: Medium  

Problem:

The public copy promises reports, but buyers need to see what they get before they trust the product. Carbon accounting output is the product. A generic signup CTA is weaker than a visible sample report.

Fix:

Create `/sample-report` with a realistic fictional company example.

The sample report should show:

- Company profile: small food manufacturer or light manufacturing business.
- Reporting period.
- Scope 1, Scope 2, and Scope 3 totals.
- Emissions by source.
- Top reduction opportunities.
- Source document table.
- Emission factor/version table.
- Missing-data flags.
- Audit trail preview.
- Export options: PDF, CSV, Excel.
- CTA: "Create your first report."

Acceptance criteria:

- Users can view the sample report without logging in.
- The report has a clear CTA to start a free trial or upload a first bill.
- The page is indexable and internally linked.
- The example uses fictional data and says so clearly.
- The sample proves the "audit-ready" claim visually.

### P0-3: Make the Primary User Journey Obvious in 30 Seconds

Severity: Critical  
Owner: Product + frontend  
Effort: Medium  

Problem:

The homepage explains the category, but the MVP should make the workflow instantly obvious: upload data, classify emissions, generate defensible reports.

Fix:

Add a 3-step workflow directly under the hero:

1. Upload bills, invoices, fuel logs, or supplier files.
2. Eco-Auditor classifies activity data into Scope 1, 2, and 3.
3. Export audit-ready reports with source trails and methodology notes.

Add a secondary workflow for users who do not want to upload yet:

1. Open the sample company.
2. Review the report.
3. Start with your own data.

Acceptance criteria:

- A first-time visitor can understand the product without scrolling deeply.
- The hero has one primary CTA and one proof CTA.
- Recommended hero CTAs:
  - Primary: "Start free trial"
  - Secondary: "View sample report"
- The workflow appears on homepage, pricing, and demo/sample pages.

### P0-4: Surface Pricing Clearly on the Website

Severity: High  
Owner: Product  
Effort: Small  

Problem:

External public copy mentions pricing tiers, but pricing should be easy to find and compare on the site itself. For SMB buyers, hidden pricing creates friction and reduces trust.

Fix:

Create or strengthen `/pricing` with three clear plans:

| Plan | Price | Best for | Include |
|---|---:|---|---|
| Starter | $149/mo | Solo operator or small business starting carbon tracking | Basic reports, limited uploads, one user |
| Growth | $399/mo | Active SMB with recurring reporting needs | More reports, saved history, integrations, exports |
| Pro | $999/mo | Multi-facility or procurement-driven SMB | Advanced audit trail, team seats, priority support |

Add a note that final limits should match the actual product and billing setup.

Acceptance criteria:

- Pricing is linked from header, footer, homepage, sample report, and signup.
- Each plan has one primary CTA.
- The page explains report limits, seats, integrations, export formats, support level, and retention.
- There is a simple FAQ answering "Do I need a sustainability consultant?", "Can I cancel?", "Is my data private?", and "Does this replace third-party verification?"

### P0-5: Add a Trust and Security Page

Severity: High  
Owner: Product + engineering + legal  
Effort: Medium  

Problem:

The site has privacy and DPA pages indexed, which is a good start. But for this category, users also need a plain-language security page before uploading operational and financial records.

Fix:

Create `/security` and link it from upload screens, footer, pricing, DPA, privacy, and sample report.

Cover:

- Data encryption in transit and at rest.
- File storage policy.
- Data retention and deletion.
- Tenant isolation.
- Access controls.
- Team permissions.
- Subprocessors.
- Whether customer content is used for model training.
- Incident contact process.
- Backup and recovery basics.
- DPA link.

Acceptance criteria:

- The upload flow includes a short trust note near the file input.
- Privacy, DPA, Terms, Cookie Policy, and Security are all linked from the footer.
- Security page has a unique title and meta description.
- Claims are accurate to the actual infrastructure.

Suggested upload trust copy:

```text
Your bills and reports stay under your control. Eco-Auditor uses your uploaded records to calculate emissions and create reports for your account. Review our Security, Privacy, and DPA pages for details.
```

### P0-6: Tighten the "Audit-Ready" Claim

Severity: High  
Owner: Product + legal  
Effort: Small  

Problem:

"Audit-ready" is useful positioning, but it can sound like a guarantee if not clarified. That creates buyer confusion and legal risk.

Fix:

Use "audit-ready documentation" and "audit-defensible reports" with a supporting explanation:

- Traceable source records.
- Calculation methodology.
- Emission factor references.
- Assumption flags.
- Exportable evidence pack.

Avoid unsupported claims like:

- "Guaranteed compliance."
- "Certified emissions report" unless there is a real certification process.
- "Regulator-approved" unless that is true and documented.
- "Fully automated compliance" if human review is still required.

Acceptance criteria:

- Homepage, pricing, sample report, terms, and onboarding use consistent wording.
- Compliance-sensitive claims include clarifying copy.
- No page implies the product replaces legal advice, accounting advice, or third-party assurance.

### P0-7: Verify Crawler and Monitoring Access

Severity: High  
Owner: Engineering  
Effort: Small  

Problem:

Direct command-line requests returned a 403 response, while search results show pages indexed. This may be intentional bot protection, but it should be checked because it can break SEO tools, uptime monitors, preview bots, and partner crawlers.

Fix:

Verify:

- Googlebot can access indexable pages.
- Bingbot can access indexable pages.
- robots.txt returns 200 and references the sitemap.
- sitemap.xml returns 200 and lists canonical public URLs.
- OpenGraph preview bots can fetch images and metadata.
- Uptime monitoring can check the homepage without false alarms.
- Security rules block hostile traffic without blocking legitimate crawlers.

Acceptance criteria:

- Google Search Console URL Inspection passes for homepage, pricing, methodology, sample report, and industry pages.
- Bing Webmaster Tools can fetch the homepage and sitemap.
- A browser-based crawler can crawl the marketing site.
- Logged-in app routes are blocked from indexing with `noindex` or auth protection.

## SEO and Content Fixes

### P1-1: Expand the Indexed Footprint

Severity: High  
Owner: SEO + product  
Effort: Medium  

Problem:

The visible indexed footprint is too thin for a B2B SaaS product in a trust-heavy category.

Fix:

Publish these core pages:

- `/features`
- `/pricing`
- `/methodology`
- `/sample-report`
- `/security`
- `/integrations`
- `/industries/food-and-beverage`
- `/industries/light-manufacturing`
- `/use-cases/scope-3-supplier-reporting`
- `/use-cases/rfp-carbon-disclosure`
- `/use-cases/carbon-audit-readiness`
- `/resources`

Acceptance criteria:

- Each page has one unique H1.
- Each page has a unique title and meta description.
- Each page links to at least two related pages.
- Each page has a clear CTA.
- Sitemap includes all public pages.

### P1-2: Build a Carbon Accounting Content Cluster

Severity: High  
Owner: SEO + content  
Effort: Medium  

Problem:

Eco-Auditor needs educational authority. SMB buyers may not search for the brand first; they search for problems like carbon accounting, Scope 3 reporting, supplier emissions data, and GHG Protocol templates.

Fix:

Publish a practical content cluster:

1. Carbon accounting for small businesses: plain-English guide.
2. Scope 1, 2, and 3 emissions explained for SMBs.
3. GHG Protocol for small businesses.
4. Carbon accounting software for food and beverage companies.
5. Carbon accounting software for light manufacturing.
6. Scope 3 supplier data collection template.
7. RFP carbon disclosure checklist for vendors.
8. Utility bill emissions calculator guide.
9. Carbon accounting vs ESG reporting.
10. What makes a carbon report audit-ready?
11. Carbon accounting spreadsheet template: risks and limits.
12. How to prepare for a customer carbon data request.

Acceptance criteria:

- Every article links to the product, methodology, sample report, and one related resource.
- Include downloadable templates where possible.
- Avoid making jurisdiction-specific legal claims unless reviewed.
- Add FAQ schema only when the FAQ content is visible on the page.

### P1-3: Create Industry Landing Pages

Severity: High  
Owner: Product marketing  
Effort: Medium  

Problem:

External messaging says the product is built for food and beverage and light manufacturing. The website should convert that focus into buyer-specific pages.

Fix:

Create two strong industry pages:

Food and beverage page:

- Utility bills.
- Refrigeration.
- Packaging.
- Ingredient suppliers.
- Fleet/distribution.
- Customer procurement requests.
- Common Scope 3 data gaps.

Light manufacturing page:

- Electricity and gas usage.
- Material inputs.
- Waste.
- Fleet/freight.
- Multi-facility reporting.
- Customer/RFP emissions disclosure.

Acceptance criteria:

- Each page has specific examples, not generic sustainability copy.
- Each page includes a sample report screenshot or table.
- Each page has a CTA to view a relevant sample report.
- Each page internally links to methodology and pricing.

### P1-4: Make Metadata Unique

Severity: Medium  
Owner: Engineering + SEO  
Effort: Small  

Problem:

Several indexed snippets appear to use broad or repeated title patterns. Duplicate titles make search results less compelling and reduce page-level clarity.

Fix:

Use unique titles:

```text
Eco-Auditor | GHG Carbon Accounting for SMBs
Contact Eco-Auditor | Carbon Accounting Support
Privacy Policy | Eco-Auditor
Data Processing Addendum | Eco-Auditor
Pricing | Eco-Auditor Carbon Accounting Software
Methodology | Scope 1-3 Carbon Accounting for SMBs
Sample Carbon Report | Eco-Auditor
Security | Eco-Auditor
```

Acceptance criteria:

- No two indexable pages share the same title.
- Titles stay under roughly 60 characters where possible.
- Meta descriptions explain the page value and CTA.
- OpenGraph title and description match the page intent.

### P1-5: Add Structured Data

Severity: Medium  
Owner: Engineering + SEO  
Effort: Small  

Fix:

Add JSON-LD where appropriate:

- `Organization`
- `WebSite`
- `SoftwareApplication`
- `Product` or `Service`
- `Offer` for pricing tiers
- `FAQPage` for visible FAQs
- `BreadcrumbList`
- `Article` for resources

Acceptance criteria:

- Structured data validates in Rich Results Test or Schema.org validator.
- Pricing schema reflects actual publicly visible prices.
- FAQ schema is only used for FAQs visible to users.

## Conversion and Product Fixes

### P1-6: Strengthen the Hero

Severity: Medium  
Owner: Product marketing + frontend  
Effort: Small  

Problem:

The product promise is good, but the hero should state the buyer, pain, and output faster.

Suggested hero:

```text
GHG carbon accounting for SMBs that need audit-ready reports.

Upload bills, supplier files, and operational data. Eco-Auditor classifies Scope 1-3 emissions, keeps a source trail, and exports defensible reports for customers, auditors, and procurement teams.
```

Suggested CTA pair:

```text
Start free trial
View sample report
```

Trust line:

```text
Built for food and beverage, light manufacturing, and SMB teams without a dedicated sustainability department.
```

Acceptance criteria:

- Hero says who it is for.
- Hero says what the user uploads.
- Hero says what they get.
- Hero links to sample proof.

### P1-7: Add a Product Proof Section

Severity: Medium  
Owner: Product + design  
Effort: Small  

Fix:

Add a section titled "What your report includes" with 5 cards:

- Scope 1, 2, and 3 totals.
- Source document traceability.
- Emission factor references.
- Missing data and assumption flags.
- PDF, CSV, and Excel exports.

Acceptance criteria:

- Each card shows a specific artifact, not just a benefit.
- At least one screenshot or sample table is visible.
- The section links to the full sample report.

### P1-8: Add Buyer-Specific CTAs

Severity: Medium  
Owner: Product marketing  
Effort: Small  

Problem:

Different buyers need different next steps. A CFO wants cost/risk clarity. An operations manager wants upload/report workflow. A sustainability consultant wants methodology and exports.

Fix:

Use page-specific CTAs:

- Homepage: "View sample report."
- Pricing: "Start free trial."
- Methodology: "Download sample evidence pack."
- Industry pages: "See a food manufacturing sample."
- Contact: "Book a reporting readiness review."
- Privacy/Security: "Start with sample data."

Acceptance criteria:

- Every public page has one primary CTA.
- CTA destination matches page intent.
- Analytics tracks each CTA separately.

### P1-9: Improve Onboarding

Severity: High  
Owner: Product + engineering  
Effort: Medium  

Fix:

First-run onboarding should ask:

1. Company industry.
2. Number of facilities.
3. Reporting goal: customer request, audit prep, internal tracking, RFP, regulatory readiness.
4. Data available today: utility bills, fuel, fleet, supplier spend, invoices, ERP.
5. Reporting period.

Then direct the user to the smallest successful first action:

- Upload one utility bill.
- Import a sample file.
- Generate a starter Scope 2 report.

Acceptance criteria:

- New users reach a first report preview in under 10 minutes.
- Users can use sample data if they are not ready to upload.
- Progress state is saved.
- Empty states tell users exactly what to add next.

## Technical SEO Checklist

### Crawl and Indexing

- Confirm robots.txt returns 200.
- Confirm sitemap.xml returns 200.
- Add sitemap reference inside robots.txt.
- Submit sitemap to Google Search Console and Bing Webmaster Tools.
- Ensure only public marketing/resource pages are indexable.
- Add `noindex` to login, app, dashboard, billing, and account pages.
- Add canonical tags to every indexable page.
- Ensure HTTP redirects to HTTPS.
- Choose one canonical host: either `ecoauditor.io` or `www.ecoauditor.io`.

### Metadata

- Unique title per page.
- Unique meta description per page.
- OpenGraph title, description, image, and URL.
- Twitter/X card metadata.
- Favicon and Apple touch icon.
- 1200x630 social sharing image.

### Performance

- Run Lighthouse on mobile and desktop.
- Target Core Web Vitals:
  - LCP under 2.5 seconds.
  - INP under 200 ms.
  - CLS under 0.1.
- Compress images.
- Lazy-load non-critical media.
- Preload hero image only if used.
- Avoid heavy dashboard scripts on marketing pages.

### Accessibility

- Every form field has a label.
- File upload supports keyboard and screen readers.
- Error messages are announced and visible.
- Color contrast passes WCAG AA.
- Pricing cards are readable by screen readers.
- Tables have headers and captions.
- Focus states are visible.
- Modals trap focus and close with Escape.
- Charts have text summaries.

### Analytics

Track these MVP events:

- Homepage CTA click.
- Sample report view.
- Pricing view.
- Trial start.
- Signup complete.
- Onboarding complete.
- First file upload.
- First report generated.
- First export.
- Integration connected.
- Contact form submitted.
- Plan selected.
- Checkout started.
- Checkout completed.

Dashboard metrics:

- Visitor to sample report rate.
- Sample report to signup rate.
- Signup to first upload rate.
- First upload to report generated rate.
- Report generated to export rate.
- Trial to paid conversion.
- Churn by plan.
- Most common missing data flags.

## Legal and Compliance Messaging Fixes

### P1-10: Add Compliance Disclaimers Without Weakening the Product

Severity: High  
Owner: Legal + product  
Effort: Small  

Fix:

Add plain disclaimers:

```text
Eco-Auditor helps organize emissions data, calculations, source records, and reports for review. It does not replace legal advice, accounting advice, or third-party assurance where required.
```

Use on:

- Methodology page.
- Sample report.
- Signup terms area.
- Exported reports.
- Help center.

Acceptance criteria:

- Claims are clear but not fear-based.
- Disclaimers are visible near compliance claims.
- Terms match marketing copy.

### P1-11: Add Subprocessor and Retention Details

Severity: Medium  
Owner: Legal + engineering  
Effort: Small  

Fix:

Add:

- Subprocessor list.
- Data retention policy.
- Deletion process.
- Export process.
- Contact for DPA/security requests.
- AI/model processing statement if applicable.

Acceptance criteria:

- DPA and Privacy Policy cross-link.
- Security page cross-links to DPA.
- Upload flow links to data handling details.

## UX and Interface Fixes

### P2-1: Improve Empty States

Severity: Medium  
Owner: Product + frontend  
Effort: Small  

Fix:

For dashboards and report areas, avoid blank states. Use guided empty states:

- "Upload your first utility bill."
- "Connect accounting or ERP data."
- "Try the sample company."
- "Download a supplier data template."

Acceptance criteria:

- Every major dashboard module has an empty state.
- Each empty state has one clear action.
- Sample data is available.

### P2-2: Add Evidence Pack Export

Severity: Medium  
Owner: Product + backend  
Effort: Medium  

Fix:

In addition to report exports, add an "evidence pack" export:

- Report PDF.
- Source records index.
- Calculation CSV.
- Emission factor references.
- Assumptions and missing-data log.
- Change history.

Acceptance criteria:

- Export is available on paid plans or sample report.
- Exported files have clear naming.
- Audit trail includes timestamps and user/action where appropriate.

### P2-3: Add In-App Review States

Severity: Medium  
Owner: Product + frontend  
Effort: Medium  

Fix:

Reports should have statuses:

- Draft.
- Needs data.
- Ready for review.
- Reviewed.
- Exported.

Acceptance criteria:

- Users know what is missing before exporting.
- Reports with estimates are clearly marked.
- Users can filter reports by status.

## Recommended Public Site Architecture

```text
/
/features
/pricing
/sample-report
/methodology
/security
/integrations
/contact
/privacy
/terms
/dpa
/cookie-policy
/industries/food-and-beverage
/industries/light-manufacturing
/use-cases/carbon-audit-readiness
/use-cases/rfp-carbon-disclosure
/use-cases/scope-3-supplier-reporting
/resources
/resources/carbon-accounting-for-small-business
/resources/scope-1-2-3-emissions-explained
/resources/ghg-protocol-for-small-business
/resources/scope-3-supplier-data-template
```

## 30-Day MVP Fix Roadmap

### Week 1: Trust and Conversion Foundation

- Add methodology page.
- Add security page.
- Add sample report page.
- Add or strengthen pricing page.
- Add compliance caveat language.
- Verify robots.txt, sitemap, canonical host, and Search Console.

### Week 2: Homepage and Onboarding

- Rewrite hero with sharper ICP and workflow.
- Add "what your report includes" proof section.
- Add sample report CTA sitewide.
- Add first-run onboarding questions.
- Add sample company data.
- Add key analytics events.

### Week 3: SEO Expansion

- Publish food and beverage industry page.
- Publish light manufacturing industry page.
- Publish Scope 1-3 guide.
- Publish GHG Protocol for SMBs guide.
- Publish RFP carbon disclosure checklist.
- Add internal links across all pages.

### Week 4: Product Proof and Retention

- Add evidence pack export.
- Add report statuses.
- Add missing-data flags.
- Add emission factor/version notes to reports.
- Add user-facing report history.
- Review trial-to-paid funnel data.

## Launch Readiness Checklist

Before paid ads, cold outreach, or broad launch, confirm:

- Homepage explains buyer, pain, workflow, and output in 30 seconds.
- Pricing is public and clear.
- Sample report is visible without login.
- Methodology page explains calculations and assumptions.
- Security page explains data handling.
- Privacy, Terms, DPA, and Cookie Policy are linked.
- Sitemap and robots.txt are valid.
- Search Console has no indexing errors for core pages.
- No private app routes are indexed.
- Trial flow works on mobile and desktop.
- First report can be generated from sample data.
- Analytics tracks the full funnel.
- Contact form is tested.
- All compliance claims are reviewed.

## Highest-Impact Fix Order

1. Publish the methodology page.
2. Publish the sample report page.
3. Make pricing visible and concrete.
4. Add security/data-handling trust copy.
5. Rewrite homepage hero and workflow.
6. Verify crawler access, sitemap, robots, and canonical host.
7. Build industry landing pages.
8. Add content cluster articles.
9. Add analytics events across the funnel.
10. Add evidence pack exports and report statuses.

## Final Recommendation

Eco-Auditor should not try to win by sounding like a generic ESG platform. The strongest angle is much sharper:

```text
Carbon accounting for SMBs that need defensible Scope 1-3 reports before customers, auditors, or procurement teams ask.
```

Make the site prove three things immediately:

1. The product can turn messy SMB records into organized emissions reports.
2. The calculations are traceable and methodology-backed.
3. The buyer can start small, see value quickly, and avoid a compliance scramble.

Once those three points are visible through the homepage, sample report, methodology page, and pricing page, the MVP will be much more credible for outreach, SEO, and paid traffic.
