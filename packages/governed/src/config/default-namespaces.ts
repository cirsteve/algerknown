import type { NamespacePolicyEntry, NamespaceTableConfig } from './namespace-policy.js';

export const DEFAULT_NAMESPACE_ENTRIES: NamespacePolicyEntry[] = [
  { pattern: 'canonical.global', class: 'canonical', engine: 'algerknown', policy: 'human' },
  { pattern: 'canonical.project.*', class: 'canonical', engine: 'algerknown', policy: 'human-gated' },
  { pattern: 'memory.global', class: 'memory', engine: 'sqlite', policy: 'human-gated' },
  { pattern: 'memory.project.*', class: 'memory', engine: 'sqlite', policy: 'human-gated' },
  { pattern: 'memory.community.*', class: 'memory', engine: 'sqlite', policy: 'ai-with-rails' },
  { pattern: 'memory.relationship.*', class: 'memory', engine: 'sqlite', policy: 'ai-with-rails' },
  { pattern: 'operation.*', class: 'operation', engine: 'sqlite', policy: 'ai-with-rails', appendOnly: true },
];

export const DEFAULT_NAMESPACE_TABLE: NamespaceTableConfig = {
  entries: DEFAULT_NAMESPACE_ENTRIES,
  registeredEngines: ['algerknown', 'sqlite'],
  registeredPolicies: ['human', 'human-gated', 'ai-with-rails'],
};
