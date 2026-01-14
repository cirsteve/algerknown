let cachedDefaultPath: string | null = null;

export function setZkbPath(path: string) {
  localStorage.setItem('zkbPath', path);
}

export async function fetchDefaultZkbPath(): Promise<string> {
  if (cachedDefaultPath) return cachedDefaultPath;
  try {
    const response = await fetch('/api/config/zkb-path');
    const data = await response.json();
    cachedDefaultPath = data.path;
    return data.path;
  } catch {
    return process.cwd?.() || '.';
  }
}

export function getZkbPath(): string {
  return localStorage.getItem('zkbPath') || cachedDefaultPath || '';
}

export async function initZkbPath(): Promise<string> {
  const stored = localStorage.getItem('zkbPath');
  if (stored) return stored;
  const defaultPath = await fetchDefaultZkbPath();
  return defaultPath;
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
  getDefaultZkbPath: () => fetch('/api/config/zkb-path').then(r => r.json()).then(d => d.path as string),
  validate: () => apiRequest<{ 
    valid: boolean; 
    totalChecked: number;
    errors: Array<{ entryId: string; errors: ValidationError[] }> 
  }>('/config/validate'),
};
