/**
 * RAG Backend API Client
 *
 * Client for the Algerknown RAG backend (Python/FastAPI): query, search,
 * ingest, jobs, traces, and changelog. Proposal review/approval is not
 * handled here -- it lives entirely in governanceApi.ts against the durable
 * /api/governance API. The RAG backend's own /approve and /preview routes
 * are retired server-side (410 Gone; see rag-backend/api.py).
 */

// RAG backend URL - proxied through the web server via /rag prefix
const RAG_API_URL = '/rag';

export function getRagApiUrl(): string {
  return RAG_API_URL;
}

export function setRagApiUrl(_url: string): void {
  // No-op: RAG requests are now proxied through the web server
}

// Types

export interface JobSubmitResponse {
  job_id: string;
  status: string;
}

export interface QueryRequest {
  query: string;
  n_results?: number;
}

export interface QueryResult {
  answer: string;
  sources: string[];
  model?: string;
  error?: string;
}

export interface RagSearchRequest {
  query: string;
  n_results?: number;
  type_filter?: 'entry' | 'summary';
}

export interface RagSearchResult {
  id: string;
  topic: string;
  type: string;
  distance: number;
  snippet: string;
}

export interface RagSearchResponse {
  results: RagSearchResult[];
}

export interface IngestRequest {
  file_path: string;
  max_proposals?: number;
}

/**
 * Every generated candidate is durably persisted through the governance
 * API's processor endpoint before this job completes (see
 * persist_generated_candidates/GovernanceClient in rag-backend); JobStore
 * never holds proposal content, only these durable proposal ids and counts.
 * Use the governance API (governanceApi.ts) to inspect or review a
 * proposal, never job.result.
 */
export interface SuppressedCandidate {
  index: number;
  proposalId: string;
  reason: string | null;
}

export interface IngestCounts {
  generated: number;
  persisted: number;
  suppressed: number;
}

export interface IngestResult {
  entry_id: string;
  proposal_ids: string[];
  suppressed: SuppressedCandidate[];
  counts: IngestCounts;
  retryable_idempotency_keys?: string[];
}

export interface HealthResponse {
  status: string;
  documents_indexed: number;
  content_dir: string;
}

// API Functions

async function ragRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const baseUrl = getRagApiUrl();
  
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    let errorMessage = `RAG API error: ${response.status}`;
    try {
      const error = await response.json();
      errorMessage = error.detail || error.error || errorMessage;
    } catch {
      // Ignore JSON parse error
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

export const ragApi = {
  // Health check
  health: () => ragRequest<HealthResponse>('/health'),

  // Query mode - submit async query job
  query: (query: string, n_results = 5) =>
    ragRequest<JobSubmitResponse>('/query', {
      method: 'POST',
      body: JSON.stringify({ query, n_results }),
    }),

  // Search mode - raw vector search without LLM
  search: (query: string, n_results = 10, type_filter?: 'entry' | 'summary') =>
    ragRequest<RagSearchResponse>('/search', {
      method: 'POST',
      body: JSON.stringify({ query, n_results, type_filter }),
    }),

  // Ingest mode - submit async ingest job
  ingest: (file_path: string, max_proposals?: number) =>
    ragRequest<JobSubmitResponse>('/ingest', {
      method: 'POST',
      body: JSON.stringify({ file_path, max_proposals }),
    }),

  // Job status polling
  getJob: <T = unknown>(jobId: string) =>
    ragRequest<import('../hooks/useJob').JobResponse<T>>(`/jobs/${jobId}`),

  // Job list
  getJobs: (status?: string, limit = 50) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    params.set('limit', limit.toString());
    const query = params.toString();
    return ragRequest<{ jobs: import('../hooks/useJob').JobResponse[]; total: number }>(
      `/jobs${query ? `?${query}` : ''}`
    );
  },

  // Traces
  getTraces: (limit = 50, before?: string) => {
    const params = new URLSearchParams();
    params.set('limit', limit.toString());
    if (before) params.set('before', before);
    const query = params.toString();
    return ragRequest<import('./traceTypes').TracesResponse>(`/traces?${query}`);
  },

  getTrace: (traceId: string) =>
    ragRequest<import('./traceTypes').TraceDetailResponse>(`/traces/${traceId}`),

  // Re-index all content
  reindex: () =>
    ragRequest<{ indexed: number }>('/reindex', { method: 'POST' }),

  // Changelog endpoints
  getChangelog: (options?: ChangelogQuery) => {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.source) params.set('source', options.source);
    if (options?.path) params.set('path', options.path);
    if (options?.change_type) params.set('change_type', options.change_type);
    const query = params.toString();
    return ragRequest<ChangelogResponse>(`/changelog${query ? `?${query}` : ''}`);
  },

  getChangelogSources: () => ragRequest<{ sources: string[] }>('/changelog/sources'),

  getChangelogStats: () => ragRequest<ChangelogStats>('/changelog/stats'),

  getEntryHistory: (entryId: string, limit = 50) =>
    ragRequest<EntryHistoryResponse>(`/entries/${entryId}/history?limit=${limit}`),
};

// Changelog types
export interface ChangelogEntry {
  timestamp: string;
  source: string;
  type: 'added' | 'modified' | 'removed';
  path: string;
  value?: unknown;
  old?: unknown;
  new?: unknown;
}

export interface ChangelogQuery {
  limit?: number;
  source?: string;
  path?: string;
  change_type?: 'added' | 'modified' | 'removed';
}

export interface ChangelogResponse {
  changes: ChangelogEntry[];
  total: number;
}

export interface ChangelogStats {
  total_changes: number;
  by_type: {
    added: number;
    modified: number;
    removed: number;
  };
  first_change: string | null;
  last_change: string | null;
}

export interface EntryHistoryResponse {
  entry_id: string;
  changes: ChangelogEntry[];
  total: number;
}

// Connection status check
export async function checkRagConnection(): Promise<{
  connected: boolean;
  status?: HealthResponse;
  error?: string;
}> {
  try {
    const status = await ragApi.health();
    return { connected: true, status };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
