// F-A-05 — the ONE place regulatory dates and statuses live for the marketing
// site. A regulatory sentence typed anywhere else goes stale without anyone
// noticing: the Methodology page kept the superseded August deadline for three
// months after CARB moved it, and a chatbot line still says the SEC rule "was
// withdrawn".
//
// Every fact carries `as_of` (the day its status was read from the primary
// source), `source_url` and a `status`. Copy that quotes a fact must show the
// as_of date, and must say "awaiting approval" while the status is
// 'pending-approval'. `review_due` is enforced by tests/regulatory.test.ts: the
// suite goes red once it passes, which is the prompt to re-read the sources.
//
// Statuses were read from primary sources on 2026-09-29 (audit review R5).
//
// NOT consumed by the server: server.cjs (the chatbot KB and
// /api/compliance/deadlines) keeps its own strings, and its owner has to bring
// them in line with this file. The one exception is CBAM_PRODUCT_STATEMENT below:
// the chatbot's CBAM answer carries that sentence word for word, and
// tests/chat-kb.test.ts fails when the two stop agreeing (D-8).

export type RegulatoryStatus = 'pending-approval' | 'enjoined' | 'stayed' | 'in-effect';

export type RegulatoryFact = {
  id: 'sb253' | 'sb261' | 'sec-climate' | 'eu-cbam';
  framework: string;
  status: RegulatoryStatus;
  as_of: string;
  review_due: string;
  source_url: string;
  /** Plain-language statement. Already carries its own "as of" date. */
  statement: string;
};

export const REGULATORY_AS_OF = '2026-09-29';

// D-8 — what the product does and does not do for CBAM, said once. The Methodology page renders it and
// the chatbot's CBAM answer (server.cjs ECOAUDITOR_KB, id 'cbam') contains it verbatim; before, the page
// said "can support ... CBAM-related workflows" and the bot said "not a CBAM tool" in unrelated words.
// It is product scope, not a dated regulatory fact, so it carries no as_of and is not in REGULATORY.
export const CBAM_PRODUCT_STATEMENT =
  'Eco-Auditor is not a CBAM tool: it does not calculate CBAM embedded emissions or produce CBAM reports.';

export const REGULATORY: Record<RegulatoryFact['id'], RegulatoryFact> = {
  sb253: {
    id: 'sb253',
    framework: 'California SB 253 (Climate Corporate Data Accountability Act)',
    // CARB adopted the November 10 date (EO R-26-006) and resubmitted the package to
    // OAL on 2026-09-21; OAL has not acted. In law it is still a PROPOSAL. The
    // earlier August date was withdrawn and never took effect.
    status: 'pending-approval',
    as_of: REGULATORY_AS_OF,
    review_due: '2026-10-31',
    source_url:
      'https://ww2.arb.ca.gov/rulemaking/2025/california-corporate-greenhouse-gas-reporting-and-climate-related-financial-risk',
    statement:
      "SB 253 applies to companies with total annual revenue above $1 billion that do business in California. CARB's regulation sets November 10, 2026 as the first Scope 1 and Scope 2 reporting deadline. It was resubmitted to California's Office of Administrative Law on September 21, 2026 and is awaiting approval (as of September 29, 2026). Scope 3 reporting is not required for 2026.",
  },
  sb261: {
    id: 'sb261',
    framework: 'California SB 261 (climate-related financial risk reports)',
    status: 'enjoined',
    as_of: REGULATORY_AS_OF,
    review_due: '2026-10-31',
    source_url: 'https://ww2.arb.ca.gov/sites/default/files/2025-12/Dec%201%20SB%20261%20Enforcement%20Advisory.pdf',
    statement:
      'SB 261 climate-risk reporting is on hold under a court injunction; CARB has said it will not enforce the January 1, 2026 deadline while the appeal is pending (as of September 29, 2026).',
  },
  'sec-climate': {
    id: 'sec-climate',
    framework: 'SEC climate-related disclosure rules',
    status: 'stayed',
    as_of: REGULATORY_AS_OF,
    review_due: '2026-10-31',
    source_url: 'https://www.sec.gov/newsroom/press-releases/2026-49-sec-proposes-rescission-climate-related-disclosure-rules',
    statement:
      "The SEC's climate-disclosure rules are stayed and have never taken effect. The SEC proposed rescinding them in May 2026 and has not issued a final rule (as of September 29, 2026).",
  },
  'eu-cbam': {
    id: 'eu-cbam',
    framework: 'EU Carbon Border Adjustment Mechanism (CBAM)',
    status: 'in-effect',
    as_of: REGULATORY_AS_OF,
    review_due: '2026-10-31',
    source_url: 'https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en',
    statement:
      'CBAM obligations sit with EU importers; suppliers outside the EU may be asked for installation-level emissions data. The first annual CBAM declaration is due September 30, 2027 (as of September 29, 2026).',
  },
};
