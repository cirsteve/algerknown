import type { MutationHash, NamespaceId, ProposalId } from '../domain/ids.js';
import type { Proposal } from '../domain/proposal.js';

export interface ProposalRepository {
  save(proposal: Proposal): Promise<void>;
  get(proposalId: ProposalId): Promise<Proposal | undefined>;
  findPendingByMutationHash(namespace: NamespaceId, hash: MutationHash): Promise<Proposal | undefined>;
}
