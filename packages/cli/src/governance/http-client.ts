import { resolveReviewerSecret } from '../auth/credential-resolver.js';

export const DEFAULT_GOVERNANCE_API_URL = 'http://127.0.0.1:2393/api/governance';

export class GovernanceApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body?: unknown;

  constructor(status: number, body: unknown) {
    const code = body && typeof body === 'object' && 'error' in body ? String((body as Record<string, unknown>).error) : undefined;
    super(`governance API request failed with ${status}${code ? ` (${code})` : ''}`);
    this.name = 'GovernanceApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export interface GovernanceClientOptions {
  baseUrl?: string;
  secret?: string;
}

export interface ProposalQueueParams {
  status?: string;
  namespace?: string;
  subject?: string;
  cursor?: string;
  limit?: number;
}

/**
 * Thin HTTP client the CLI's `agn review` commands share with the browser:
 * same authenticated /api/governance surface, same strict action payloads,
 * no direct repository/SQLite/git access from the CLI process itself.
 */
export class GovernanceClient {
  private constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {}

  static async create(opts: GovernanceClientOptions = {}): Promise<GovernanceClient> {
    const baseUrl = opts.baseUrl ?? process.env.GOVERNANCE_API_URL ?? DEFAULT_GOVERNANCE_API_URL;
    const secret = opts.secret ?? (await resolveReviewerSecret());
    return new GovernanceClient(baseUrl, secret);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.secret}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const data: unknown = text.length > 0 ? JSON.parse(text) : undefined;
    if (!res.ok) {
      throw new GovernanceApiError(res.status, data);
    }
    return data as T;
  }

  listProposals(params: ProposalQueueParams = {}): Promise<{ items: unknown[]; nextCursor: string | null }> {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    const suffix = qs.toString();
    return this.request('GET', `/proposals${suffix ? `?${suffix}` : ''}`);
  }

  getProposal(id: string): Promise<Record<string, unknown>> {
    return this.request('GET', `/proposals/${encodeURIComponent(id)}`);
  }

  getProposalHistory(id: string): Promise<{ events: unknown[] }> {
    return this.request('GET', `/proposals/${encodeURIComponent(id)}/history`);
  }

  getNodeHistory(nodeId: string, namespace: string): Promise<{ revisions: unknown[] }> {
    return this.request('GET', `/nodes/${encodeURIComponent(nodeId)}/history?namespace=${encodeURIComponent(namespace)}`);
  }

  amendProposal(
    id: string,
    body: { expectedVersion: number; expectedTargetRevision: number | null; patch: unknown[]; note: string; idempotencyKey: string },
  ): Promise<Record<string, unknown>> {
    return this.request('POST', `/proposals/${encodeURIComponent(id)}/amend`, body);
  }

  acceptProposal(
    id: string,
    body: { expectedVersion: number; expectedTargetRevision: number | null; reviewNote?: string; reviewBatchId?: string; idempotencyKey: string },
  ): Promise<Record<string, unknown>> {
    return this.request('POST', `/proposals/${encodeURIComponent(id)}/accept`, body);
  }

  rejectProposal(id: string, body: { expectedVersion: number; reason: string; idempotencyKey: string }): Promise<Record<string, unknown>> {
    return this.request('POST', `/proposals/${encodeURIComponent(id)}/reject`, body);
  }

  expireProposal(id: string, body: { expectedVersion: number; note: string; idempotencyKey: string }): Promise<Record<string, unknown>> {
    return this.request('POST', `/proposals/${encodeURIComponent(id)}/expire`, body);
  }

  deleteProposal(id: string, body: { expectedVersion: number; reason: string; idempotencyKey: string }): Promise<Record<string, unknown>> {
    return this.request('POST', `/proposals/${encodeURIComponent(id)}/delete`, body);
  }

  revertProposal(id: string, body: { reason: string; idempotencyKey: string }): Promise<Record<string, unknown>> {
    return this.request('POST', `/proposals/${encodeURIComponent(id)}/revert`, body);
  }
}
