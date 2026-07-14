export type EngineId = string;

export type BuiltInPolicyId = 'human' | 'human-gated' | 'ai-with-rails';
export type PolicyId = BuiltInPolicyId | (string & {});

export const BUILT_IN_POLICIES: readonly BuiltInPolicyId[] = ['human', 'human-gated', 'ai-with-rails'];

/** 'canonical' has a fixed evaluator meaning; other class values are deployment-defined. */
export type NamespaceClass = 'canonical' | (string & {});
export const CANONICAL_NAMESPACE_CLASS: NamespaceClass = 'canonical';

export interface NamespacePolicyEntry {
  pattern: string;
  class: NamespaceClass;
  engine: EngineId;
  policy: PolicyId;
  appendOnly?: boolean;
}

export interface NamespaceTableConfig {
  entries: NamespacePolicyEntry[];
  registeredEngines: EngineId[];
  registeredPolicies: PolicyId[];
}
