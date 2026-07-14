import type { NamespaceId, NodeId, SubjectId } from './ids.js';
import type { Provenance } from './provenance.js';
import type { RevisionMeta } from './revision.js';

export type NodeType =
  | 'fact'
  | 'resource'
  | 'prohibition'
  | 'observation'
  | 'interaction'
  | 'decision'
  | 'proposal';

export const NODE_TYPES: readonly NodeType[] = [
  'fact',
  'resource',
  'prohibition',
  'observation',
  'interaction',
  'decision',
  'proposal',
];

/** The two structurally protected, externally-stateable truth types plus resource. */
export const CANONICAL_ONLY_NODE_TYPES: readonly NodeType[] = ['fact', 'resource', 'prohibition'];

export interface FactPayload {
  statement: string;
  attributes?: Record<string, unknown>;
}

export interface ResourcePayload {
  locator: string;
  label?: string;
  kind?: string;
}

export interface ProhibitionPayload {
  rule: string;
  scope?: string;
}

export interface ObservationPayload {
  description: string;
  observedAt?: string;
  context?: Record<string, unknown>;
}

export interface InteractionPayload {
  summary: string;
  participants?: string[];
  occurredAt?: string;
}

export interface DecisionPayload {
  statement: string;
  rationale?: string;
  alternatives?: string[];
}

export interface ProposalNodePayload {
  proposalId: string;
  summary: string;
}

export interface GovernedNodeBase<TType extends NodeType, TPayload> {
  id: NodeId;
  type: TType;
  namespace: NamespaceId;
  subject: SubjectId;
  payload: TPayload;
  confidence: number;
  provenance: Provenance;
  revision: RevisionMeta;
}

export type GovernedNode =
  | GovernedNodeBase<'fact', FactPayload>
  | GovernedNodeBase<'resource', ResourcePayload>
  | GovernedNodeBase<'prohibition', ProhibitionPayload>
  | GovernedNodeBase<'observation', ObservationPayload>
  | GovernedNodeBase<'interaction', InteractionPayload>
  | GovernedNodeBase<'decision', DecisionPayload>
  | GovernedNodeBase<'proposal', ProposalNodePayload>;

export type NodePayloadOf<TType extends NodeType> = Extract<GovernedNode, { type: TType }>['payload'];

export interface NodeCreateInput {
  id: NodeId;
  type: NodeType;
  namespace: NamespaceId;
  subject: SubjectId;
  payload: Record<string, unknown>;
  confidence: number;
  provenanceInputSources: Provenance['sources'];
}

export interface NodePatchInput {
  payload?: Record<string, unknown>;
  confidence?: number;
}
