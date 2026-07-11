// P0-02 launch-gate guardrail: fail the build while legal placeholder tokens
// remain in the three legal pages. Counsel must replace them with real values.
// "business draft for review" banners are NOT placeholders — they must stay
// (§3 Hard Constraints) and are excluded by simply not being in BANNED_PHRASES.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BANNED_PHRASES = [
  '[Date to be set',
  '[AMOUNT TO BE SET',
  '[Jurisdiction to be set',
  '[Dispute resolution mechanism',
  '[PLACEHOLDER]',
  'TBD',
  'to be set upon legal review',
];

// "business draft for review" is the intentional banner sentence on each legal
// page; it is explicitly NOT a banned token (none of BANNED_PHRASES are a
// substring of it), so it is never flagged. No line-skipping is performed —
// every line is scanned so a real placeholder is never masked.
/**
 * Scan file contents for banned legal placeholder phrases.
 * @param {{ path: string, content: string }[]} files
 * @returns {string[]} matches as `path:line: phrase` (empty = clean)
 */
export function scanLegalPlaceholders(files) {
  const matches = [];
  for (const { path, content } of files) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const phrase of BANNED_PHRASES) {
        if (line.includes(phrase)) {
          matches.push(`${path}:${i + 1}: ${phrase}`);
        }
      }
    }
  }
  return matches;
}

const LEGAL_FILES = [
  'src/pages/TermsOfService.tsx',
  'src/pages/PrivacyPolicy.tsx',
  'src/pages/DataProcessingAddendum.tsx',
];

function runCLI() {
  const files = LEGAL_FILES.map((path) => ({
    path,
    content: readFileSync(path, 'utf8'),
  }));
  const matches = scanLegalPlaceholders(files);
  if (matches.length > 0) {
    console.error(
      `check-legal-placeholders: ${matches.length} banned placeholder token(s) found — replace with real legal values before publication:`,
    );
    for (const m of matches) console.error(`  ${m}`);
    process.exit(1);
  }
  console.error('check-legal-placeholders: no banned placeholders found.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCLI();
}