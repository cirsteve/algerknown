import { contentHash } from './canonical.js';
import type { NamespaceId, NodeId, SubjectId } from '../domain/ids.js';
import type { SourceReference } from '../domain/provenance.js';
import type { EdgeMutation, NodeMutation } from '../domain/write-command.js';

export interface ProposalFingerprintInput {
  targetNamespace: NamespaceId;
  targetSubject: SubjectId;
  nodeMutations: NodeMutation[];
  edgeMutations: EdgeMutation[];
  supportingObservationIds: NodeId[];
  sourceReferences: SourceReference[];
}

/**
 * Identity of a proposal candidate independent of its proposal id, timestamps,
 * version, expected revision, or idempotency key: two candidates with the
 * same target, mutation shape, supporting evidence, and sources fingerprint
 * identically, which is what lets a retried candidate be recognized as the
 * same one instead of creating a duplicate.
 */
export function computeProposalFingerprint(input: ProposalFingerprintInput): string {
  const sortedObservationIds = [...input.supportingObservationIds].sort();
  const normalizedSources = [...input.sourceReferences]
    .map((s) => ({ kind: s.kind, id: s.id, locator: s.locator ?? null }))
    .sort((a, b) => `${a.kind}:${a.id}:${a.locator ?? ''}`.localeCompare(`${b.kind}:${b.id}:${b.locator ?? ''}`));

  return contentHash({
    targetNamespace: input.targetNamespace,
    targetSubject: input.targetSubject,
    nodeMutations: input.nodeMutations,
    edgeMutations: input.edgeMutations,
    supportingObservationIds: sortedObservationIds,
    sourceReferences: normalizedSources,
  });
}
