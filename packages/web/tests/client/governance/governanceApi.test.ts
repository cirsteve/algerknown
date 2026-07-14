import { describe, expect, it } from 'vitest';
import { governanceApi, GovernanceApiError, newIdempotencyKey } from '../../../src/client/lib/governanceApi';
import { buildAmendmentPatch } from '../../../src/client/lib/governanceAmend';
import { pendingProposalDetail, PENDING_PROPOSAL_ID } from '../fixtures/proposal';
import { server } from '../mocks/server';
import { http, HttpResponse } from 'msw';

const fetcher = (input: string, init?: RequestInit) => fetch(input, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });

describe('governanceApi', () => {
  it('lists the pending proposal queue', async () => {
    const page = await governanceApi.listProposals(fetcher, { status: 'pending' });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.id).toBe(PENDING_PROPOSAL_ID);
  });

  it('fetches full proposal detail with provenance, verdicts, and diff', async () => {
    const detail = await governanceApi.getProposal(fetcher, PENDING_PROPOSAL_ID);
    expect(detail.provenance.evaluatorVerdicts).toHaveLength(4);
    expect(detail.canonicalMutation.nodeMutations).toHaveLength(3);
    expect(detail.supportingObservationIds).toEqual(['entry-observation:entry-1']);
  });

  it('fetches node-level governed history', async () => {
    const history = await governanceApi.getNodeHistory(fetcher, 'memory.project.demo', 'node-1');
    expect(history.revisions).toHaveLength(1);
    expect(history.revisions[0]!.diff[0]!.entityId).toBe('node-1');
  });

  it('surfaces a 404 as a typed not_found error', async () => {
    await expect(governanceApi.getProposal(fetcher, 'missing')).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('surfaces a 409 version_conflict with expected/actual versions in details', async () => {
    server.use(
      http.post('/api/governance/proposals/:id/accept', () => HttpResponse.json({ error: 'version_conflict', expectedVersion: 1, actualVersion: 2 }, { status: 409 })),
    );
    const err = await governanceApi
      .acceptProposal(fetcher, PENDING_PROPOSAL_ID, { expectedVersion: 1, expectedTargetRevision: 3, reviewNote: 'looks good', idempotencyKey: newIdempotencyKey() })
      .catch((e) => e);
    expect(err).toBeInstanceOf(GovernanceApiError);
    expect(err.code).toBe('version_conflict');
    expect(err.details).toMatchObject({ expectedVersion: 1, actualVersion: 2 });
  });

  it('generates a fresh random idempotency key each call', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('buildAmendmentPatch', () => {
  const editable = { nodeMutations: pendingProposalDetail.canonicalMutation.nodeMutations, edgeMutations: pendingProposalDetail.canonicalMutation.edgeMutations };

  it('produces no ops for an unedited draft', () => {
    expect(buildAmendmentPatch(editable, editable)).toEqual([]);
  });

  it('emits a payload-field replace when a description changes', () => {
    const draft = {
      ...editable,
      nodeMutations: editable.nodeMutations.map((m) => (m.op === 'create' && m.nodeId === 'node-1' ? { ...m, payload: { ...m.payload, description: 'Edited insight.' } } : m)),
    };
    const patch = buildAmendmentPatch(editable, draft);
    expect(patch).toEqual([{ op: 'replace', path: '/nodeMutations/1/payload/description', value: 'Edited insight.' }]);
  });

  it('removes a node and adjusts indices of a later replace correctly', () => {
    const draft = {
      nodeMutations: editable.nodeMutations
        .filter((m) => !(m.op === 'create' && m.nodeId === 'node-1'))
        .map((m) => (m.op === 'create' && m.nodeId === 'node-2' ? { ...m, payload: { ...m.payload, statement: 'Edited decision.' } } : m)),
      edgeMutations: editable.edgeMutations,
    };
    const patch = buildAmendmentPatch(editable, draft);
    // node-1 (index 1) removed; node-2 (originally index 2) is now at index 1.
    expect(patch).toEqual([
      { op: 'remove', path: '/nodeMutations/1' },
      { op: 'replace', path: '/nodeMutations/1/payload/statement', value: 'Edited decision.' },
    ]);
  });
});
