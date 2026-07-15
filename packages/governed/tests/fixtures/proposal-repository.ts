import type { MutationHash, NamespaceId, Proposal, ProposalId, ProposalRepository } from '../../src/index.js';

export class InMemoryProposalRepository implements ProposalRepository {
  private readonly byId = new Map<ProposalId, Proposal>();

  async save(proposal: Proposal): Promise<void> {
    this.byId.set(proposal.id, proposal);
  }

  async get(proposalId: ProposalId): Promise<Proposal | undefined> {
    return this.byId.get(proposalId);
  }

  async findPendingByMutationHash(namespace: NamespaceId, hash: MutationHash): Promise<Proposal | undefined> {
    for (const proposal of this.byId.values()) {
      if (proposal.targetNamespace === namespace && proposal.mutationHash === hash && proposal.status === 'pending') {
        return proposal;
      }
    }
    return undefined;
  }
}
