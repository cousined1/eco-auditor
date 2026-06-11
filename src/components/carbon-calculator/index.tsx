import { useState, useEffect, useCallback } from 'react';
import { insforge } from '@/lib/insforge';
import EmissionForm from './EmissionForm';
import EmissionList from './EmissionList';
import EmissionsDashboard from './EmissionsDashboard';
import ReportGenerator from './ReportGenerator';
import Onboarding from './Onboarding';
import type { Company, Facility, EmissionEntry } from './utils';

export default function CarbonCalculator() {
  const [userId, setUserId] = useState<string | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [entries, setEntries] = useState<EmissionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = useCallback(async (companyId: number) => {
    const { data, error: fetchError } = await insforge.database
      .from('emission_entries')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (fetchError) throw fetchError;
    setEntries((data as EmissionEntry[]) ?? []);
  }, []);

  useEffect(() => {
    async function loadData() {
      try {
        const { data } = await insforge.auth.getCurrentUser();
        const user = data?.user;
        if (!user) {
          setError('Not authenticated.');
          setLoading(false);
          return;
        }
        setUserId(user.id);

        const { data: companyData, error: companyError } = await insforge.database
          .from('companies')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();

        if (companyError) throw companyError;

        if (!companyData) {
          // No company yet — onboarding form is rendered below.
          setLoading(false);
          return;
        }

        setCompany(companyData as Company);

        const { data: facilityData } = await insforge.database
          .from('facilities')
          .select('*')
          .eq('company_id', (companyData as Company).id);

        setFacilities((facilityData as Facility[]) ?? []);
        await loadEntries((companyData as Company).id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [loadEntries]);

  function handleOnboarded(newCompany: Company, newFacilities: Facility[]) {
    setCompany(newCompany);
    setFacilities(newFacilities);
    setEntries([]);
  }

  async function handleSubmit(data: {
    scope: string;
    category: string;
    source: string;
    amount: number;
    unit: string;
    facilityId: number | null;
    calculatedKg: number;
  }) {
    if (!company) return;

    const { error: insertError } = await insforge.database
      .from('emission_entries')
      .insert([{
        scope: data.scope,
        category: data.category,
        source: data.source,
        amount: data.calculatedKg,
        unit: 'kg CO2e',
        factor: `${data.amount} ${data.unit}`,
        method: 'EPA emission factor',
        confidence: 85,
        facility_id: data.facilityId,
        company_id: company.id,
      }]);

    if (insertError) throw insertError;
    await loadEntries(company.id);
  }

  async function handleDelete(id: number) {
    const { error: deleteError } = await insforge.database
      .from('emission_entries')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;
    if (company) await loadEntries(company.id);
  }

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="card animate-pulse">
          <div className="h-6 w-48 bg-surface-200 dark:bg-surface-700 rounded mb-4" />
          <div className="h-40 bg-surface-200 dark:bg-surface-700 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="card border border-risk-high/30">
          <h2 className="text-sm font-semibold text-risk-high mb-1">Unable to load calculator</h2>
          <p className="text-sm text-surface-600 dark:text-surface-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!company) {
    if (userId) {
      return <Onboarding userId={userId} onComplete={handleOnboarded} />;
    }
    return null;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-surface-900 dark:text-white">
            Carbon Calculator
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">
            Track and calculate emissions for {company.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge-blue">{facilities.length} Facilities</span>
          <span className="badge-green">{entries.length} Entries</span>
        </div>
      </div>

      <EmissionForm facilities={facilities} onSubmit={handleSubmit} />
      <EmissionsDashboard entries={entries} facilities={facilities} />
      <EmissionList entries={entries} facilities={facilities} onDelete={handleDelete} />
      <ReportGenerator company={company} entries={entries} />
    </div>
  );
}
