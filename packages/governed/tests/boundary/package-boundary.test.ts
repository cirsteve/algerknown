import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '../../src');

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

const IMPORT_SPECIFIER_PATTERN = /(?:from|require\()\s*['"]([^'"]+)['"]/g;

/**
 * Application-independence is the deliverable: @algerknown/governed must never
 * import the existing dossier representation, Scout, community-application
 * schemas, grading concepts, platform clients, or a concrete backend
 * implementation. Ports abstract all of that away for later cohorts.
 */
const FORBIDDEN_IMPORT_SPECIFIERS = [
  '@algerknown/core',
  '@algerknown/web',
  '@algerknown/cli',
  'chromadb',
  'better-sqlite3',
  'sqlite3',
  'scout',
];

const FORBIDDEN_IDENTIFIERS = [
  'ContextPacket',
  'StateManager',
  'PlatformClient',
  'GradingResult',
  'GradingRubric',
  'Dossier',
];

function findForbiddenImport(content: string): string | undefined {
  for (const match of content.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    const specifier = match[1]?.toLowerCase() ?? '';
    const hit = FORBIDDEN_IMPORT_SPECIFIERS.find((forbidden) => specifier.includes(forbidden.toLowerCase()));
    if (hit) return hit;
  }
  return undefined;
}

function findForbiddenIdentifier(content: string): string | undefined {
  return FORBIDDEN_IDENTIFIERS.find((identifier) => new RegExp(`\\b${identifier}\\b`).test(content));
}

describe('scanner self-check (proves the guard actually catches violations)', () => {
  it('flags a forbidden import specifier', () => {
    expect(findForbiddenImport("import type { Summary } from '@algerknown/core';")).toBe('@algerknown/core');
    expect(findForbiddenImport("import { ChromaClient } from 'chromadb';")).toBe('chromadb');
  });

  it('flags a forbidden application identifier', () => {
    expect(findForbiddenIdentifier('function handle(packet: ContextPacket) {}')).toBe('ContextPacket');
  });

  it('does not flag ordinary governed source', () => {
    expect(findForbiddenImport("import type { NodeId } from '../domain/ids.js';")).toBeUndefined();
    expect(findForbiddenIdentifier('export interface FactPayload { statement: string }')).toBeUndefined();
  });
});

describe('package boundary: @algerknown/governed stays application-independent', () => {
  const files = collectTsFiles(srcRoot);

  it('scans a non-trivial number of source files (guards against a vacuous pass)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    const label = path.relative(srcRoot, file);

    it(`${label} imports no forbidden module and references no forbidden concept`, () => {
      const content = readFileSync(file, 'utf8');
      expect(findForbiddenImport(content)).toBeUndefined();
      expect(findForbiddenIdentifier(content)).toBeUndefined();
    });
  }
});
