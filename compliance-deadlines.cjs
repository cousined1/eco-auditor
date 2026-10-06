// Single source of truth for regulatory reporting deadlines.
//
// This table used to be duplicated in three places that disagreed:
//   - server.cjs /api/compliance/deadlines  (SB 253 "2026-01-01")
//   - emissions-engine.cjs getComplianceStatus ("2026-01-01 Scope 1 and 2")
//   - src/pages/MethodologyPublic.tsx (public copy: "August 10, 2026")
// On 2026-10-05 that produced a serious customer-facing error: the API
// reported SB 253 as "overdue" since 2026-01-01 while the real deadline was
// still ahead. A compliance product that tells a customer they are nine
// months late when they have five weeks left destroys the trust the product
// is sold on.
//
// SB 253 first-year Scope 1 and Scope 2 reporting:
//   - CARB's initial regulation set 2026-08-10.
//   - CARB's Modified Regulations (2026-08, comments due 2026-08-11) defer
//     that date by three months to 2026-11-10.
//   - The deferral is PROPOSED: it still depends on the comment period and
//     OAL approval, so the effective date is carried as a scheduled date with
//     an explicit status rather than being presented as settled law.
//   - Scope 3 reporting begins in 2027.
//
// EU CSRD phase-in. Verified against the primary text on 2026-10-05:
//   - Wave 1 (large public-interest entities, >500 employees): 2025 for FY2024.
//     Unaffected by the postponement.
//   - Wave 2 (other large undertakings): ORIGINALLY 2026 for FY2025. Directive
//     (EU) 2025/794 ("Stop-the-Clock", OJ L 2025/794 of 16.4.2025, in force
//     17 April 2025) postponed that by two years, so Wave 2 now reports in 2028
//     for FY2027. Transposition deadline 31 December 2025.
//     https://eur-lex.europa.eu/eli/dir/2025/794/oj/eng
//     This table carried the superseded 2026-12-31 date, so EU customers were
//     told they owed a sustainability statement on a date that stopped being
//     legally correct eighteen months ago. Same class as the SB 253 drift fixed
//     in this file's header comment: a hardcoded date outliving the regulation.
//   - NOT modelled here: the Content Directive (EU) 2026/4701 reportedly entered
//     into force 18 March 2026 and raises the mandatory scope to >1,000 employees
//     AND >EUR450m turnover, transposition due 19 March 2027. That is recorded as
//     an open finding rather than encoded here — see reports/audit-20261005-
//     workflow.json (COMP-04) — because transposition is national and
//     Member States have exemptions, so the operative scope for any given
//     Member State cannot be resolved from the Directive text alone.

const DEADLINES = [
  {
    id: 'sb253_scope12',
    framework: 'SB 253',
    scope: 'Scope 1 and Scope 2',
    due_date: '2026-11-10',
    // 'proposed' — announced in CARB's Modified Regulations but not yet final.
    date_status: 'proposed',
    previously_scheduled: '2026-08-10',
    note:
      'CARB deferred the first-year Scope 1 and Scope 2 deadline from August 10 to November 10, 2026. ' +
      'The deferral is proposed and still subject to the comment period and OAL approval.',
    applies_to: 'U.S. entities doing business in California with over $1B in annual revenue.',
    // Machine-readable form of applies_to, so applicability is never restated in
    // code where it can drift from this row again.
    applies: { regions: ['CA', 'CALIFORNIA'], min_revenue: 1_000_000_000 },
  },
  {
    id: 'sb253_scope3',
    framework: 'SB 253',
    scope: 'Scope 3',
    due_date: '2027-06-30',
    date_status: 'scheduled',
    note: 'Scope 3 reporting begins in 2027, covering the prior fiscal year.',
    applies_to: 'U.S. entities doing business in California with over $1B in annual revenue.',
    applies: { regions: ['CA', 'CALIFORNIA'], min_revenue: 1_000_000_000 },
  },
  {
    id: 'csrd_wave1',
    framework: 'EU CSRD',
    scope: 'Sustainability statement (wave 1)',
    due_date: '2025-12-31',
    date_status: 'in_force',
    note: 'Wave 1 — large public-interest entities with more than 500 employees. First report published in 2025 for FY2024. Not affected by the postponement.',
    applies_to: 'EU entities with more than 500 employees (wave 1).',
    applies: { regions: ['EU', 'EUROPE'], min_employees: 501 },
  },
  {
    id: 'csrd_wave2',
    framework: 'EU CSRD',
    scope: 'Sustainability statement (wave 2)',
    due_date: '2028-12-31',
    date_status: 'in_force',
    previously_scheduled: '2026-12-31',
    note:
      'Wave 2 — other large undertakings. Originally 2026 for FY2025; Directive (EU) 2025/794 postponed ' +
      'this by two years, so the first report is now due in 2028 for FY2027.',
    applies_to: 'EU large undertakings that are not public-interest entities and meet at least two of: more than 250 employees, EUR50m net turnover, EUR25m total assets (wave 2).',
    // Wave 2 is a 2-of-3 size test, not a headcount-only test. The employee leg
    // is modelled on its own; the turnover and asset legs are not, because the
    // company profile does not carry them (see the 501 in server.cjs). Modelled
    // as "more than 250 employees", which is the leg we can actually evaluate —
    // an entity below it is not in wave 2 on any of the three legs.
    applies: { regions: ['EU', 'EUROPE'], min_employees: 251 },
  },
];

/**
 * Whether a deadline row's `applies` criteria are met by a company.
 *
 * This exists so getComplianceStatus() never restates a threshold. It used to
 * hardcode `employees >= 500` for CSRD, while this table's own wave 2 row said
 * "250+ employees" — so every EU company between 251 and 500 employees was
 * reported `not_applicable` with a null deadline, even though the product's own
 * table listed them as in scope. Two readers of one table, disagreeing again.
 *
 * Returns null when the row carries no `applies` block (treated as "cannot
 * determine" rather than "applies to everyone").
 *
 * @param {{applies?: object}} deadline
 * @param {{revenue?: number|string, employees?: number|string, region?: string, state?: string}} company
 */
function deadlineAppliesTo(deadline, company = {}) {
  const rules = deadline && deadline.applies;
  if (!rules) return null;

  const region = String(company.region || company.state || '').trim().toUpperCase();
  if (Array.isArray(rules.regions) && rules.regions.length > 0) {
    const ok = rules.regions.some((r) => String(r).toUpperCase() === region);
    if (!ok) return false;
  }
  if (rules.min_revenue != null && !(Number(company.revenue) >= rules.min_revenue)) return false;
  if (rules.min_employees != null && !(Number(company.employees) >= rules.min_employees)) return false;
  if (rules.max_employees != null && !(Number(company.employees) <= rules.max_employees)) return false;
  return true;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Compare in UTC. Deadlines are regulatory calendar dates, not instants, and
// the server may run west of UTC — bucketing them with local accessors shifted
// "due today" by a day for part of the day (same class of bug as the
// emissions trend fix in emissions-engine.cjs).
function endOfUtcDay(dateStr) {
  return Date.parse(`${dateStr}T23:59:59.999Z`);
}

/** Whole days until a deadline; negative once it has passed. */
function daysUntil(dueDate, now) {
  const target = endOfUtcDay(dueDate);
  if (Number.isNaN(target)) return null;
  // floor, not ceil: at 00:00:00 on the deadline day the remaining time is
  // 0.99999 days, and ceil reported "1 day left" for a deadline due today.
  return Math.floor((target - now) / DAY_MS);
}

/**
 * Status relative to today. Past dates are 'overdue' rather than 'upcoming'
 * (the original bug: a 2025 CSRD date reported as upcoming in 2026).
 */
function statusFor(dueDate, now) {
  const left = daysUntil(dueDate, now);
  if (left === null) return 'unknown';
  if (left < 0) return 'overdue';
  if (left <= 90) return 'due_soon';
  return 'upcoming';
}

/** The next deadline a company still has ahead of it, as a display label. */
function nextDeadlineLabel(now) {
  const ahead = DEADLINES.filter((d) => daysUntil(d.due_date, now) >= 0)
    .sort((a, b) => Date.parse(a.due_date) - Date.parse(b.due_date))[0];
  if (!ahead) return null;
  const status = statusFor(ahead.due_date, now);
  const prefix = status === 'overdue' ? 'Overdue since' : 'Due';
  return `${prefix} ${ahead.due_date} — ${ahead.framework} ${ahead.scope}`;
}

function allDeadlines(now) {
  const at = now ?? Date.now();
  return DEADLINES.map((d) => ({
    id: d.id,
    framework: d.framework,
    scope: d.scope,
    due_date: d.due_date,
    date_status: d.date_status,
    previously_scheduled: d.previously_scheduled || null,
    days_left: daysUntil(d.due_date, at),
    status: statusFor(d.due_date, at),
    note: d.note,
    applies_to: d.applies_to,
  }));
}

function deadlinesForFramework(framework, now) {
  const at = now ?? Date.now();
  return allDeadlines(at).filter((d) => d.framework === framework);
}

/**
 * The deadlines that actually apply to a company, earliest first.
 *
 * @param {{revenue?: number, employees?: number, region?: string, state?: string}} company
 * @param {number} [now]
 */
function deadlinesApplicableTo(company, now) {
  const at = now ?? Date.now();
  return allDeadlines(at)
    .filter((d) => deadlineAppliesTo(DEADLINES.find((r) => r.id === d.id), company) === true)
    .sort((a, b) => Date.parse(a.due_date) - Date.parse(b.due_date));
}

module.exports = {
  DEADLINES,
  allDeadlines,
  deadlinesForFramework,
  deadlinesApplicableTo,
  deadlineAppliesTo,
  daysUntil,
  nextDeadlineLabel,
  statusFor,
};