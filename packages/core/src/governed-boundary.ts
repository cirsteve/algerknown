/**
 * Governed write boundary
 *
 * Dependency-free reader for the runtime manifest that the web governance
 * composition root generates at `<kbRoot>/.algerknown/governed-boundary.json`.
 * This module has no dependency on @algerknown/governed -- it only reads the
 * plain JSON manifest that package writes out, so @algerknown/core never
 * takes on a dependency in the other direction.
 *
 * The manifest lists every file path that is governed (may only be mutated
 * through the governance write API). Anything not listed is classified
 * legacy_ungoverned: Phase 2 has not migrated every historical Algerknown
 * artifact, so store/linker writes to those paths remain permitted, but
 * callers get an explicit warning rather than silent unmigrated behavior.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const GOVERNED_BOUNDARY_MANIFEST_RELATIVE_PATH = path.join('.algerknown', 'governed-boundary.json');

export type WriteBoundaryClassification = 'governed' | 'legacy_ungoverned';

export interface GovernedBoundaryManifest {
  version: number;
  generatedAt: string;
  /** POSIX-style paths relative to the knowledge base root. */
  managedPaths: string[];
  /** Managed path -> governed namespace id, for the paths in managedPaths. */
  namespaces: Record<string, string>;
}

export interface WriteBoundaryClassificationResult {
  classification: WriteBoundaryClassification;
  relativePath: string;
  namespace?: string;
}

export class GovernedWriteBoundaryError extends Error {
  readonly relativePath: string;
  readonly namespace?: string;

  constructor(relativePath: string, namespace?: string) {
    super(
      `path "${relativePath}" is governed${namespace ? ` (namespace "${namespace}")` : ''} and can only be ` +
        'mutated through the governance write API, not directly',
    );
    this.name = 'GovernedWriteBoundaryError';
    this.relativePath = relativePath;
    this.namespace = namespace;
  }
}

function toPosixRelative(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

/**
 * Reads the runtime manifest. Returns null if it does not exist or is
 * malformed -- callers then treat every path as legacy_ungoverned, matching
 * behavior before the governance composition root has ever run.
 */
export function loadGovernedBoundaryManifest(root: string): GovernedBoundaryManifest | null {
  const manifestPath = path.join(root, GOVERNED_BOUNDARY_MANIFEST_RELATIVE_PATH);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<GovernedBoundaryManifest>;
    if (!parsed || !Array.isArray(parsed.managedPaths)) {
      return null;
    }
    return {
      version: parsed.version ?? 1,
      generatedAt: parsed.generatedAt ?? '',
      managedPaths: parsed.managedPaths,
      namespaces: parsed.namespaces ?? {},
    };
  } catch {
    return null;
  }
}

/**
 * Classifies an absolute path as governed or legacy_ungoverned relative to
 * `root`. Pass an already-loaded manifest to avoid re-reading it on every
 * call in a tight loop; otherwise it is loaded fresh each time.
 */
export function classifyWriteTarget(
  root: string,
  absolutePath: string,
  manifest: GovernedBoundaryManifest | null = loadGovernedBoundaryManifest(root),
): WriteBoundaryClassificationResult {
  const relativePath = toPosixRelative(root, absolutePath);
  if (manifest && manifest.managedPaths.includes(relativePath)) {
    return { classification: 'governed', relativePath, namespace: manifest.namespaces[relativePath] };
  }
  return { classification: 'legacy_ungoverned', relativePath };
}

/**
 * Throws GovernedWriteBoundaryError before any file is opened or changed if
 * the target is governed; otherwise emits an explicit legacy-ungoverned
 * warning and returns normally.
 */
export function assertWriteAllowed(
  root: string,
  absolutePath: string,
  manifest: GovernedBoundaryManifest | null = loadGovernedBoundaryManifest(root),
): void {
  const result = classifyWriteTarget(root, absolutePath, manifest);
  if (result.classification === 'governed') {
    throw new GovernedWriteBoundaryError(result.relativePath, result.namespace);
  }
  console.warn(`[algerknown/core] legacy_ungoverned write: ${result.relativePath}`);
}
