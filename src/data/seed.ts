import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { sql } from 'drizzle-orm';

import {
  COMPANY,
  FACILITIES,
  EMISSIONS_SUMMARY,
  LEDGER_ENTRIES,
  UPLOADED_FILES,
  SUPPLIERS,
  REPORTS,
  COMPLIANCE_TASKS,
  MISSING_DATA_ALERTS,
  TREND_DATA,
} from './mockData.js';

async function seed() {
  console.log('🌱 Starting seed...');

  // Truncate all tables (cascade)
  console.log('  Clearing existing data...');
  await db.execute(sql`TRUNCATE TABLE
    trend_data,
    missing_data_alerts,
    compliance_tasks,
    reports,
    suppliers,
    uploaded_files,
    ledger_entries,
    emission_entries,
    facilities,
    companies
    RESTART IDENTITY CASCADE`);

  // --- Companies ---
  console.log('  Seeding companies...');
  const [company] = await db
    .insert(schema.companies)
    .values({
      name: COMPANY.name,
      industry: COMPANY.industry,
      revenue: COMPANY.revenue,
      employees: COMPANY.employees,
      facilitiesCount: COMPANY.facilities,
      hq: COMPANY.hq,
      euCustomers: COMPANY.euCustomers,
      templateType: COMPANY.templateType,
    })
    .returning();

  // --- Facilities ---
  console.log('  Seeding facilities...');
  const insertedFacilities = await db
    .insert(schema.facilities)
    .values(
      FACILITIES.map((f) => ({
        companyId: company!.id,
        name: f.name,
        type: f.type,
        city: f.city,
        scope1Pct: f.scope1Pct,
        scope2Pct: f.scope2Pct,
      }))
    )
    .returning();

  // Build facility lookup by name for emission entries
  const facilityByName: Record<string, number> = {};
  insertedFacilities.forEach((f) => {
    facilityByName[f.name] = f.id;
  });

  // --- Emission Entries (all scopes) ---
  console.log('  Seeding emission entries...');
  const allEmissions = [
    ...EMISSIONS_SUMMARY.scope1.items.map((e) => ({
      scope: 'Scope 1',
      category: 'Direct Emissions',
      source: e.source,
      amount: e.value.toString(),
      unit: 'tCO2e',
      factor: e.factor,
      method: null,
      confidence: e.confidence,
      facilityId: null as number | null,
    })),
    ...EMISSIONS_SUMMARY.scope2.items.map((e) => ({
      scope: 'Scope 2',
      category: 'Electricity',
      source: e.source,
      amount: e.value.toString(),
      unit: 'tCO2e',
      factor: e.factor,
      method: null,
      confidence: e.confidence,
      facilityId: null as number | null,
    })),
    ...EMISSIONS_SUMMARY.scope3.items.map((e) => ({
      scope: 'Scope 3',
      category: 'Value Chain',
      source: e.source,
      amount: e.value.toString(),
      unit: 'tCO2e',
      factor: e.factor,
      method: null,
      confidence: e.confidence,
      facilityId: null as number | null,
    })),
  ];

  await db.insert(schema.emissionEntries).values(allEmissions);

  // --- Ledger Entries ---
  console.log('  Seeding ledger entries...');
  await db.insert(schema.ledgerEntries).values(
    LEDGER_ENTRIES.map((l) => ({
      entryId: l.id,
      date: l.date,
      sourceDoc: l.source,
      scope: l.scope,
      category: l.category,
      amount: l.amount.toString(),
      unit: l.unit,
      factor: l.factor,
      method: l.method,
      extraction: l.extraction,
      reviewer: l.reviewer,
      status: l.status as 'approved' | 'pending-review' | 'conditional' | 'rejected',
      version: l.version,
      confidence: l.confidence,
    }))
  );

  // --- Uploaded Files ---
  console.log('  Seeding uploaded files...');
  await db.insert(schema.uploadedFiles).values(
    UPLOADED_FILES.map((f) => ({
      name: f.name,
      type: f.type,
      status: f.status as 'extracted' | 'review' | 'estimate' | 'error',
      date: f.date,
      fieldsCount: f.fields,
      confidence: f.confidence,
    }))
  );

  // --- Suppliers ---
  console.log('  Seeding suppliers...');
  await db.insert(schema.suppliers).values(
    SUPPLIERS.map((s) => ({
      name: s.name,
      category: s.category,
      spend: s.spend,
      emissions: s.emissions,
      dataType: s.dataType as 'primary' | 'estimate' | 'none',
      responseStatus: s.responseStatus as 'received' | 'pending' | 'overdue' | 'not-sent',
      lastContact: s.lastContact,
      relevance: s.relevance,
    }))
  );

  // --- Reports ---
  console.log('  Seeding reports...');
  await db.insert(schema.reports).values(
    REPORTS.map((r) => ({
      title: r.title,
      type: r.type,
      status: r.status as 'draft' | 'not-started' | 'final' | 'in-progress',
      lastUpdated: r.lastUpdated,
      completeness: r.completeness,
      signoff: r.signoff as 'none' | 'approved' | 'pending',
    }))
  );

  // --- Compliance Tasks ---
  console.log('  Seeding compliance tasks...');
  await db.insert(schema.complianceTasks).values(
    COMPLIANCE_TASKS.map((t) => ({
      title: t.title,
      deadline: t.deadline,
      status: t.status as 'in-progress' | 'not-started' | 'overdue' | 'complete',
      type: t.type,
    }))
  );

  // --- Missing Data Alerts ---
  console.log('  Seeding missing data alerts...');
  await db.insert(schema.missingDataAlerts).values(
    MISSING_DATA_ALERTS.map((a) => ({
      severity: a.severity as 'high' | 'medium' | 'low' | 'info',
      message: a.message,
      scope: a.scope,
      action: a.action,
    }))
  );

  // --- Trend Data ---
  console.log('  Seeding trend data...');
  await db.insert(schema.trendData).values(
    TREND_DATA.map((t) => ({
      month: t.month,
      scope1: t.scope1,
      scope2: t.scope2,
      scope3: t.scope3,
    }))
  );

  console.log('✅ Seeding complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
