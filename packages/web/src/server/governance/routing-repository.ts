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
import type { NamespaceMatcher } from '@algerknown/governed';

export class RepositoryEngineUnavailableError extends Error {
  constructor(namespace: NamespaceId, engine: string, detail?: string) {
    super(`no repository is available for namespace "${namespace}" configured with engine "${engine}"${detail ? `: ${detail}` : ''}`);
    this.name = 'RepositoryEngineUnavailableError';
  }
}

/**
 * The single Repository instance WriteOrchestrator is constructed with.
 * Every method resolves the namespace's declarative engine first. SQLite
 * namespaces share one repository; Algerknown namespaces must have an
 * explicit dossier binding. Unknown engines and unbound Algerknown
 * namespaces fail closed instead of silently falling back to SQLite.
 */
export function createRoutingRepository(
  namespaceMatcher: NamespaceMatcher,
  gitRepositoriesByNamespace: Map<string, Repository>,
  sqliteRepository: Repository,
): Repository {
  function resolve(namespace: NamespaceId): Repository {
    const engine = String(namespaceMatcher.resolve(namespace).engine);
    if (engine === 'sqlite') return sqliteRepository;
    if (engine === 'algerknown') {
      const repository = gitRepositoriesByNamespace.get(String(namespace));
      if (repository) return repository;
      throw new RepositoryEngineUnavailableError(namespace, engine, 'no dossier binding is configured');
    }
    throw new RepositoryEngineUnavailableError(namespace, engine);
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
