import { asNamespaceId, asSubjectId } from '../../domain/ids.js';
import type { NamespaceId, SubjectId } from '../../domain/ids.js';

/**
 * Explicit binding of one adapted dossier to the file it already lives in.
 * Nothing here is inferred or scanned for -- the caller states the project
 * key, the Summary id, and the existing indexed file path so dossier
 * identity and file history are preserved exactly as-is.
 */
export interface DossierBinding {
  /** The dossier's project_key; determines the governed namespace. */
  projectKey: string;
  /** The containing Summary's id; determines the governed subject. */
  summaryId: string;
  /** Path to the existing indexed Summary YAML file, relative to the repository root. */
  path: string;
}

export function namespaceForBinding(binding: DossierBinding): NamespaceId {
  return asNamespaceId(`canonical.project.${binding.projectKey}`);
}

export function subjectForBinding(binding: DossierBinding): SubjectId {
  return asSubjectId(`algerknown.summary:${binding.summaryId}:dossier`);
}

/** Current mapping-version stamp, recorded in the namespace sidecar. Bump on any lossy-to-lossless mapping change. */
export const ADAPTER_MAPPING_VERSION = 1;
