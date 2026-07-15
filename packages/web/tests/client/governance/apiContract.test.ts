import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { governanceApi, newIdempotencyKey } from '../../../src/client/lib/governanceApi';
import { PENDING_PROPOSAL_ID } from '../fixtures/proposal';
import { server } from '../mocks/server';

/**
 * The browser's non-authoritative role is enforced continuously at this
 * boundary: every mutating request body may contain only the proposal id
 * (in the path), proposal version, expected target revision, a note/reason,
 * a JSON Patch (amend only), and an idempotency key -- never reviewer
 * identity, time, an authoritative mutation, attestation, rail, verdict, or
 * mutation hash.
 */
const FORBIDDEN_KEYS = ['reviewerId', 'actorId', 'reviewerDisplayName', 'at', 'timestamp', 'mutation', 'canonicalMutation', 'attestation', 'attestationId', 'rail', 'railId', 'verdict', 'mutationHash'];

const fetcher = (input: string, init?: RequestInit) => fetch(input, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });

async function captureBody(method: 'amend' | 'accept' | 'reject' | 'expire' | 'delete' | 'revert', run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  server.use(
    http.post(`/api/governance/proposals/:id/${method}`, async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ id: PENDING_PROPOSAL_ID, version: 2, status: 'pending', resultingRevision: 4, newRevision: 4 });
    }),
  );
  await run();
  return body;
}

function assertOnlyAllowedKeys(body: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(body)) {
    expect(allowed).toContain(key);
  }
  for (const key of FORBIDDEN_KEYS) {
    expect(body).not.toHaveProperty(key);
  }
}

describe('governance API request contract', () => {
  it('amend sends only expectedVersion, patch, idempotencyKey', async () => {
    const body = await captureBody('amend', () =>
      governanceApi.amendProposal(fetcher, PENDING_PROPOSAL_ID, { expectedVersion: 1, patch: [{ op: 'remove', path: '/nodeMutations/0' }], idempotencyKey: newIdempotencyKey() }),
    );
    assertOnlyAllowedKeys(body, ['expectedVersion', 'patch', 'idempotencyKey']);
  });

  it('accept sends only expectedVersion, expectedTargetRevision, reviewNote, idempotencyKey', async () => {
    const body = await captureBody('accept', () =>
      governanceApi.acceptProposal(fetcher, PENDING_PROPOSAL_ID, { expectedVersion: 1, expectedTargetRevision: 3, reviewNote: 'looks good', idempotencyKey: newIdempotencyKey() }),
    );
    assertOnlyAllowedKeys(body, ['expectedVersion', 'expectedTargetRevision', 'reviewNote', 'idempotencyKey']);
  });

  it('reject sends only expectedVersion, reason, idempotencyKey', async () => {
    const body = await captureBody('reject', () => governanceApi.rejectProposal(fetcher, PENDING_PROPOSAL_ID, { expectedVersion: 1, reason: 'not applicable', idempotencyKey: newIdempotencyKey() }));
    assertOnlyAllowedKeys(body, ['expectedVersion', 'reason', 'idempotencyKey']);
  });

  it('expire sends only expectedVersion, note, idempotencyKey', async () => {
    const body = await captureBody('expire', () => governanceApi.expireProposal(fetcher, PENDING_PROPOSAL_ID, { expectedVersion: 1, note: 'stale candidate', idempotencyKey: newIdempotencyKey() }));
    assertOnlyAllowedKeys(body, ['expectedVersion', 'note', 'idempotencyKey']);
  });

  it('delete sends only expectedVersion, reason, idempotencyKey', async () => {
    const body = await captureBody('delete', () => governanceApi.deleteProposal(fetcher, PENDING_PROPOSAL_ID, { expectedVersion: 1, reason: 'duplicate', idempotencyKey: newIdempotencyKey() }));
    assertOnlyAllowedKeys(body, ['expectedVersion', 'reason', 'idempotencyKey']);
  });

  it('revert sends only reason, idempotencyKey', async () => {
    const body = await captureBody('revert', () => governanceApi.revertProposal(fetcher, PENDING_PROPOSAL_ID, { reason: 'broke downstream consumers', idempotencyKey: newIdempotencyKey() }));
    assertOnlyAllowedKeys(body, ['reason', 'idempotencyKey']);
  });
});
