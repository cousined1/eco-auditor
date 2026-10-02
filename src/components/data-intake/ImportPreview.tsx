import type { CheckResult, CommitResult, OnDuplicate } from '@/lib/csvImport';
import { formatTonnesCO2e, pluralize } from '@/lib/format';

/** One selected file, from the check (dry run) to the import. */
export interface FileItem {
  id: string;
  name: string;
  phase: 'checking' | 'checked' | 'importing' | 'imported' | 'skipped' | 'failed' | 'gated';
  /** The decoded text, sent unchanged to the check and to the import. */
  text?: string;
  encodingNote?: string | null;
  /** One Idempotency-Key per file: trying a timed-out import again reuses it. */
  key: string;
  check?: CheckResult;
  commit?: CommitResult;
  /** failed: what happened, and which step Try again repeats. */
  message?: string | undefined;
  errors?: string[] | undefined;
  retry?: 'check' | 'commit' | undefined;
  onDuplicate?: OnDuplicate | undefined;
}

interface Props {
  item: FileItem;
  onImport: (item: FileItem, onDuplicate?: OnDuplicate) => void;
  onRetry: (item: FileItem) => void;
  onDiscard: (item: FileItem) => void;
}

function headline(item: FileItem): string {
  const check = item.check;
  switch (item.phase) {
    case 'checking':
      return 'checking…';
    case 'skipped':
    case 'failed':
      return `${item.phase}: ${item.message ?? ''}`;
    case 'gated':
      return 'blocked by your plan — see the notice below';
    case 'importing':
      return 'importing…';
    case 'imported':
      return item.commit?.replayed ? `already imported: ${pluralize(item.commit.imported, 'row')}` : `imported ${pluralize(item.commit?.imported ?? 0, 'row')}`;
    default:
      if (!check) return '';
      if (check.error_count > 0) return `${pluralize(check.error_count, 'error')}: nothing was imported`;
      if (check.duplicate_of) return 'this file was imported before';
      return `ready to import ${pluralize(check.valid_rows, 'row')}`;
  }
}

/** " (Scope 1 5.3 tCO2e, Scope 2 2.0 tCO2e)": the scopes the file adds to. */
function byScope(tonnes: CheckResult['tonnes']): string {
  const parts = ([['Scope 1', tonnes.scope1], ['Scope 2', tonnes.scope2], ['Scope 3', tonnes.scope3]] as const)
    .filter(([, value]) => value > 0)
    .map(([scope, value]) => `${scope} ${formatTonnesCO2e(value)}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

/** What the Dashboard reports beside the scopes (its "Reported separately" lines), one sentence each. */
function besideScopes(tonnes: CheckResult['tonnes']): string {
  const lines: string[] = [];
  if (tonnes.non_kyoto) lines.push(` Plus ${formatTonnesCO2e(tonnes.non_kyoto)} of R-22 and other non-Kyoto refrigerants, not in Scope 1.`);
  if (tonnes.biogenic_co2) lines.push(` Plus ${formatTonnesCO2e(tonnes.biogenic_co2).replace('CO2e', 'CO2')} of biogenic CO2 from burning biomass, outside the scopes.`);
  return lines.join('');
}

function dotClass(item: FileItem): string {
  if (item.phase === 'imported') return 'bg-risk-low';
  if (item.phase === 'skipped' || (item.phase === 'checked' && item.check?.error_count === 0)) return 'bg-risk-medium';
  if (item.phase === 'checking' || item.phase === 'importing') return 'bg-surface-400';
  return 'bg-risk-high';
}

// The warning and error colours are the remapped ones in src/index.css (F-C-15).
const TONES = {
  error: { text: 'text-red-600 dark:text-red-400', border: 'border-red-400' },
  warning: { text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-400' },
  note: { text: 'text-surface-600 dark:text-surface-400', border: 'border-surface-300' },
};

function List({ title, lines, tone }: { title: string; lines: string[]; tone: keyof typeof TONES }) {
  if (lines.length === 0) return null;
  const { text, border } = TONES[tone];
  return (
    <div className="mt-2">
      <p className={`text-xs font-medium ${text}`}>{title}</p>
      <ul className="space-y-0.5">
        {lines.map((line, i) => (
          <li key={i} className={`border-l-2 pl-3 text-xs ${text} ${border}`}>
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What the check found in one file and what importing it would do, with the
 * import itself as an explicit step. Nothing is stored before the user chooses
 * to import, and nothing at all while the file has errors.
 */
export default function ImportPreview({ item, onImport, onRetry, onDiscard }: Props) {
  const check = item.check;
  const busy = item.phase === 'checking' || item.phase === 'importing';
  const tonnes = check?.tonnes;

  return (
    <li className="flex items-start gap-2 text-sm">
      <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass(item)}`} />
      <div className="min-w-0 flex-1">
        <h3 className="text-sm">
          <span className="break-all font-medium text-surface-800 dark:text-surface-200">{item.name}</span>
          <span className="font-normal text-surface-500"> — {headline(item)}</span>
        </h3>

        {check && item.phase !== 'imported' && (
          <>
            <p className="mt-1 text-xs text-surface-600 dark:text-surface-400">
              {check.valid_rows} of {pluralize(check.total_rows, 'row')} valid
              {tonnes && check.valid_rows > 0 ? `: ${formatTonnesCO2e(tonnes.total)}${byScope(tonnes)}` : ''}.
              {tonnes && check.valid_rows > 0 ? besideScopes(tonnes) : ''}
            </p>
            {(check.error_count > 0 || check.warnings.length > 0) && (
              <div className="mt-1 flex items-center gap-2">
                {check.error_count > 0 && <span className="badge-amber">{pluralize(check.error_count, 'error')}</span>}
                {check.warnings.length > 0 && <span className="badge-amber">{pluralize(check.warnings.length, 'warning')}</span>}
              </div>
            )}
          </>
        )}
        {item.encodingNote && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{item.encodingNote}</p>}

        {check && item.phase !== 'imported' && (
          <>
            <List title="Errors" tone="error" lines={check.errors} />
            {check.error_count > 0 && (
              <p className="mt-1 text-xs text-surface-600 dark:text-surface-400">
                Nothing from this file was imported. Fix these rows and upload the file again: each row is counted once.
              </p>
            )}
            <List title="Warnings: review them before you import" tone="warning" lines={check.warnings} />
            <List title="Unit conversions" tone="note" lines={check.conversions} />
          </>
        )}
        {item.errors && <List title="Errors" tone="error" lines={item.errors} />}

        {item.phase === 'imported' && item.commit && (
          <>
            <p className="mt-1 text-xs text-surface-600 dark:text-surface-400">
              {item.commit.replaced_imports.length > 0 ? 'It replaced the earlier import of this file. ' : ''}
              It is listed under Uploaded Files, where it can be undone.
            </p>
            <List title="Warnings" tone="warning" lines={item.commit.warnings} />
            <List title="Unit conversions" tone="note" lines={item.commit.conversions} />
          </>
        )}

        {!busy && item.phase !== 'imported' && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {item.phase === 'checked' && check?.can_commit && !check.duplicate_of && (
              <button type="button" onClick={() => onImport(item)} className="btn-primary text-xs">
                Import {pluralize(check.valid_rows, 'row')}
              </button>
            )}
            {item.phase === 'checked' && check?.can_commit && check.duplicate_of && (
              <>
                <button type="button" onClick={() => onImport(item, 'replace')} className="btn-primary text-xs">
                  Replace the earlier import
                </button>
                <button type="button" onClick={() => onImport(item, 'import_anyway')} className="btn-secondary text-xs">
                  Import anyway
                </button>
              </>
            )}
            {item.phase === 'failed' && item.retry && (
              <button type="button" onClick={() => onRetry(item)} className="btn-primary text-xs">
                Try again
              </button>
            )}
            {item.phase !== 'skipped' && item.phase !== 'gated' && (
              <button type="button" onClick={() => onDiscard(item)} className="btn-secondary text-xs">
                Discard
              </button>
            )}
            {item.phase === 'checked' && check?.can_commit && check.imports_left !== null && (
              <span className="text-2xs text-surface-500">
                Importing uses 1 of the {pluralize(check.imports_left, 'import')} left this month.
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
