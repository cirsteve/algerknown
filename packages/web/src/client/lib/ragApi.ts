/**
 * RAG Backend API Client
 * 
 * Client for the Algerknown RAG backend (Python/FastAPI).
 * Handles query, search, ingest, and approval operations.
 */

// RAG backend URL (configurable via environment or localStorage)
const RAG_API_URL = import.meta.env.VITE_RAG_API_URL || 'http://localhost:8000';

export function getRagApiUrl(): string {
  return localStorage.getItem('ragApiUrl') || RAG_API_URL;
}

export function setRagApiUrl(url: string): void {
  localStorage.setItem('ragApiUrl', url);
}

// Types

export interface QueryRequest {
  query: string;
  n_results?: number;
}

export interface QueryResponse {
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

export interface IngestResponse {
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

export interface EntryListItem {
  id: string;
  type: string;
  topic: string;
  status: string;
  path: string;
}

export interface EntriesResponse {
  entries: EntryListItem[];
  total: number;
}

export interface SummaryListItem {
  id: string;
  topic: string;
}

export interface SummariesResponse {
  summaries: SummaryListItem[];
  total: number;
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

  // Query mode - get synthesized answer
  query: (query: string, n_results = 5) =>
    ragRequest<QueryResponse>('/query', {
      method: 'POST',
      body: JSON.stringify({ query, n_results }),
    }),

  // Search mode - raw vector search without LLM
  search: (query: string, n_results = 10, type_filter?: 'entry' | 'summary') =>
    ragRequest<RagSearchResponse>('/search', {
      method: 'POST',
      body: JSON.stringify({ query, n_results, type_filter }),
    }),

  // Ingest mode - add new entry and get proposals
  ingest: (file_path: string) =>
    ragRequest<IngestResponse>('/ingest', {
      method: 'POST',
      body: JSON.stringify({ file_path }),
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

  // Re-index all content
  reindex: () =>
    ragRequest<{ indexed: number }>('/reindex', { method: 'POST' }),

  // List all entries
  listEntries: () => ragRequest<EntriesResponse>('/entries'),

  // Get specific entry
  getEntry: (id: string) =>
    ragRequest<{
      id: string;
      content: string;
      metadata: Record<string, string>;
      raw: Record<string, unknown>;
    }>(`/entries/${id}`),

  // List summaries
  listSummaries: () => ragRequest<SummariesResponse>('/summaries'),
};

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
