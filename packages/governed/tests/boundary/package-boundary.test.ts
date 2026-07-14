import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
 * Application-independence is the deliverable: @algerknown/governed's domain,
 * rails, ports, config, write, and read-model modules must never import the
 * existing dossier representation, Scout, community-application schemas,
 * grading concepts, platform clients, or a concrete backend implementation.
 * Ports abstract all of that away for later cohorts.
 *
 * The one deliberate exception is src/adapters/algerknown/**: that adapter's
 * whole job is to translate the existing Algerknown dossier representation
 * into governed nodes/edges, so it is allowed (and expected) to depend on
 * @algerknown/core and to reference `Dossier`. See ADAPTER_EXEMPT_DIR below.
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

/** Relative to srcRoot. The only directory permitted to import @algerknown/core or reference Dossier. */
const ADAPTER_EXEMPT_DIR = `adapters${path.sep}algerknown`;

function isExempt(label: string): boolean {
  return label === ADAPTER_EXEMPT_DIR || label.startsWith(`${ADAPTER_EXEMPT_DIR}${path.sep}`);
}

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
  const files = collectTsFiles(srcRoot).filter((file) => !isExempt(path.relative(srcRoot, file)));

  it('scans a non-trivial number of source files (guards against a vacuous pass)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('the exemption does not vacuously swallow the whole source tree', () => {
    const adapterDir = path.join(srcRoot, 'adapters', 'algerknown');
    if (!existsSync(adapterDir)) return; // exemption is a no-op until the adapter lands
    expect(collectTsFiles(srcRoot).length).toBeGreaterThan(files.length);
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

describe('package boundary: the algerknown adapter is deliberately exempt', () => {
  it('is allowed to depend on @algerknown/core and reference Dossier', () => {
    expect(
      findForbiddenImport("import type { Dossier, Summary } from '@algerknown/core';"),
    ).toBe('@algerknown/core');
    // The exemption is directory-scoped, not a change to the scanner itself --
    // the scanner still flags the same content; adapters/algerknown files are
    // simply excluded from the enumeration above.
  });

  it('every adapters/algerknown/*.ts file that exists is excluded from the application-independence scan', () => {
    const adapterDir = path.join(srcRoot, 'adapters', 'algerknown');
    if (!existsSync(adapterDir)) return;
    const adapterFiles = collectTsFiles(adapterDir);
    const scannedFiles = collectTsFiles(srcRoot).filter((file) => !isExempt(path.relative(srcRoot, file)));
    for (const file of adapterFiles) {
      expect(scannedFiles).not.toContain(file);
    }
  });
});
