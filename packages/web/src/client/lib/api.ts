const DEFAULT_ZKB_PATH = '/home/steve/codes/personal/algerknown/zkb-populated';

export function setZkbPath(path: string) {
  localStorage.setItem('zkbPath', path);
}

export function getZkbPath(): string {
  return localStorage.getItem('zkbPath') || DEFAULT_ZKB_PATH;
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    'x-zkb-path': getZkbPath(),
    ...options.headers,
  };

  const response = await fetch(`/api${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'API request failed');
  }

  return response.json();
}

// Types matching the API responses
export interface IndexEntryRef {
  id: string;
  path: string;
  type: 'summary' | 'entry';
}

export interface Link {
  id: string;
  relationship: string;
  notes?: string;
}

export interface Entry {
  id: string;
  type: 'summary' | 'entry';
  topic: string;
  status: string;
  tags?: string[];
  summary?: string;
  context?: string;
  links?: Link[];
  [key: string]: unknown;
}

export interface SearchResult {
  id: string;
  type: 'summary' | 'entry';
  topic: string;
  snippet: string;
  score: number;
}

export interface LinkGraph {
  nodes: Array<{ id: string; type?: string; topic?: string }>;
  edges: Array<{ source: string; target: string; relationship: string }>;
}

export interface ValidationError {
  path: string;
  message: string;
}

export const api = {
  // Entries
  getEntries: () => apiRequest<IndexEntryRef[]>('/entries'),
  getEntry: (id: string) => apiRequest<Entry>(`/entries/${id}`),
  createEntry: (entry: Entry) => 
    apiRequest<Entry>('/entries', { method: 'POST', body: JSON.stringify(entry) }),
  updateEntry: (id: string, entry: Partial<Entry>) => 
    apiRequest<Entry>(`/entries/${id}`, { method: 'PUT', body: JSON.stringify(entry) }),
  deleteEntry: (id: string) => 
    apiRequest<{ message: string }>(`/entries/${id}`, { method: 'DELETE' }),

  // Links
  getLinks: (id: string) => apiRequest<Link[]>(`/links/${id}`),
  getGraph: (id: string, depth = 2) => 
    apiRequest<LinkGraph>(`/links/${id}/graph?depth=${depth}`),
  createLink: (sourceId: string, targetId: string, relationship: string, notes?: string) =>
    apiRequest('/links', { 
      method: 'POST', 
      body: JSON.stringify({ sourceId, targetId, relationship, notes }) 
    }),
  removeLink: (sourceId: string, targetId: string, relationship: string) =>
    apiRequest('/links', { 
      method: 'DELETE', 
      body: JSON.stringify({ sourceId, targetId, relationship }) 
    }),

  // Search
  search: (query: string, type?: 'summary' | 'entry') => 
    apiRequest<SearchResult[]>(`/search?q=${encodeURIComponent(query)}${type ? `&type=${type}` : ''}`),
  getTypes: () => apiRequest<string[]>('/search/types'),
  getByType: (type: 'summary' | 'entry') => apiRequest<Entry[]>(`/search/by-type/${type}`),
  getTags: () => apiRequest<string[]>('/search/tags'),
  getByTag: (tag: string) => apiRequest<Entry[]>(`/search/by-tag/${tag}`),

  // Config
  getConfig: () => apiRequest<{ version: string; entryCount: number }>('/config'),
  getSchemas: () => apiRequest<Array<{ file: string; title: string; $id: string }>>('/config/schemas'),
  validate: () => apiRequest<{ 
    valid: boolean; 
    totalChecked: number;
    errors: Array<{ entryId: string; errors: ValidationError[] }> 
  }>('/config/validate'),
};
