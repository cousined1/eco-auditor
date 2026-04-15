import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  pgEnum,
} from 'drizzle-orm/pg-core';

// --- Enums ---

export const ledgerStatusEnum = pgEnum('ledger_status', [
  'approved',
  'pending-review',
  'conditional',
  'rejected',
]);

export const fileStatusEnum = pgEnum('file_status', [
  'extracted',
  'review',
  'estimate',
  'error',
]);

export const supplierDataTypeEnum = pgEnum('supplier_data_type', [
  'primary',
  'estimate',
  'none',
]);

export const supplierResponseStatusEnum = pgEnum('supplier_response_status', [
  'received',
  'pending',
  'overdue',
  'not-sent',
]);

export const reportStatusEnum = pgEnum('report_status', [
  'draft',
  'not-started',
  'final',
  'in-progress',
]);

export const reportSignoffEnum = pgEnum('report_signoff', [
  'none',
  'approved',
  'pending',
]);

export const complianceStatusEnum = pgEnum('compliance_status', [
  'in-progress',
  'not-started',
  'overdue',
  'complete',
]);

export const alertSeverityEnum = pgEnum('alert_severity', [
  'high',
  'medium',
  'low',
  'info',
]);

// --- Tables ---

export const companies = pgTable('companies', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  industry: text('industry').notNull(),
  revenue: text('revenue').notNull(),
  employees: integer('employees').notNull(),
  facilitiesCount: integer('facilities_count').notNull(),
  hq: text('hq').notNull(),
  euCustomers: boolean('eu_customers').notNull().default(false),
  templateType: text('template_type').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const facilities = pgTable('facilities', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull(),
  city: text('city').notNull(),
  scope1Pct: integer('scope1_pct').notNull(),
  scope2Pct: integer('scope2_pct').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const emissionEntries = pgTable('emission_entries', {
  id: serial('id').primaryKey(),
  scope: text('scope').notNull(),
  category: text('category').notNull(),
  source: text('source').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  unit: text('unit').notNull(),
  factor: text('factor').notNull(),
  method: text('method'),
  confidence: integer('confidence').notNull(),
  facilityId: integer('facility_id').references(() => facilities.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const ledgerEntries = pgTable('ledger_entries', {
  id: serial('id').primaryKey(),
  entryId: text('entry_id').notNull().unique(),
  date: text('date').notNull(),
  sourceDoc: text('source_doc').notNull(),
  scope: text('scope').notNull(),
  category: text('category').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  unit: text('unit').notNull(),
  factor: text('factor').notNull(),
  method: text('method').notNull(),
  extraction: text('extraction').notNull(),
  reviewer: text('reviewer').notNull(),
  status: ledgerStatusEnum('status').notNull(),
  version: integer('version').notNull().default(1),
  confidence: integer('confidence').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const uploadedFiles = pgTable('uploaded_files', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  status: fileStatusEnum('status').notNull(),
  date: text('date').notNull(),
  fieldsCount: integer('fields_count').notNull(),
  confidence: integer('confidence').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const suppliers = pgTable('suppliers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  spend: text('spend').notNull(),
  emissions: integer('emissions').notNull(),
  dataType: supplierDataTypeEnum('data_type').notNull(),
  responseStatus: supplierResponseStatusEnum('response_status').notNull(),
  lastContact: text('last_contact').notNull(),
  relevance: text('relevance').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const reports = pgTable('reports', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  type: text('type').notNull(),
  status: reportStatusEnum('status').notNull(),
  lastUpdated: text('last_updated').notNull(),
  completeness: integer('completeness').notNull().default(0),
  signoff: reportSignoffEnum('signoff').notNull().default('none'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const complianceTasks = pgTable('compliance_tasks', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  deadline: text('deadline').notNull(),
  status: complianceStatusEnum('status').notNull(),
  type: text('type').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const missingDataAlerts = pgTable('missing_data_alerts', {
  id: serial('id').primaryKey(),
  severity: alertSeverityEnum('severity').notNull(),
  message: text('message').notNull(),
  scope: text('scope').notNull(),
  action: text('action').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const contactSubmissions = pgTable('contact_submissions', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  company: text('company'),
  email: text('email').notNull(),
  subject: text('subject').notNull(),
  message: text('message').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const trendData = pgTable('trend_data', {
  id: serial('id').primaryKey(),
  month: text('month').notNull(),
  scope1: integer('scope1').notNull(),
  scope2: integer('scope2').notNull(),
  scope3: integer('scope3').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});
