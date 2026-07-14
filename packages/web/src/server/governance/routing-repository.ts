import type {
  EdgeId,
  IdempotencyKey,
  NamespaceId,
  NodeId,
  PreparedWrite,
  Repository,
  RevisionId,
  RevisionRecord,
} from '@algerknown/governed';

/**
 * The single Repository instance WriteOrchestrator is constructed with.
 * Every method dispatches by namespace to the Algerknown/git repository
 * bound to that namespace, falling back to the shared SQLite repository for
 * every namespace without a git binding (memory.*, operation.*, and any
 * canonical.* namespace this deployment has not bound to a dossier).
 * WriteOrchestrator has no per-namespace repository-selection logic of its
 * own -- see NamespaceMatcher/NamespacePolicyEntry.engine, which is
 * validated but never consumed for routing -- so this composition-root
 * concern is the only place that engine assignment is actually enforced.
 */
export function createRoutingRepository(gitRepositoriesByNamespace: Map<string, Repository>, sqliteRepository: Repository): Repository {
  function resolve(namespace: NamespaceId): Repository {
    return gitRepositoriesByNamespace.get(String(namespace)) ?? sqliteRepository;
  }

  return {
    getNamespaceRevision(namespace: NamespaceId): Promise<number | null> {
      return resolve(namespace).getNamespaceRevision(namespace);
    },
    getNode(namespace: NamespaceId, nodeId: NodeId) {
      return resolve(namespace).getNode(namespace, nodeId);
    },
    getEdge(namespace: NamespaceId, edgeId: EdgeId) {
      return resolve(namespace).getEdge(namespace, edgeId);
    },
    findByIdempotencyKey(namespace: NamespaceId, key: IdempotencyKey): Promise<RevisionRecord | undefined> {
      return resolve(namespace).findByIdempotencyKey(namespace, key);
    },
    getRevision(namespace: NamespaceId, revisionId: RevisionId): Promise<RevisionRecord | undefined> {
      return resolve(namespace).getRevision(namespace, revisionId);
    },
    commit(write: PreparedWrite): Promise<void> {
      return resolve(write.namespace).commit(write);
    },
    listRevisionsSince(namespace: NamespaceId, sinceRevision: number): Promise<RevisionRecord[]> {
      return resolve(namespace).listRevisionsSince(namespace, sinceRevision);
    },
  };
}
