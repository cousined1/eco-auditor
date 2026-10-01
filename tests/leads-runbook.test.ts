// docs/runbooks/leads.md tells the owner how to read the leads table and why a lead can
// be stored and never announced. It quotes numbers and log lines from the code, and
// it offers SQL to run against production, so it is held to both: a limit that
// changes in the code must change on the page, and nothing on it may write.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(path), 'utf8');
const runbook = read('docs/runbooks/leads.md');
const notify = read('server-notify.cjs');
const server = read('server.cjs');
// A sentence of the runbook with its line breaks undone.
const flat = runbook.replace(/\s+/g, ' ');

describe('docs/runbooks/leads.md matches the code it describes', () => {
  it('states the notifier cap and window the notifier uses', () => {
    const max = Number(/const DEFAULT_MAX_PER_WINDOW = (\d+);/.exec(notify)?.[1]);
    const windowMs = Number(/const DEFAULT_WINDOW_MS = (\d+) \* 60 \* 1000;/.exec(notify)?.[1]) * 60 * 1000;
    expect(max).toBeGreaterThan(0);
    expect(flat).toContain(`at most **${max} messages per ${windowMs / 60000}-minute window**`);
  });

  it('states the per-address limit on /api/leads, and that the cap can be spent by few addresses', () => {
    const match = /const leadsRateLimit = perRouteRateLimit\((\d+), (\d+) \* 60 \* 1000\);/.exec(server);
    const perAddress = Number(match?.[1]);
    const minutes = Number(match?.[2]);
    const cap = Number(/const DEFAULT_MAX_PER_WINDOW = (\d+);/.exec(notify)?.[1]);
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
    const few = Math.ceil(cap / perAddress);
    expect(flat).toContain(`allows ${perAddress} submissions per address per ${minutes} minutes`);
    expect(flat).toContain(`${words[few] ?? few} addresses are enough to use the whole budget`);
  });

  it('quotes log lines the server really writes', () => {
    const quoted = [
      'Lead notifications throttled; leads are still stored in public.leads',
      'Lead notification rejected by the webhook',
      'Lead notification failed',
      'LEAD_NOTIFY_WEBHOOK_URL is not set: new leads are stored in public.leads but nobody is notified',
      'LEAD_NOTIFY_WEBHOOK_URL is not usable, lead notifications are disabled (it must be an https URL)',
    ];
    for (const line of quoted) {
      expect(notify, `server-notify.cjs does not log: ${line}`).toContain(line);
      expect(flat, `the runbook does not quote: ${line}`).toContain(line);
    }
    expect(notify).toContain('the webhook answered with a redirect');
    expect(flat).toContain('the webhook answered with a redirect');
  });

  it('says plain http is refused in production, as the notifier does', () => {
    expect(flat).toContain('only when `NODE_ENV` is not production');
    expect(notify).toMatch(/isProduction\(env\)/);
  });

  it('keeps the webhook variable switched off until the recipient is disclosed, as credential-rotation.md does', () => {
    expect(flat).toContain('Do not set the variable yet');
    expect(read('docs/runbooks/credential-rotation.md').replace(/\s+/g, ' ')).toContain('Do not set it at all until the Privacy Policy and the DPA list the team-messaging workspace');
  });

  // The page used to say a failed write answered 500 and, with no database or outside
  // production, went to .data/leads.json. writeLead rethrows in every environment,
  // /api/leads answers through failureStatus (503 for a data-store failure), and the
  // server holds no file store (tests/data-layer-outage.test.ts pins that).
  it('says a failed lead write answers 503 and that nothing falls back to a file, as writeLead does', () => {
    expect(server).toMatch(/Failed to write lead to Postgres[\s\S]{0,80}throw err;/);
    expect(server).toMatch(/Lead capture failed[\s\S]{0,100}res\.status\(failureStatus\(err\)\)/);
    expect(flat).toContain('answers 503');
    expect(runbook).not.toMatch(/\.data\b|leads\.json/);
  });
});

describe('the SQL on the page only reads', () => {
  const blocks = [...runbook.matchAll(/```sql\n([\s\S]*?)```/g)].map((match) => match[1] ?? '');
  const statements = blocks
    .flatMap((block) => block.split(';'))
    .map((statement) =>
      statement
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);

  it('has queries to run', () => {
    expect(statements.length).toBeGreaterThanOrEqual(5);
  });

  it.each(statements.map((statement) => [statement.split('\n')[0] ?? '', statement] as const))('is a SELECT, and nothing else: %s', (_first, statement) => {
    expect(statement).toMatch(/^SELECT\b/);
    expect(statement).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|GRANT|REVOKE|CREATE|COPY|VACUUM)\b/i);
  });

  it('only ever reads public.leads', () => {
    for (const statement of statements) expect(statement).toMatch(/FROM public\.leads\b/);
  });
});
