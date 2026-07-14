import type { EventId, MutationHash, NamespaceId, NodeId, ProposalId, SubjectId } from './ids.js';
import type { Provenance } from './provenance.js';
import type { WriteCommand } from './write-command.js';

export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'superseded';

export interface ProposalEventRef {
  eventId: EventId;
  kind: string;
  at: string;
}

/**
 * Versioned aggregate independent of the optional 'proposal' graph node.
 * The canonical mutation is the authoritative, already-normalized command;
 * attestations bind to its mutationHash and version, not to any rendering.
 */
export interface Proposal {
  id: ProposalId;
  canonicalMutation: WriteCommand;
  mutationHash: MutationHash;
  targetNamespace: NamespaceId;
  targetSubject: SubjectId;
  expectedTargetRevision: number | null;
  supportingObservationIds: NodeId[];
  provenance: Provenance;
  version: number;
  status: ProposalStatus;
  events: ProposalEventRef[];
}
