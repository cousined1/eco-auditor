'use strict';

const fs = require('node:fs');
const path = require('node:path');

function buildReportText(summary, period) {
  const lines = [
    'EcoAuditor Emissions Report',
    'Generated: ' + new Date().toISOString().split('T')[0],
    'Reporting period: ' + (period || 'All time'),
    '',
    'Total: ' + summary.total_emissions_tCO2e + ' tCO2e',
    'Scope 1: ' + summary.by_scope.scope1 + ' tCO2e',
    'Scope 2: ' + summary.by_scope.scope2 + ' tCO2e',
    'Scope 3: ' + summary.by_scope.scope3 + ' tCO2e',
    'Confidence: ' + summary.confidence_score + '%',
    'Methodology: ' + summary.methodology,
  ];
  // REL-001: provisional (verified:false) factors do reach customer
  // inventories, so the report must say so instead of implying every factor is
  // citation-tracked. Calculated entries carry provenance: { verified: false }
  // from the engine when the applied catalog factor is provisional.
  const entries = Array.isArray(summary && summary.entries) ? summary.entries : [];
  const provisional = entries.filter(function (entry) {
    return entry && entry.provenance && entry.provenance.verified === false;
  }).length;
  if (provisional > 0) {
    lines.push(
      provisional + ' of ' + entries.length + ' factors applied are provisional (industry-typical values pending citation verification)'
    );
  }
  return lines.join('\n');
}

function createSimplePdf(text) {
  const safeText = String(text).replace(/[()\\]/g, '\\$&').split('\n').join(') Tj\n0 -16 Td\n(');
  const stream = `BT /F1 12 Tf 72 740 Td (${safeText}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach(function (object, index) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

function validateFixture(fixture) {
  if (!fixture || typeof fixture !== 'object') {
    throw new Error('Fixture must be an object');
  }
  const required = ['reportId', 'revision', 'boundary', 'baseYear', 'metrics', 'activityData', 'factorRegister', 'evidenceIndex'];
  for (const key of required) {
    if (!(key in fixture)) {
      throw new Error('Fixture missing required field: ' + key);
    }
  }
  const metrics = fixture.metrics;
  const activityData = fixture.activityData;
  const factorRegister = fixture.factorRegister;
  const evidenceIndex = fixture.evidenceIndex;

  if (!Array.isArray(activityData) || activityData.length !== 11) {
    throw new Error('activityData must be an array of 11 rows, got ' + (Array.isArray(activityData) ? activityData.length : 'non-array'));
  }
  if (!Array.isArray(factorRegister) || factorRegister.length !== 5) {
    throw new Error('factorRegister must be an array of 5 factors, got ' + (Array.isArray(factorRegister) ? factorRegister.length : 'non-array'));
  }
  if (!Array.isArray(evidenceIndex) || evidenceIndex.length !== 11) {
    throw new Error('evidenceIndex must be an array of 11 entries, got ' + (Array.isArray(evidenceIndex) ? evidenceIndex.length : 'non-array'));
  }

  const s1 = metrics.scope1 && metrics.scope1.value;
  const s2 = metrics.scope2 && metrics.scope2.value;
  const s3 = metrics.scope3 && metrics.scope3.value;
  const total = metrics.total;
  if (typeof s1 !== 'number' || typeof s2 !== 'number' || typeof s3 !== 'number' || typeof total !== 'number') {
    throw new Error('metrics.scope{1,2,3}.value and metrics.total must be numbers');
  }
  // Exact float equality on decimal tonnes is a trap: 91.8 + 44.1 + 300.3
  // evaluates to 436.20000000000005, so a perfectly consistent one-decimal
  // fixture would throw and break the build. Compare with a tolerance well
  // below the reporting precision instead.
  if (Math.abs(s1 + s2 + s3 - total) > 0.005) {
    throw new Error('Scope sums (' + s1 + '+' + s2 + '+' + s3 + '=' + (s1 + s2 + s3) + ') do not match total (' + total + ')');
  }

  const activityIds = new Set(activityData.map(function (r) { return r.entry_id; }));
  const evidenceIds = new Set(evidenceIndex.map(function (r) { return r.entry_id; }));
  for (const id of activityIds) {
    if (!evidenceIds.has(id)) {
      throw new Error('Activity entry ' + id + ' missing from evidenceIndex');
    }
  }
  for (const id of evidenceIds) {
    if (!activityIds.has(id)) {
      throw new Error('Evidence entry ' + id + ' missing from activityData');
    }
  }

  return true;
}

function csvEscape(value) {
  let s = String(value == null ? '' : value);
  // API-011: neutralize spreadsheet formula injection — a cell beginning with
  // =, +, -, @, tab, or CR would execute as a formula/link when opened in a
  // spreadsheet app. Prefix with a single quote (standard mitigation).
  if (/^[=+@\t\r-]/.test(s)) {
    s = "'" + s;
  }
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(rows, columns) {
  const header = columns.join(',');
  const body = rows.map(function (row) {
    return columns.map(function (col) { return csvEscape(row[col]); }).join(',');
  }).join('\n');
  return header + '\n' + body + '\n';
}

function generateSampleReportFiles(fixture, targetDir) {
  validateFixture(fixture);
  const dir = targetDir || path.join(__dirname, '..', '..', '..', 'public', 'sample-report');
  fs.mkdirSync(dir, { recursive: true });

  const activityColumns = ['entry_id', 'scope', 'category', 'activity', 'activity_value', 'activity_unit', 'emission_factor', 'emission_factor_unit', 'emission_factor_source', 'tCO2e', 'data_quality_level', 'source_document', 'reviewer', 'review_timestamp'];
  fs.writeFileSync(path.join(dir, 'pacific-freight-activity-data.csv'), toCsv(fixture.activityData, activityColumns));

  const factorColumns = ['factor_id', 'source_organization', 'dataset_name', 'dataset_version', 'publication_date', 'imported_at', 'effective_from', 'effective_to', 'geography', 'activity_unit', 'output_unit', 'factor_value', 'factor_gas', 'gwp_basis', 'checksum', 'status'];
  fs.writeFileSync(path.join(dir, 'pacific-freight-factor-register.csv'), toCsv(fixture.factorRegister, factorColumns));

  const evidenceColumns = ['entry_id', 'source_type', 'source_reference', 'document_id', 'uploader', 'upload_date', 'data_quality_level', 'override_reason', 'override_reviewer', 'notes'];
  fs.writeFileSync(path.join(dir, 'pacific-freight-evidence-index.csv'), toCsv(fixture.evidenceIndex, evidenceColumns));

  const summary = {
    total_emissions_tCO2e: fixture.metrics.total,
    by_scope: {
      scope1: fixture.metrics.scope1.value,
      scope2: fixture.metrics.scope2.value,
      scope3: fixture.metrics.scope3.value,
    },
    confidence_score: 59,
    methodology: 'GHG Protocol - Operational Control',
  };
  const fiscalYear = (fixture.company && fixture.company.fiscalYear) || fixture.baseYear + 1;
  const text = buildReportText(summary, 'FY ' + fiscalYear);
  const pdf = createSimplePdf(text);
  fs.writeFileSync(path.join(dir, 'pacific-freight-fy2026.pdf'), pdf);

  return {
    activityData: path.join(dir, 'pacific-freight-activity-data.csv'),
    factorRegister: path.join(dir, 'pacific-freight-factor-register.csv'),
    evidenceIndex: path.join(dir, 'pacific-freight-evidence-index.csv'),
    pdf: path.join(dir, 'pacific-freight-fy2026.pdf'),
  };
}

module.exports = {
  buildReportText,
  createSimplePdf,
  validateFixture,
  generateSampleReportFiles,
  toCsv,
};