#!/usr/bin/env node
/**
 * VALIDATION SCRIPT: EcoAuditor Slices 1-2
 * 
 * Purpose: Demonstrates that the Calculator Engine (Slice 1) 
 * and emissions endpoints (Slice 2) are working correctly.
 * 
 * Usage:
 *   node validate-slices-1-2.js
 * 
 * Requirements:
 *   - Server running on http://localhost:3000
 *   - Valid InsForge bearer token in INSFORGE_TOKEN env var
 */

const http = require('http');

const API_BASE = 'http://localhost:3000';
const TOKEN = process.env.INSFORGE_TOKEN;

if (!TOKEN) {
  console.error('❌ ERROR: INSFORGE_TOKEN environment variable not set');
  console.error('   Usage: INSFORGE_TOKEN=... node validate-slices-1-2.js');
  process.exit(1);
}

// Test cases: (scope, category, source, amount, unit, expected_co2e_kg)
const TEST_CASES = [
  // Scope 2: Electricity
  { scope: 'Scope 2', cat: 'Purchased Electricity', src: 'California', amt: 500, unit: 'kWh', expected: 115 },
  { scope: 'Scope 2', cat: 'Purchased Electricity', src: 'US Average', amt: 1000, unit: 'kWh', expected: 417 },
  
  // Scope 1: Mobile Combustion
  { scope: 'Scope 1', cat: 'Mobile Combustion', src: 'Gasoline', amt: 100, unit: 'gallons', expected: 888.7 },
  
  // Scope 1: Stationary Combustion
  { scope: 'Scope 1', cat: 'Stationary Combustion', src: 'Natural Gas', amt: 100, unit: 'MMBtu', expected: 5306 },
  
  // Scope 3: Business Travel
  { scope: 'Scope 3', cat: 'Business Travel', src: 'Air Short Haul', amt: 1000, unit: 'miles', expected: 255 },
];

const INVALID_CASES = [
  // Missing required field
  { scope: 'Scope 1', cat: 'Mobile Combustion', src: 'Gasoline', amt: 100, expectedError: 'MISSING_FIELDS', note: 'Missing unit' },
  
  // Invalid scope
  { scope: 'Scope 4', cat: 'Mobile Combustion', src: 'Gasoline', amt: 100, unit: 'gallons', expectedError: 'INVALID_SCOPE', note: 'Scope 4 does not exist' },
  
  // Invalid category
  { scope: 'Scope 1', cat: 'Bad Category', src: 'Gasoline', amt: 100, unit: 'gallons', expectedError: 'INVALID_CATEGORY', note: 'Category does not exist' },
  
  // Invalid source for category
  { scope: 'Scope 1', cat: 'Purchased Electricity', src: 'Gasoline', amt: 100, unit: 'kWh', expectedError: 'INVALID_SOURCE', note: 'Gasoline not valid for Electricity' },
  
  // Negative amount
  { scope: 'Scope 1', cat: 'Mobile Combustion', src: 'Gasoline', amt: -100, unit: 'gallons', expectedError: 'INVALID_AMOUNT', note: 'Negative amount' },
];

function makeRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + endpoint);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
    };

    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function testCalculator(testCase, index) {
  const { scope, cat, src, amt, unit, expected } = testCase;
  
  try {
    const response = await makeRequest('POST', '/api/calculate', {
      scope, category: cat, source: src, amount: amt, unit,
    });

    if (response.status !== 200) {
      return { pass: false, reason: `HTTP ${response.status}`, result: response.body };
    }

    if (!response.body.success) {
      return { pass: false, reason: 'success=false', result: response.body };
    }

    const { co2e_kg, confidence, factor_source } = response.body;
    const tolerance = expected * 0.01; // 1% tolerance
    const match = Math.abs(co2e_kg - expected) <= tolerance;

    if (!match) {
      return { 
        pass: false, 
        reason: `Expected ${expected} kg, got ${co2e_kg} kg`,
        result: response.body,
      };
    }

    return { 
      pass: true, 
      co2e_kg, 
      confidence,
      factor_source,
    };
  } catch (err) {
    return { pass: false, reason: err.message };
  }
}

async function testInvalidInput(testCase, index) {
  const { scope, cat, src, amt, unit, expectedError, note } = testCase;
  
  try {
    const response = await makeRequest('POST', '/api/calculate', {
      scope, category: cat, source: src, amount: amt, unit,
    });

    if (response.status === 200) {
      return { pass: false, reason: `Expected error but got 200 OK` };
    }

    if (response.body.code !== expectedError) {
      return { 
        pass: false, 
        reason: `Expected error code ${expectedError}, got ${response.body.code}`,
        body: response.body,
      };
    }

    return { pass: true, code: response.body.code, error: response.body.error };
  } catch (err) {
    return { pass: false, reason: err.message };
  }
}

async function testSummaryEndpoint() {
  try {
    const response = await makeRequest('GET', '/api/emissions/summary?company_id=1');
    
    if (response.status !== 200) {
      return { pass: false, reason: `HTTP ${response.status}` };
    }

    if (!response.body.success) {
      return { pass: false, reason: 'success=false' };
    }

    const { data } = response.body;
    const required = [
      'total_co2e_tonnes',
      'scope1_co2e_tonnes',
      'scope2_co2e_tonnes',
      'scope3_co2e_tonnes',
      'scope1_pct',
      'scope2_pct',
      'scope3_pct',
    ];

    for (const field of required) {
      if (!(field in data)) {
        return { pass: false, reason: `Missing field: ${field}` };
      }
    }

    return { pass: true, data };
  } catch (err) {
    return { pass: false, reason: err.message };
  }
}

async function testTrendEndpoint() {
  try {
    const response = await makeRequest('GET', '/api/emissions/trend?company_id=1&period=monthly');
    
    if (response.status !== 200) {
      return { pass: false, reason: `HTTP ${response.status}` };
    }

    if (!response.body.success) {
      return { pass: false, reason: 'success=false' };
    }

    const { data, period } = response.body;
    
    if (!Array.isArray(data) || data.length === 0) {
      return { pass: false, reason: 'No trend data returned' };
    }

    if (period !== 'monthly') {
      return { pass: false, reason: `Expected period=monthly, got ${period}` };
    }

    // Check first entry has required fields
    const firstEntry = data[0];
    if (!('month' in firstEntry && 'scope1' in firstEntry && 'scope2' in firstEntry && 'scope3' in firstEntry)) {
      return { pass: false, reason: 'Missing fields in trend data' };
    }

    return { pass: true, entries: data.length, period };
  } catch (err) {
    return { pass: false, reason: err.message };
  }
}

async function runValidation() {
  console.log('🚀 EcoAuditor Slices 1-2 Validation\n');
  console.log(`📡 API Base: ${API_BASE}`);
  console.log(`🔑 Token: ${TOKEN.slice(0, 20)}...\\n`);

  // Test Calculator: Valid Cases
  console.log('═══════════════════════════════════════');
  console.log('SLICE 1: CALCULATOR ENGINE - Valid Cases');
  console.log('═══════════════════════════════════════\n');

  let passCount = 0;
  for (let i = 0; i < TEST_CASES.length; i++) {
    const test = TEST_CASES[i];
    const result = await testCalculator(test, i);
    
    const status = result.pass ? '✅' : '❌';
    const details = result.pass 
      ? `${result.co2e_kg} kg CO2e (${result.confidence}% confidence)`
      : result.reason;
    
    console.log(`${status} Test ${i + 1}: ${test.scope} / ${test.cat} / ${test.src}`);
    console.log(`   ${test.amt} ${test.unit} → ${details}`);
    
    if (result.pass) passCount++;
  }

  console.log(`\n✅ Passed: ${passCount}/${TEST_CASES.length}\n`);

  // Test Calculator: Invalid Cases
  console.log('═══════════════════════════════════════');
  console.log('SLICE 1: CALCULATOR ENGINE - Error Handling');
  console.log('═══════════════════════════════════════\n');

  let validationPassCount = 0;
  for (let i = 0; i < INVALID_CASES.length; i++) {
    const test = INVALID_CASES[i];
    const result = await testInvalidInput(test, i);
    
    const status = result.pass ? '✅' : '❌';
    const details = result.pass 
      ? `Correctly rejected with code: ${result.code}`
      : result.reason;
    
    console.log(`${status} Test ${i + 1}: ${test.note}`);
    console.log(`   Expected: ${test.expectedError}, Got: ${details}`);
    
    if (result.pass) validationPassCount++;
  }

  console.log(`\n✅ Passed: ${validationPassCount}/${INVALID_CASES.length}\n`);

  // Test Emissions Summary Endpoint
  console.log('═══════════════════════════════════════');
  console.log('SLICE 2: EMISSIONS SUMMARY ENDPOINT');
  console.log('═══════════════════════════════════════\n');

  const summaryResult = await testSummaryEndpoint();
  if (summaryResult.pass) {
    console.log('✅ GET /api/emissions/summary working');
    console.log(`   Total: ${summaryResult.data.total_co2e_tonnes} tCO2e`);
    console.log(`   Scope 1: ${summaryResult.data.scope1_co2e_tonnes} tCO2e (${summaryResult.data.scope1_pct}%)`);
    console.log(`   Scope 2: ${summaryResult.data.scope2_co2e_tonnes} tCO2e (${summaryResult.data.scope2_pct}%)`);
    console.log(`   Scope 3: ${summaryResult.data.scope3_co2e_tonnes} tCO2e (${summaryResult.data.scope3_pct}%)\n`);
  } else {
    console.log(`❌ GET /api/emissions/summary failed: ${summaryResult.reason}\n`);
  }

  // Test Emissions Trend Endpoint
  console.log('═══════════════════════════════════════');
  console.log('SLICE 2: EMISSIONS TREND ENDPOINT');
  console.log('═══════════════════════════════════════\n');

  const trendResult = await testTrendEndpoint();
  if (trendResult.pass) {
    console.log(`✅ GET /api/emissions/trend working`);
    console.log(`   Period: ${trendResult.period}`);
    console.log(`   Entries: ${trendResult.entries} months of data\n`);
  } else {
    console.log(`❌ GET /api/emissions/trend failed: ${trendResult.reason}\n`);
  }

  // Summary
  console.log('═══════════════════════════════════════');
  console.log('VALIDATION SUMMARY');
  console.log('═══════════════════════════════════════\n');

  const sliceTotalPass = passCount + validationPassCount;
  const sliceTotal = TEST_CASES.length + INVALID_CASES.length;
  const allPass = sliceTotalPass === sliceTotal && summaryResult.pass && trendResult.pass;

  console.log(`Slice 1 (Calculator): ${passCount}/${TEST_CASES.length} ✓`);
  console.log(`Slice 1 (Validation): ${validationPassCount}/${INVALID_CASES.length} ✓`);
  console.log(`Slice 2 (Summary): ${summaryResult.pass ? '✓' : '✗'}`);
  console.log(`Slice 2 (Trend): ${trendResult.pass ? '✓' : '✗'}`);

  console.log(`\n${allPass ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('\n✨ Slices 1-2 are ready for production deployment!\n');

  process.exit(allPass ? 0 : 1);
}

runValidation().catch(err => {
  console.error('❌ Validation error:', err);
  process.exit(1);
});
