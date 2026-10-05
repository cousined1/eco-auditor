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
// EU CSRD phase-in: first sustainability statements cover FY2024 and were
// due in 2025; larger wave-2 entities report from FY2026.

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
  },
  {
    id: 'sb253_scope3',
    framework: 'SB 253',
    scope: 'Scope 3',
    due_date: '2027-06-30',
    date_status: 'scheduled',
    note: 'Scope 3 reporting begins in 2027, covering the prior fiscal year.',
    applies_to: 'U.S. entities doing business in California with over $1B in annual revenue.',
  },
  {
    id: 'csrd_wave1',
    framework: 'EU CSRD',
    scope: 'Sustainability statement',
    due_date: '2025-12-31',
    date_status: 'in_force',
    note: 'First wave of companies already reported for FY2024.',
    applies_to: 'EU entities with 500+ employees (wave 1).',
  },
  {
    id: 'csrd_wave2',
    framework: 'EU CSRD',
    scope: 'Sustainability statement',
    due_date: '2026-12-31',
    date_status: 'in_force',
    note: 'Wave 2 companies report for FY2025.',
    applies_to: 'EU entities with 250+ employees (wave 2).',
  },
];

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

module.exports = {
  DEADLINES,
  allDeadlines,
  deadlinesForFramework,
  daysUntil,
  nextDeadlineLabel,
  statusFor,
};