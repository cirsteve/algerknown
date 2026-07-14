import * as fs from 'node:fs';
import * as path from 'node:path';
import { GOVERNED_BOUNDARY_MANIFEST_RELATIVE_PATH } from '@algerknown/core';
import type { GovernedBoundaryManifest } from '@algerknown/core';
import { namespaceForBinding, sidecarRelativePath, type DossierBinding } from '@algerknown/governed/adapters/algerknown';

/**
 * Builds and writes the runtime boundary manifest @algerknown/core reads to
 * classify a write target as governed or legacy_ungoverned. Regenerated on
 * every composition-root startup from the current namespace bindings, so it
 * always reflects exactly what this process is authoritative for -- never
 * hand-edited, never stale relative to the running server's configuration.
 */
export function buildGovernedBoundaryManifest(bindings: DossierBinding[], generatedAt: string): GovernedBoundaryManifest {
  const managedPaths: string[] = [];
  const namespaces: Record<string, string> = {};

  for (const binding of bindings) {
    const namespace = String(namespaceForBinding(binding));
    const dossierPath = binding.path;
    const sidecarPath = sidecarRelativePath(namespaceForBinding(binding));
    managedPaths.push(dossierPath, sidecarPath);
    namespaces[dossierPath] = namespace;
    namespaces[sidecarPath] = namespace;
  }

  return { version: 1, generatedAt, managedPaths, namespaces };
}

export function writeGovernedBoundaryManifest(algerknownRoot: string, manifest: GovernedBoundaryManifest): void {
  const manifestPath = path.join(algerknownRoot, GOVERNED_BOUNDARY_MANIFEST_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}
