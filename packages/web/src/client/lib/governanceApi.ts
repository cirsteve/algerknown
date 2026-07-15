/**
 * Typed client for /api/governance -- the durable proposal review API.
 *
 * This module never defines request fields for reviewer identity, time,
 * authoritative mutation content, attestation, rail, verdict, or mutation
 * hash: the server derives every one of those from the authenticated
 * session and the persisted proposal version. The browser only ever sends
 * a proposal id, an expected version/revision, a note/reason, a JSON Patch
 * (for amend), and an idempotency key.
 */

export type GovernanceFetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type DurableProposalStatus = 'pending' | 'accepted' | 'rejected' | 'expired' | 'deleted';

const STABLE_ERROR_CODES = [
  'not_found',
  'invalid_request',
  'conflict',
  'version_conflict',
  'target_revision_conflict',
  'idempotency_key_reused',
  'rejected',
  'operation_in_progress',
  'invalid_patch',
  'unauthorized',
] as const;
export type GovernanceApiErrorCode = (typeof STABLE_ERROR_CODES)[number] | 'unknown';

export class GovernanceApiError extends Error {
  readonly code: GovernanceApiErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown> | undefined) {
    const rawCode = typeof body?.error === 'string' ? body.error : undefined;
    const code = (STABLE_ERROR_CODES as readonly string[]).includes(rawCode ?? '') ? (rawCode as GovernanceApiErrorCode) : 'unknown';
    const message = typeof body?.message === 'string' ? body.message : `governance API error: ${code} (${status})`;
    super(message);
    this.name = 'GovernanceApiError';
    this.code = code;
    this.status = status;
    this.details = body ?? {};
  }
}

export interface SourceReference {
  kind: string;
  id: string;
  locator?: string;
}

export interface EvaluatorVerdict {
  evaluator: string;
  passed: boolean;
  reasonCodes: string[];
  detail?: Record<string, unknown>;
}

export interface Provenance {
  sources: SourceReference[];
  processorId?: string;
  processorVersion?: string;
  railId: string;
  evaluatorVerdicts: EvaluatorVerdict[];
  sourceDerived?: boolean;
}

export type NodeMutation =
  | { op: 'create'; nodeId: string; nodeType: string; payload: Record<string, unknown>; confidence: number }
  | { op: 'update'; nodeId: string; payload?: Record<string, unknown>; confidence?: number }
  | { op: 'delete'; nodeId: string }
  | { op: 'revert'; nodeId: string; targetRevisionId: string };

export type EdgeMutation =
  | { op: 'create'; edgeId: string; kind: string; sourceId: string; targetId: string }
  | { op: 'update'; edgeId: string; kind: string }
  | { op: 'delete'; edgeId: string }
  | { op: 'revert'; edgeId: string; targetRevisionId: string };

export interface CanonicalMutation {
  namespace: string;
  subject: string;
  nodeMutations: NodeMutation[];
  edgeMutations: EdgeMutation[];
  expectedNamespaceRevision: number | null;
  idempotencyKey: string;
  actorId: string;
  actorClass: 'human' | 'processor';
  provenanceInput: {
    sources: SourceReference[];
    processorId?: string;
    processorVersion?: string;
    sourceDerived?: boolean;
  };
}

export interface ProposalEvent {
  eventId: string;
  proposalId: string;
  kind: string;
  at: string;
  actorId?: string;
  proposalVersion?: number;
  reason?: string;
  note?: string;
  channel?: string;
  reviewBatchId?: string;
  detail?: Record<string, unknown>;
}

export interface ReversalInfo {
  reversalId: string;
  proposalId: string;
  originalRevision: number;
  newRevision: number;
  actorId: string;
  channel: string | null;
  reason: string;
  createdAt: string;
}

export interface ProposalQueueItem {
  id: string;
  targetNamespace: string;
  targetSubject: string;
  status: DurableProposalStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  resultingRevision: number | null;
  reverted: boolean;
}

export interface ProposalQueuePage {
  items: ProposalQueueItem[];
  nextCursor: string | null;
}

export interface ProposalDetail {
  id: string;
  status: DurableProposalStatus;
  version: number;
  targetNamespace: string;
  targetSubject: string;
  currentTargetRevision: number | null;
  expectedTargetRevision: number | null;
  canonicalMutation: CanonicalMutation;
  mutationHash: string;
  fingerprint: string;
  supportingObservationIds: string[];
  provenance: Provenance;
  conflict: { stale: boolean };
  resultingRevision: number | null;
  reverted: boolean;
  reversal: ReversalInfo | null;
  events: ProposalEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface FieldChange {
  path: string;
  before: unknown;
  after: unknown;
}

export interface NodeLevelDiff {
  entityKind: 'node' | 'edge';
  entityId: string;
  changeKind: 'create' | 'update' | 'delete' | 'revert';
  forward: FieldChange[];
  inverse: FieldChange[];
}

export interface RevisionRecord {
  namespace: string;
  revisionId: string;
  previousRevision: number | null;
  namespaceRevision: number;
  createdAt: string;
  actorId: string;
  actorClass: 'human' | 'processor';
  diff: NodeLevelDiff[];
  idempotencyKey: string;
}

export interface NodeHistoryResponse {
  revisions: RevisionRecord[];
}

export interface JsonPatchAddOrReplace {
  op: 'add' | 'replace' | 'test';
  path: string;
  value: unknown;
}
export interface JsonPatchRemove {
  op: 'remove';
  path: string;
}
export interface JsonPatchMoveOrCopy {
  op: 'move' | 'copy';
  path: string;
  from: string;
}
export type JsonPatchOp = JsonPatchAddOrReplace | JsonPatchRemove | JsonPatchMoveOrCopy;

export interface ProposalQueueFilters {
  status?: DurableProposalStatus;
  namespace?: string;
  subject?: string;
  cursor?: string;
  limit?: number;
}

export interface AmendResult {
  id: string;
  version: number;
  status: DurableProposalStatus;
}

export type AcceptResult = { status: 'accepted'; resultingRevision: number };

export interface LifecycleResult {
  id: string;
  version: number;
  status: DurableProposalStatus;
}

export type RevertResult = { status: 'reverted'; newRevision: number };

async function requestJson<T>(fetcher: GovernanceFetcher, input: string, init?: RequestInit): Promise<T> {
  const res = await fetcher(input, init);
  let body: Record<string, unknown> | undefined;
  try {
    body = res.status === 204 ? undefined : ((await res.json()) as Record<string, unknown>);
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    throw new GovernanceApiError(res.status, body);
  }
  return body as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const governanceApi = {
  listProposals: (fetcher: GovernanceFetcher, filters: ProposalQueueFilters = {}) =>
    requestJson<ProposalQueuePage>(
      fetcher,
      `/api/governance/proposals${qs({
        status: filters.status,
        namespace: filters.namespace,
        subject: filters.subject,
        cursor: filters.cursor,
        limit: filters.limit,
      })}`,
    ),

  getProposal: (fetcher: GovernanceFetcher, id: string) => requestJson<ProposalDetail>(fetcher, `/api/governance/proposals/${encodeURIComponent(id)}`),

  getProposalHistory: (fetcher: GovernanceFetcher, id: string) =>
    requestJson<{ events: ProposalEvent[] }>(fetcher, `/api/governance/proposals/${encodeURIComponent(id)}/history`),

  getNodeHistory: (fetcher: GovernanceFetcher, namespace: string, entityId: string) =>
    requestJson<NodeHistoryResponse>(fetcher, `/api/governance/nodes/${encodeURIComponent(entityId)}/history${qs({ namespace })}`),

  amendProposal: (fetcher: GovernanceFetcher, id: string, input: { expectedVersion: number; patch: JsonPatchOp[]; idempotencyKey: string }) =>
    requestJson<AmendResult>(fetcher, `/api/governance/proposals/${encodeURIComponent(id)}/amend`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  acceptProposal: (
    fetcher: GovernanceFetcher,
    id: string,
    input: { expectedVersion: number; expectedTargetRevision: number | null; reviewNote?: string; reviewBatchId?: string; idempotencyKey: string },
  ) =>
    requestJson<AcceptResult>(fetcher, `/api/governance/proposals/${encodeURIComponent(id)}/accept`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  rejectProposal: (fetcher: GovernanceFetcher, id: string, input: { expectedVersion: number; reason: string; idempotencyKey: string }) =>
    requestJson<LifecycleResult>(fetcher, `/api/governance/proposals/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  expireProposal: (fetcher: GovernanceFetcher, id: string, input: { expectedVersion: number; note: string; idempotencyKey: string }) =>
    requestJson<LifecycleResult>(fetcher, `/api/governance/proposals/${encodeURIComponent(id)}/expire`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteProposal: (fetcher: GovernanceFetcher, id: string, input: { expectedVersion: number; reason: string; idempotencyKey: string }) =>
    requestJson<LifecycleResult>(fetcher, `/api/governance/proposals/${encodeURIComponent(id)}/delete`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  revertProposal: (fetcher: GovernanceFetcher, id: string, input: { reason: string; idempotencyKey: string }) =>
    requestJson<RevertResult>(fetcher, `/api/governance/proposals/${encodeURIComponent(id)}/revert`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};

/** One cryptographically random idempotency key per action-dialog/amendment-draft lifetime. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
