import { useState } from 'react';
import { insforge } from '@/lib/insforge';
import type { Company, Facility } from './utils';

const INDUSTRIES = [
  'Agriculture & Food',
  'Construction',
  'Energy & Utilities',
  'Financial Services',
  'Healthcare',
  'Hospitality',
  'Manufacturing',
  'Retail & Consumer Goods',
  'Technology',
  'Transportation & Logistics',
  'Other',
];

interface Props {
  userId: string;
  onComplete: (company: Company, facilities: Facility[]) => void;
}

export default function Onboarding({ userId, onComplete }: Props) {
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [facilityName, setFacilityName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setSubmitting(true);
    setError(null);

    try {
      const { data: company, error: companyError } = await insforge.database
        .from('companies')
        .insert([{ user_id: userId, name: trimmedName, industry: industry || null }])
        .select()
        .single();

      if (companyError || !company) {
        throw new Error(companyError?.message || 'Failed to create company');
      }

      let facilities: Facility[] = [];
      const trimmedFacility = facilityName.trim();
      if (trimmedFacility) {
        const { data: facilityData, error: facilityError } = await insforge.database
          .from('facilities')
          .insert([{ company_id: (company as Company).id, name: trimmedFacility }])
          .select();

        if (facilityError) {
          throw new Error(facilityError.message || 'Failed to create facility');
        }
        facilities = (facilityData as Facility[]) ?? [];
      }

      onComplete(company as Company, facilities);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete onboarding');
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <form onSubmit={handleSubmit} className="card space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-surface-900 dark:text-white">
            Welcome to Eco-Auditor
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">
            Set up your company to start tracking emissions.
          </p>
        </div>

        <div>
          <label htmlFor="onboarding-company-name" className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
            Company name <span className="text-risk-high">*</span>
          </label>
          <input
            id="onboarding-company-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            required
            placeholder="e.g., Northstar Foods"
            className="w-full border border-surface-300 dark:border-surface-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
          />
        </div>

        <div>
          <label htmlFor="onboarding-industry" className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
            Industry
          </label>
          <select
            id="onboarding-industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            className="w-full border border-surface-300 dark:border-surface-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
          >
            <option value="">Select industry (optional)</option>
            {INDUSTRIES.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="onboarding-facility-name" className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
            First facility
          </label>
          <input
            id="onboarding-facility-name"
            type="text"
            value={facilityName}
            onChange={(e) => setFacilityName(e.target.value)}
            maxLength={200}
            placeholder="e.g., Main Office (optional)"
            className="w-full border border-surface-300 dark:border-surface-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100"
          />
        </div>

        {error && (
          <p className="text-xs text-risk-high" role="alert">{error}</p>
        )}

        <div className="flex justify-end pt-2 border-t border-surface-200 dark:border-surface-700">
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="bg-brand-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Setting up…' : 'Create Company'}
          </button>
        </div>
      </form>
    </div>
  );
}
