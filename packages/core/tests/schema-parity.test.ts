/**
 * Producer/publication schema parity.
 *
 * content-agn publishes versioned copies of Algerknown's authoring schemas
 * (schemas/index.v1.schema.json, schemas/summary.v1.schema.json) and tracks
 * deployed copies at .algerknown/schemas/*. Both must stay in lockstep with
 * Algerknown's packages/core/schemas/*.json — see docs/dossier-contract.md.
 *
 * Two distinct checks:
 *   - Structural parity: the published v1 schemas must be deeply identical
 *     to Algerknown's authoring schemas, after normalizing only the
 *     deliberate unversioned -> versioned $id substitution. Any other
 *     structural drift is a contract break.
 *   - Deployed-copy parity: content-agn's tracked .algerknown/schemas/*
 *     files are distribution artifacts and must be byte-identical to the
 *     published v1 files — no formatting or semantic drift permitted.
 *
 * (entry.schema.json has no versioned variant and is covered by the
 * existing byte-identity assertion in validator.test.ts.)
 *
 * Corpus/schema resolution follows the same pinned/candidate/auto rules as
 * conformance.test.ts — see ./support/conformance-resolution.ts.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveConformanceSource } from './support/conformance-resolution.js';

const CORE_SCHEMAS_DIR = path.join(__dirname, '..', 'schemas');

const SOURCE = resolveConformanceSource();

// The only permitted difference between an authoring schema and its
// published v1 counterpart: the versioned $id suffix.
function normalizeVersionedId(schema: Record<string, unknown>, authoringId: string): Record<string, unknown> {
  return { ...schema, $id: authoringId };
}

if (SOURCE !== null) {
  const { contentAgnRoot, summarySchemaPath, indexSchemaPath } = SOURCE;

  describe('schema parity: Algerknown authoring schemas vs content-agn published v1', () => {
    it('index.schema.json is structurally identical to published index.v1.schema.json aside from the versioned $id', () => {
      const authoring = JSON.parse(fs.readFileSync(path.join(CORE_SCHEMAS_DIR, 'index.schema.json'), 'utf-8'));
      const published = JSON.parse(fs.readFileSync(indexSchemaPath, 'utf-8'));

      expect(published.$id).not.toBe(authoring.$id);
      expect(normalizeVersionedId(published, authoring.$id)).toEqual(authoring);
    });

    it('summary.schema.json is structurally identical to published summary.v1.schema.json aside from the versioned $id', () => {
      const authoring = JSON.parse(fs.readFileSync(path.join(CORE_SCHEMAS_DIR, 'summary.schema.json'), 'utf-8'));
      const published = JSON.parse(fs.readFileSync(summarySchemaPath, 'utf-8'));

      expect(published.$id).not.toBe(authoring.$id);
      expect(normalizeVersionedId(published, authoring.$id)).toEqual(authoring);
    });

    it('deployed .algerknown/schemas/index.schema.json is byte-identical to published index.v1.schema.json', () => {
      const deployedPath = path.join(contentAgnRoot, '.algerknown', 'schemas', 'index.schema.json');
      const deployed = fs.readFileSync(deployedPath);
      const published = fs.readFileSync(indexSchemaPath);
      expect(deployed.equals(published)).toBe(true);
    });

    it('deployed .algerknown/schemas/summary.schema.json is byte-identical to published summary.v1.schema.json', () => {
      const deployedPath = path.join(contentAgnRoot, '.algerknown', 'schemas', 'summary.schema.json');
      const deployed = fs.readFileSync(deployedPath);
      const published = fs.readFileSync(summarySchemaPath);
      expect(deployed.equals(published)).toBe(true);
    });
  });
} else {
  describe('schema parity: Algerknown authoring schemas vs content-agn published v1', () => {
    it.skip('skipped: no content-agn checkout found (set CONFORMANCE_CORPUS_DIR or CONFORMANCE_SOURCE_MODE)', () => {});
  });
}
