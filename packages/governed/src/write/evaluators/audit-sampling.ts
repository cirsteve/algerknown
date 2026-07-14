import type { NamespaceId, ProcessorId } from '../../domain/ids.js';
import { resolveAuditEvery } from '../../config/audit-policy.js';
import type { AuditPolicy } from '../../config/audit-policy.js';
import type { AuditDirective } from '../../domain/revision.js';

/**
 * Deterministic every-N sampling per processor and namespace, keyed off the
 * resulting namespace revision so the decision is reproducible without
 * randomness and without a separate post-commit callback.
 */
export function computeAuditDirective(
  policy: AuditPolicy,
  namespace: NamespaceId,
  resultingRevision: number,
  processorId?: ProcessorId,
): AuditDirective {
  const every = resolveAuditEvery(policy, namespace, processorId);
  const sampled = every > 0 && resultingRevision % every === 0;
  const directive: AuditDirective = { sampled, namespace, every, sampleIndex: resultingRevision };
  if (processorId !== undefined) {
    directive.processorId = processorId;
  }
  return directive;
}
