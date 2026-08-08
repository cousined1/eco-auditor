#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fixture = require('../src/lib/reports/sample-report-fixture.json');
const { generateSampleReportFiles, validateFixture } = require('../src/lib/reports/report-generator.cjs');

validateFixture(fixture);

const targetDir = path.join(__dirname, '..', 'public', 'sample-report');
const written = generateSampleReportFiles(fixture, targetDir);

console.log('Sample report files regenerated:');
for (const [key, filePath] of Object.entries(written)) {
  console.log('  ' + key + ': ' + filePath);
}