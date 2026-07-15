import { resolveReviewerSecret } from '../auth/credential-resolver.js';

export const DEFAULT_GOVERNANCE_API_URL = 'http://127.0.0.1:2393/api/governance';

const REQUEST_TIMEOUT_MS = 30_000;

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
    const rawBaseUrl = opts.baseUrl ?? process.env.GOVERNANCE_API_URL ?? DEFAULT_GOVERNANCE_API_URL;
    // A trailing slash produces `//proposals`, which the express routes do not
    // match and which surfaces as a confusing HTML 404.
    const baseUrl = rawBaseUrl.replace(/\/+$/, '');
    const secret = opts.secret ?? (await resolveReviewerSecret());
    return new GovernanceClient(baseUrl, secret);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.secret}` },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        // Without a timeout a wedged or half-open server hangs the command
        // indefinitely with no feedback.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // fetch rejects (not resolves) on connection failure -- server down,
      // wrong host/port, DNS -- and when AbortSignal.timeout fires (a
      // TimeoutError). Surface both as a GovernanceApiError (status 0, "no
      // HTTP response") so `agn review` prints an actionable message instead
      // of an opaque TypeError/TimeoutError.
      const reason =
        err instanceof Error && err.name === 'TimeoutError'
          ? `request timed out after ${REQUEST_TIMEOUT_MS}ms`
          : `could not reach governance API at ${this.baseUrl} (${err instanceof Error ? err.message : String(err)})`;
      throw new GovernanceApiError(0, { error: reason });
    }
    const text = await res.text();
    // Parse defensively: a misconfigured URL/port or a reverse-proxy error page
    // returns non-JSON (HTML), which must surface as a GovernanceApiError with
    // the status code, not an opaque `SyntaxError: Unexpected token '<'`.
    let data: unknown;
    try {
      data = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      if (!res.ok) {
        throw new GovernanceApiError(res.status, text);
      }
      throw new GovernanceApiError(res.status, `expected JSON response but received: ${text.slice(0, 200)}`);
    }
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
