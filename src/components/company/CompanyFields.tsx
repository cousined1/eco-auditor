import {
  BASE_YEAR_HINT,
  BASE_YEAR_MIN,
  COMPANY_NAME_MAX,
  CONSOLIDATION_HINT,
  CONSOLIDATION_OPTIONS,
  INDUSTRIES,
  type ConsolidationApproach,
} from '@/lib/company';

export const LABEL_CLASS = 'block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1';
export const FIELD_CLASS =
  'w-full border border-surface-300 dark:border-surface-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 disabled:opacity-50';
const HINT_CLASS = 'text-xs text-surface-600 dark:text-surface-400 mt-1';
const ERROR_CLASS = 'text-xs text-risk-high mt-1';

export interface CompanyFieldValues {
  name: string;
  industry: string;
  approach: ConsolidationApproach;
  /** The base year as typed: empty, or four digits. */
  baseYear: string;
}

export interface CompanyFieldErrors {
  name?: string;
  baseYear?: string;
}

interface Props {
  /** Prefix for the field ids, so two forms on one page never share one. */
  idPrefix: string;
  values: CompanyFieldValues;
  onChange: (next: CompanyFieldValues) => void;
  errors?: CompanyFieldErrors;
  disabled?: boolean;
}

/**
 * The company's own fields, shared by the first-run onboarding and Settings >
 * Company: name, industry, and the reporting basis (consolidation approach and base
 * year, each with a sentence saying what it is and what a report prints until it is
 * set). The parent validates and saves; this only draws.
 */
export default function CompanyFields({ idPrefix, values, onChange, errors = {}, disabled = false }: Props) {
  const approach = CONSOLIDATION_OPTIONS.find((option) => option.value === values.approach) ?? CONSOLIDATION_OPTIONS[0]!;
  const nameId = `${idPrefix}-company-name`;
  const yearId = `${idPrefix}-base-year`;
  const approachId = `${idPrefix}-consolidation`;

  return (
    <>
      <div>
        <label htmlFor={nameId} className={LABEL_CLASS}>
          Company name <span className="text-risk-high" aria-hidden="true">*</span>
        </label>
        <input
          id={nameId}
          type="text"
          value={values.name}
          onChange={(e) => onChange({ ...values, name: e.target.value })}
          maxLength={COMPANY_NAME_MAX}
          required
          disabled={disabled}
          placeholder="e.g., Northstar Foods"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? `${nameId}-error` : undefined}
          className={FIELD_CLASS}
        />
        {errors.name && <p id={`${nameId}-error`} className={ERROR_CLASS}>{errors.name}</p>}
      </div>

      <div>
        <label htmlFor={`${idPrefix}-industry`} className={LABEL_CLASS}>Industry</label>
        <select
          id={`${idPrefix}-industry`}
          value={values.industry}
          onChange={(e) => onChange({ ...values, industry: e.target.value })}
          disabled={disabled}
          className={FIELD_CLASS}
        >
          <option value="">Select industry (optional)</option>
          {INDUSTRIES.map((industry) => (
            <option key={industry} value={industry}>{industry}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor={approachId} className={LABEL_CLASS}>Consolidation approach</label>
          <select
            id={approachId}
            value={values.approach}
            onChange={(e) => onChange({ ...values, approach: e.target.value as ConsolidationApproach })}
            disabled={disabled}
            aria-describedby={`${approachId}-hint`}
            className={FIELD_CLASS}
          >
            {CONSOLIDATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <p id={`${approachId}-hint`} className={HINT_CLASS}>{CONSOLIDATION_HINT} {approach.explanation}</p>
        </div>

        <div>
          <label htmlFor={yearId} className={LABEL_CLASS}>Base year (optional)</label>
          <input
            id={yearId}
            type="text"
            inputMode="numeric"
            value={values.baseYear}
            onChange={(e) => onChange({ ...values, baseYear: e.target.value })}
            maxLength={4}
            disabled={disabled}
            placeholder={`e.g., ${Math.max(BASE_YEAR_MIN, new Date().getUTCFullYear() - 5)}`}
            aria-invalid={errors.baseYear ? true : undefined}
            aria-describedby={errors.baseYear ? `${yearId}-hint ${yearId}-error` : `${yearId}-hint`}
            className={FIELD_CLASS}
          />
          <p id={`${yearId}-hint`} className={HINT_CLASS}>{BASE_YEAR_HINT}</p>
          {errors.baseYear && <p id={`${yearId}-error`} className={ERROR_CLASS}>{errors.baseYear}</p>}
        </div>
      </div>
    </>
  );
}
