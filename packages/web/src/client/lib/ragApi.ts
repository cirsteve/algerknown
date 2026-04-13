/**
 * RAG Backend API Client
 * 
 * Client for the Algerknown RAG backend (Python/FastAPI).
 * Handles query, search, ingest, and approval operations.
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

export interface ProposalData {
  target_summary_id: string;
  source_entry_id: string;
  new_learnings?: Array<{
    insight: string;
    context?: string;
    relevance?: string[];
  }>;
  new_decisions?: Array<{
    decision: string;
    rationale?: string;
    date?: string;
  }>;
  new_open_questions?: string[];
  new_links?: Array<{
    id: string;
    relationship: string;
    notes?: string;
  }>;
  rationale?: string;
  match_score?: number;
  match_reason?: string;
}

export interface IngestResult {
  entry_id: string;
  proposals: ProposalData[];
}

export interface ApproveRequest {
  proposal: ProposalData;
}

export interface ApproveResponse {
  success: boolean;
  file?: string;
  changes?: string[];
  error?: string;
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

  // Preview proposal changes
  preview: (proposal: ProposalData) =>
    ragRequest<{
      valid: boolean;
      file?: string;
      error?: string;
      current_learnings_count?: number;
      proposed_new_learnings?: number;
    }>('/preview', {
      method: 'POST',
      body: JSON.stringify({ proposal }),
    }),

  // Approve and apply proposal
  approve: (proposal: ProposalData) =>
    ragRequest<ApproveResponse>('/approve', {
      method: 'POST',
      body: JSON.stringify({ proposal }),
    }),

  // Job status polling
  getJob: <T = unknown>(jobId: string) =>
    ragRequest<import('../hooks/useJob').JobResponse<T>>(`/jobs/${jobId}`),

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
