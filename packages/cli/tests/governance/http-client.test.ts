import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GovernanceApiError, GovernanceClient } from '../../src/governance/http-client.js';

const ORIGINAL_ENV = { ...process.env };

describe('GovernanceClient', () => {
  beforeEach(() => {
    process.env.ALGERKNOWN_REVIEWER_SECRET = 'test-reviewer-secret';
    process.env.GOVERNANCE_API_URL = 'http://127.0.0.1:9999/api/governance';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it('resolves the reviewer secret and sends it as a Bearer token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = await GovernanceClient.create();
    await client.listProposals({ status: 'pending' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:9999/api/governance/proposals?status=pending');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer test-reviewer-secret');
  });

  it('throws GovernanceApiError with the parsed body on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })),
    );

    const client = await GovernanceClient.create();
    await expect(client.getProposal('missing')).rejects.toMatchObject({ status: 404, code: 'not_found' });
    await expect(client.getProposal('missing')).rejects.toBeInstanceOf(GovernanceApiError);
  });

  it('sends accept body with expected fields and idempotency key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'accepted', resultingRevision: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = await GovernanceClient.create();
    await client.acceptProposal('p1', { expectedVersion: 1, expectedTargetRevision: null, idempotencyKey: 'k1' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:9999/api/governance/proposals/p1/accept');
    expect(init!.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({ expectedVersion: 1, expectedTargetRevision: null, idempotencyKey: 'k1' });
  });
});
