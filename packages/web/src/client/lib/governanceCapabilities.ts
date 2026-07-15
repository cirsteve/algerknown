import type { ProposalDetail } from './governanceApi';

/**
 * The API does not (yet) publish an explicit per-proposal capabilities
 * object, so these are derived client-side from the durable lifecycle rules
 * documented on DurableProposalStatus. This is advisory only -- every action
 * still round-trips through the server's own transition/authorization
 * checks (ProposalInvalidTransitionError, etc.), so a wrong guess here can
 * only hide a control the server would have allowed, never permit one it
 * would have rejected.
 */
export interface ProposalCapabilities {
  canAmend: boolean;
  canAccept: boolean;
  canReject: boolean;
  canExpire: boolean;
  canDelete: boolean;
  canRevert: boolean;
}

export function proposalCapabilities(proposal: Pick<ProposalDetail, 'status' | 'reverted' | 'resultingRevision'>): ProposalCapabilities {
  const pending = proposal.status === 'pending';
  return {
    canAmend: pending,
    canAccept: pending,
    canReject: pending,
    canExpire: pending,
    canDelete: pending,
    canRevert: proposal.status === 'accepted' && !proposal.reverted && proposal.resultingRevision !== null,
  };
}
