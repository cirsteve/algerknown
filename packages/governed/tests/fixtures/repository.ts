import type {
  EdgeId,
  GovernedEdge,
  GovernedNode,
  IdempotencyKey,
  NamespaceId,
  NodeId,
  PreparedWrite,
  Repository,
  RevisionId,
  RevisionRecord,
} from '../../src/index.js';

interface NamespaceState {
  revision: number;
  nodes: Map<NodeId, GovernedNode>;
  edges: Map<EdgeId, GovernedEdge>;
  revisions: RevisionRecord[];
  byIdempotencyKey: Map<IdempotencyKey, RevisionRecord>;
}

/** A synthetic in-memory Repository -- no backend, just enough state to exercise every rail. */
export class InMemoryRepository implements Repository {
  private readonly namespaces = new Map<NamespaceId, NamespaceState>();

  private stateFor(namespace: NamespaceId): NamespaceState {
    let state = this.namespaces.get(namespace);
    if (!state) {
      state = { revision: 0, nodes: new Map(), edges: new Map(), revisions: [], byIdempotencyKey: new Map() };
      this.namespaces.set(namespace, state);
    }
    return state;
  }

  async getNamespaceRevision(namespace: NamespaceId): Promise<number | null> {
    return this.namespaces.get(namespace)?.revision ?? null;
  }

  async getNode(namespace: NamespaceId, nodeId: NodeId): Promise<GovernedNode | undefined> {
    return this.namespaces.get(namespace)?.nodes.get(nodeId);
  }

  async getEdge(namespace: NamespaceId, edgeId: EdgeId): Promise<GovernedEdge | undefined> {
    return this.namespaces.get(namespace)?.edges.get(edgeId);
  }

  async findByIdempotencyKey(namespace: NamespaceId, key: IdempotencyKey): Promise<RevisionRecord | undefined> {
    return this.namespaces.get(namespace)?.byIdempotencyKey.get(key);
  }

  async getRevision(namespace: NamespaceId, revisionId: RevisionId): Promise<RevisionRecord | undefined> {
    return this.namespaces.get(namespace)?.revisions.find((r) => r.revisionId === revisionId);
  }

  async commit(write: PreparedWrite): Promise<void> {
    const state = this.stateFor(write.namespace);
    state.revision = write.resultingRevision;
    for (const node of write.nodesUpserted) state.nodes.set(node.id, node);
    for (const id of write.nodesDeleted) state.nodes.delete(id);
    for (const edge of write.edgesUpserted) state.edges.set(edge.id, edge);
    for (const id of write.edgesDeleted) state.edges.delete(id);
    state.revisions.push(write.revisionRecord);
    state.byIdempotencyKey.set(write.revisionRecord.idempotencyKey, write.revisionRecord);
  }

  async listRevisionsSince(namespace: NamespaceId, sinceRevision: number): Promise<RevisionRecord[]> {
    return (this.namespaces.get(namespace)?.revisions ?? [])
      .filter((r) => r.namespaceRevision > sinceRevision)
      .sort((a, b) => a.namespaceRevision - b.namespaceRevision);
  }
}
