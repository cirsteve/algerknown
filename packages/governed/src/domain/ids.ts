declare const brandTag: unique symbol;

export type Branded<TValue, TBrand extends string> = TValue & {
  readonly [brandTag]: TBrand;
};

function brand<TBrand extends string>(value: string): Branded<string, TBrand> {
  return value as Branded<string, TBrand>;
}

export type NodeId = Branded<string, 'NodeId'>;
export type EdgeId = Branded<string, 'EdgeId'>;
export type NamespaceId = Branded<string, 'NamespaceId'>;
export type SubjectId = Branded<string, 'SubjectId'>;
export type ActorId = Branded<string, 'ActorId'>;
export type ProcessorId = Branded<string, 'ProcessorId'>;
export type ProposalId = Branded<string, 'ProposalId'>;
export type RevisionId = Branded<string, 'RevisionId'>;
export type AttestationId = Branded<string, 'AttestationId'>;
export type IdempotencyKey = Branded<string, 'IdempotencyKey'>;
export type MutationHash = Branded<string, 'MutationHash'>;
export type OperationId = Branded<string, 'OperationId'>;
export type EventId = Branded<string, 'EventId'>;

export const asNodeId = (value: string): NodeId => brand<'NodeId'>(value);
export const asEdgeId = (value: string): EdgeId => brand<'EdgeId'>(value);
export const asNamespaceId = (value: string): NamespaceId => brand<'NamespaceId'>(value);
export const asSubjectId = (value: string): SubjectId => brand<'SubjectId'>(value);
export const asActorId = (value: string): ActorId => brand<'ActorId'>(value);
export const asProcessorId = (value: string): ProcessorId => brand<'ProcessorId'>(value);
export const asProposalId = (value: string): ProposalId => brand<'ProposalId'>(value);
export const asRevisionId = (value: string): RevisionId => brand<'RevisionId'>(value);
export const asAttestationId = (value: string): AttestationId => brand<'AttestationId'>(value);
export const asIdempotencyKey = (value: string): IdempotencyKey => brand<'IdempotencyKey'>(value);
export const asMutationHash = (value: string): MutationHash => brand<'MutationHash'>(value);
export const asOperationId = (value: string): OperationId => brand<'OperationId'>(value);
export const asEventId = (value: string): EventId => brand<'EventId'>(value);
