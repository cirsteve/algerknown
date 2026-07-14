import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DossierBinding } from '@algerknown/governed/adapters/algerknown';

export class NamespaceBindingsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NamespaceBindingsConfigError';
  }
}

interface NamespaceBindingsFile {
  dossiers?: DossierBinding[];
}

function isValidBinding(value: unknown): value is DossierBinding {
  if (!value || typeof value !== 'object') return false;
  const b = value as Record<string, unknown>;
  return typeof b.projectKey === 'string' && typeof b.summaryId === 'string' && typeof b.path === 'string';
}

/**
 * Reads the explicit Algerknown namespace mappings (dossier bindings) that
 * determine which canonical.project.* namespaces are governed via git.
 * Missing file -> no git-backed namespaces configured yet (an empty KB or a
 * deployment that hasn't migrated any dossier). Malformed file fails closed.
 */
export function loadNamespaceBindings(bindingsPath: string): DossierBinding[] {
  if (!fs.existsSync(bindingsPath)) {
    return [];
  }
  let parsed: NamespaceBindingsFile;
  try {
    parsed = JSON.parse(fs.readFileSync(bindingsPath, 'utf-8')) as NamespaceBindingsFile;
  } catch (err) {
    throw new NamespaceBindingsConfigError(`namespace bindings file "${bindingsPath}" is not valid JSON: ${(err as Error).message}`);
  }
  const dossiers = parsed.dossiers ?? [];
  if (!Array.isArray(dossiers) || !dossiers.every(isValidBinding)) {
    throw new NamespaceBindingsConfigError(
      `namespace bindings file "${bindingsPath}" must be { "dossiers": [{ projectKey, summaryId, path }, ...] }`,
    );
  }
  const seenProjectKeys = new Set<string>();
  for (const binding of dossiers) {
    if (seenProjectKeys.has(binding.projectKey)) {
      throw new NamespaceBindingsConfigError(`namespace bindings file "${bindingsPath}" has a duplicate projectKey "${binding.projectKey}"`);
    }
    seenProjectKeys.add(binding.projectKey);
  }
  return dossiers;
}

export function defaultNamespaceBindingsPath(algerknownRoot: string): string {
  return path.join(algerknownRoot, '.algerknown', 'governed-namespaces.json');
}
