// @vitest-environment node
/**
 * F-E-17 and the no-silent-restatement rule (review R2): a catalog version is
 * immutable once any row may have been priced with it.
 *
 * - emission-factors.v1.json is the 2026-07-24 catalog, frozen byte for byte:
 *   every stored row without a pin, and every K2 row pinned to
 *   '2026-07-24+9841b57be1f6', resolves against it forever.
 * - Every catalog file must match the hash in emission-factors.versions.json,
 *   so a factor changed without a new `version` fails here (the version string
 *   used to stay '2026-07-24' through edits on 2026-08-22 and 2026-09-22).
 * - Every factorSource must resolve in registry.ts (F-E-06: 31 of 82 cited an
 *   id that did not exist), and every changed or new factor must cite its row.
 *
 * On the code before K7 this file fails: there was no frozen catalog, no
 * version map, and 'internal-estimate' was not a registry id.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMISSION_FACTOR_REGISTRY } from '../src/lib/emission-factors/registry';
import { CATALOG_VERSION as CLIENT_CATALOG_VERSION, LEGACY_CATALOG_VERSION as CLIENT_LEGACY_VERSION } from '../src/lib/emission-factors/factors';

const require = createRequire(import.meta.url);
const factors = require('../emission-factors.cjs');
const versions = require('../emission-factors.versions.json');

type Source = { key: string; factorSource: string; units: Record<string, number>; citation?: string; verified?: boolean };
type Catalog = { version: string; datasets?: Record<string, { revision: string; url: string; retrieved: string }>; categories: { key: string; sources: Source[] }[] };

const read = (file: string) => readFileSync(resolve(file), 'utf8');
const sha256 = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');

// Pinned here, not only in the map: editing the frozen file AND its map entry
// together must still fail.
const FROZEN_V1_SHA256 = 'a8754bc4f411dca2520b2e1be4ef643829fd98d855f49820b574f3a15189bafe';

describe('the frozen 2026-07-24 catalog', () => {
  it('is byte-identical to the catalog every legacy row was priced with', () => {
    expect(sha256(read('emission-factors.v1.json'))).toBe(FROZEN_V1_SHA256);
    expect(JSON.parse(read('emission-factors.v1.json')).version).toBe('2026-07-24');
  });

  it('is the catalog K2 entry-API rows name, and every unpinned row resolves to it', () => {
    expect(factors.LEGACY_CATALOG_VERSION).toBe('2026-07-24+9841b57be1f6');
    for (const pin of [null, undefined, '', '2026-07-24+9841b57be1f6', 'not-a-version+000000000000']) {
      expect(factors.catalogFor(pin).version, String(pin)).toBe('2026-07-24');
    }
    expect(factors.catalogFor(factors.CATALOG_VERSION).version).toBe(versions.current);
  });

  it('is shipped in the runtime image next to the current catalog', () => {
    expect(read('Dockerfile')).toMatch(/^COPY [^\n]*emission-factors\.json emission-factors\.v1\.json/m);
  });
});

describe('the version map (changing a factor without a version bump fails)', () => {
  const entries = Object.entries(versions.catalogs as Record<string, { file: string; sha256: string }>);

  it('records every catalog with the hash of its file', () => {
    expect(entries.length).toBeGreaterThanOrEqual(2);
    for (const [version, entry] of entries) {
      expect(existsSync(resolve(entry.file)), entry.file).toBe(true);
      const text = read(entry.file);
      expect(JSON.parse(text).version, entry.file).toBe(version);
      expect(sha256(text), `${entry.file}: content changed without a new version (see the note in emission-factors.versions.json)`).toBe(entry.sha256);
    }
  });

  it('names the current catalog emission-factors.json and the legacy one v1', () => {
    expect(versions.catalogs[versions.current].file).toBe('emission-factors.json');
    expect(versions.catalogs[versions.legacy].file).toBe('emission-factors.v1.json');
    expect(factors.CATALOG.version).toBe(versions.current);
    expect(factors.CATALOG_VERSION.startsWith(versions.current + '+')).toBe(true);
    expect(versions.current).not.toBe(versions.legacy);
  });

  it('every recorded version is loaded by emission-factors.cjs, so a row pinned to it keeps resolving', () => {
    for (const [version] of entries) {
      expect(factors.catalogFor(`${version}+000000000000`).version, version).toBe(version);
    }
  });

  it('catches an edited factor: the same file with one value changed no longer matches its entry', () => {
    const text = read('emission-factors.json');
    const edited = text.replace('"therms": 5.31145', '"therms": 5.3115');
    expect(edited).not.toBe(text);
    expect(sha256(edited)).not.toBe(versions.catalogs[versions.current].sha256);
  });

  it('the client knows the same two versions', () => {
    expect(CLIENT_CATALOG_VERSION).toBe(versions.current);
    expect(CLIENT_LEGACY_VERSION).toBe(versions.legacy);
  });
});

describe('provenance: every factor resolves to a registered dataset (F-E-06, F-E-17)', () => {
  const registry = new Map(EMISSION_FACTOR_REGISTRY.map((entry) => [entry.id, entry]));
  const current = JSON.parse(read('emission-factors.json')) as Catalog;
  const legacy = JSON.parse(read('emission-factors.v1.json')) as Catalog;
  const sources = (catalog: Catalog) => catalog.categories.flatMap((c) => c.sources.map((s) => ({ ...s, category: c.key })));

  it('every factorSource in both catalogs is a registry id (the provenance census finds 0 unresolved)', () => {
    for (const catalog of [current, legacy]) {
      const unresolved = sources(catalog).filter((s) => !registry.has(s.factorSource)).map((s) => `${s.category}/${s.key} -> ${s.factorSource}`);
      expect(unresolved, catalog.version).toEqual([]);
    }
  });

  it('the current catalog records the dataset revision of every factorSource, and registry.ts states the same one', () => {
    for (const id of new Set(sources(current).map((s) => s.factorSource))) {
      const dataset = current.datasets?.[id];
      expect(dataset, id).toBeDefined();
      expect(registry.get(id)?.datasetRevision, id).toBe(dataset?.revision);
      if (id !== 'internal-estimate') {
        expect(dataset?.url, id).toMatch(/^https:\/\/(www\.epa\.gov|ghgprotocol\.org|assets\.publishing\.service\.gov\.uk)\//);
        expect(dataset?.retrieved, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('an internal estimate is flagged provisional wherever it is used, and its registry entry is unverified', () => {
    expect(registry.get('internal-estimate')?.verified).toBe(false);
    for (const source of sources(current).filter((s) => s.factorSource === 'internal-estimate')) {
      expect(source.verified, `${source.category}/${source.key}`).toBe(false);
    }
  });

  it('every factor that differs from, or is new since, the frozen catalog cites the row it comes from', () => {
    const before = new Map(sources(legacy).map((s) => [`${s.category}/${s.key}`, s]));
    const uncited = sources(current)
      .filter((s) => JSON.stringify(before.get(`${s.category}/${s.key}`)?.units) !== JSON.stringify(s.units))
      .filter((s) => !s.citation)
      .map((s) => `${s.category}/${s.key}`);
    expect(uncited).toEqual([]);
  });
});
