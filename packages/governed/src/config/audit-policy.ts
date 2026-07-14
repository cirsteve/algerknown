export interface AuditPolicy {
  defaultEvery: number;
  perProcessorEvery: Record<string, number>;
  perNamespaceEvery: Record<string, number>;
}

export const DEFAULT_AUDIT_POLICY: AuditPolicy = {
  defaultEvery: 10,
  perProcessorEvery: {},
  perNamespaceEvery: {},
};

export function resolveAuditEvery(policy: AuditPolicy, namespace: string, processorId?: string): number {
  if (processorId !== undefined) {
    const perProcessor = policy.perProcessorEvery[processorId];
    if (perProcessor !== undefined) return perProcessor;
  }
  const perNamespace = policy.perNamespaceEvery[namespace];
  if (perNamespace !== undefined) return perNamespace;
  return policy.defaultEvery;
}
