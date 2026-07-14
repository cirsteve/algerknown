import type { ProposalId } from './ids.js';
import type { ReasonCode } from './reason-codes.js';
import type { EvaluatorVerdict } from './provenance.js';
import type { AuditDirective, NodeLevelDiff } from './revision.js';

export interface AppliedWriteResult {
  outcome: 'applied';
  previousRevision: number | null;
  resultingRevision: number;
  diff: NodeLevelDiff[];
  auditDirective?: AuditDirective;
}

export interface RejectedWriteResult {
  outcome: 'rejected';
  reasonCodes: ReasonCode[];
  evaluatorVerdicts: EvaluatorVerdict[];
}

export interface RoutedToProposalWriteResult {
  outcome: 'routed_to_proposal';
  proposalId: ProposalId;
  reasonCodes: ReasonCode[];
  evaluatorVerdicts: EvaluatorVerdict[];
}

export interface ConflictWriteResult {
  outcome: 'conflict';
  reasonCodes: ReasonCode[];
  expectedRevision: number | null;
  actualRevision: number;
}

export type NonReplayWriteResult =
  | AppliedWriteResult
  | RejectedWriteResult
  | RoutedToProposalWriteResult
  | ConflictWriteResult;

export interface IdempotentReplayWriteResult {
  outcome: 'idempotent_replay';
  original: NonReplayWriteResult;
}

export type WriteResult = NonReplayWriteResult | IdempotentReplayWriteResult;
