import { useCallback } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { useGovernanceAuth } from '../auth';
import {
  governanceApi,
  newIdempotencyKey,
  type JsonPatchOp,
  type ProposalDetail,
  type ProposalQueueFilters,
  type ProposalQueuePage,
  type NodeHistoryResponse,
} from '../lib/governanceApi';

const QUEUE_KEY = 'governance:queue';
const PROPOSAL_KEY = 'governance:proposal';
const NODE_HISTORY_KEY = 'governance:node-history';

const QUEUE_POLL_MS = 15_000;

function queueKey(filters: ProposalQueueFilters) {
  return [QUEUE_KEY, filters.status ?? null, filters.namespace ?? null, filters.subject ?? null, filters.cursor ?? null, filters.limit ?? null] as const;
}

export function useProposalQueue(filters: ProposalQueueFilters) {
  const { governanceFetch, status } = useGovernanceAuth();
  const { data, error, isLoading, mutate } = useSWR<ProposalQueuePage>(
    status === 'unlocked' ? queueKey(filters) : null,
    () => governanceApi.listProposals(governanceFetch, filters),
    { refreshInterval: QUEUE_POLL_MS, revalidateOnFocus: false },
  );

  return { page: data ?? null, error: error ?? null, isLoading, mutate };
}

export function useProposalDetail(id: string | null, options: { paused?: boolean } = {}) {
  const { governanceFetch, status } = useGovernanceAuth();
  const { data, error, isLoading, mutate } = useSWR<ProposalDetail>(
    id && status === 'unlocked' ? [PROPOSAL_KEY, id] : null,
    () => governanceApi.getProposal(governanceFetch, id!),
    { refreshInterval: options.paused ? 0 : QUEUE_POLL_MS, revalidateOnFocus: false },
  );

  return { proposal: data ?? null, error: error ?? null, isLoading, mutate };
}

export function useNodeHistory(namespace: string | null, entityId: string | null) {
  const { governanceFetch, status } = useGovernanceAuth();
  const { data, error, isLoading } = useSWR<NodeHistoryResponse>(
    namespace && entityId && status === 'unlocked' ? [NODE_HISTORY_KEY, namespace, entityId] : null,
    () => governanceApi.getNodeHistory(governanceFetch, namespace!, entityId!),
    { revalidateOnFocus: false },
  );

  return { revisions: data?.revisions ?? null, error: error ?? null, isLoading };
}

/**
 * Maps namespaceRevision -> proposalId for every accepted proposal in a
 * namespace. There is no direct "proposal for this revision" endpoint, so
 * history views cross-reference this way instead of an id lookup per
 * revision.
 */
export function useAcceptedRevisionIndex(namespace: string | null) {
  const { governanceFetch, status } = useGovernanceAuth();
  const { data } = useSWR<ProposalQueuePage>(
    namespace && status === 'unlocked' ? [QUEUE_KEY, 'accepted', namespace, null, null, 200] : null,
    () => governanceApi.listProposals(governanceFetch, { status: 'accepted', namespace: namespace!, limit: 200 }),
    { revalidateOnFocus: false },
  );
  const index = new Map<number, string>();
  for (const item of data?.items ?? []) {
    if (item.resultingRevision !== null) index.set(item.resultingRevision, item.id);
  }
  return index;
}

/**
 * Invalidates every cached queue page (including the accepted-revision
 * index used for history cross-referencing), the given proposal's detail,
 * and every cached node-history entry after a durable mutation -- accept
 * and revert can both change what a node's revision history and the
 * ChangesPage/Entry views backed by it should show.
 */
async function invalidateAfterAction(id: string) {
  await globalMutate((key) => Array.isArray(key) && (key[0] === QUEUE_KEY || key[0] === NODE_HISTORY_KEY || (key[0] === PROPOSAL_KEY && key[1] === id)));
}

export function useProposalActions(id: string) {
  const { governanceFetch } = useGovernanceAuth();

  const amend = useCallback(
    async (input: { expectedVersion: number; patch: JsonPatchOp[]; idempotencyKey: string }) => {
      const result = await governanceApi.amendProposal(governanceFetch, id, input);
      await invalidateAfterAction(id);
      return result;
    },
    [governanceFetch, id],
  );

  const accept = useCallback(
    async (input: { expectedVersion: number; expectedTargetRevision: number | null; reviewNote: string; idempotencyKey: string }) => {
      const result = await governanceApi.acceptProposal(governanceFetch, id, input);
      await invalidateAfterAction(id);
      return result;
    },
    [governanceFetch, id],
  );

  const reject = useCallback(
    async (input: { expectedVersion: number; reason: string; idempotencyKey: string }) => {
      const result = await governanceApi.rejectProposal(governanceFetch, id, input);
      await invalidateAfterAction(id);
      return result;
    },
    [governanceFetch, id],
  );

  const expire = useCallback(
    async (input: { expectedVersion: number; note: string; idempotencyKey: string }) => {
      const result = await governanceApi.expireProposal(governanceFetch, id, input);
      await invalidateAfterAction(id);
      return result;
    },
    [governanceFetch, id],
  );

  const deleteProposal = useCallback(
    async (input: { expectedVersion: number; reason: string; idempotencyKey: string }) => {
      const result = await governanceApi.deleteProposal(governanceFetch, id, input);
      await invalidateAfterAction(id);
      return result;
    },
    [governanceFetch, id],
  );

  const revert = useCallback(
    async (input: { reason: string; idempotencyKey: string }) => {
      const result = await governanceApi.revertProposal(governanceFetch, id, input);
      await invalidateAfterAction(id);
      return result;
    },
    [governanceFetch, id],
  );

  return { amend, accept, reject, expire, delete: deleteProposal, revert };
}

/** Forces every cached queue page to revalidate now, e.g. right after an ingest job durably persists new proposals. */
export async function revalidateProposalQueue() {
  await globalMutate((key) => Array.isArray(key) && key[0] === QUEUE_KEY);
}

export { newIdempotencyKey };
