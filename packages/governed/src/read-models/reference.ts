import { createHash } from 'node:crypto';
import type { EdgeId, NamespaceId, NodeId, RevisionId, SubjectId } from '../domain/ids.js';
import type { EdgeKind } from '../domain/edge.js';
import type { NodeType } from '../domain/node.js';
import type { ReadModel } from '../ports/read-model.js';
import type { Repository, RevisionRecord } from '../ports/repository.js';
import { applyDiffEntry, createEmptyReplayState, type ReplayState } from '../write/replay.js';

export interface ReferenceNodeRow {
  entityKind: 'node';
  namespace: NamespaceId;
  subject: SubjectId;
  id: NodeId;
  type: NodeType;
  contentHash: string;
  sourceRevision: RevisionId;
}

export interface ReferenceEdgeRow {
  entityKind: 'edge';
  namespace: NamespaceId;
  id: EdgeId;
  edgeKind: EdgeKind;
  sourceId: NodeId;
  targetId: NodeId;
  sourceRevision: RevisionId;
}

export type ReferenceRow = ReferenceNodeRow | ReferenceEdgeRow;

function contentHashOf(payload: unknown, confidence: number): string {
  return createHash('sha256').update(JSON.stringify({ payload, confidence })).digest('hex');
}

function rowSortKey(row: ReferenceRow): string {
  return `${row.entityKind}:${row.id}`;
}

/**
 * A minimal, deterministic projection of the *active* (currently live, not
 * historical) namespace/subject/node-id/type/content-hash and edge-kind/
 * endpoints, each stamped with the revision it was last written by. Rows are
 * sorted by entity kind then id so two independently rebuilt instances over
 * the same history always serialize identically.
 */
export class ReferenceReadModel implements ReadModel {
  private readonly states = new Map<NamespaceId, ReplayState>();

  ingestRevision(record: RevisionRecord): void {
    let state = this.states.get(record.namespace);
    if (!state) {
      state = createEmptyReplayState();
      this.states.set(record.namespace, state);
    }
    for (const entry of record.diff) {
      applyDiffEntry(state, entry);
    }
  }

  rows(namespace: NamespaceId): ReferenceRow[] {
    const state = this.states.get(namespace) ?? createEmptyReplayState();

    const nodeRows: ReferenceRow[] = [...state.nodes.values()].map((node) => ({
      entityKind: 'node',
      namespace: node.namespace,
      subject: node.subject,
      id: node.id,
      type: node.type,
      contentHash: contentHashOf(node.payload, node.confidence),
      sourceRevision: node.revision.revisionId,
    }));

    const edgeRows: ReferenceRow[] = [...state.edges.values()].map((edge) => ({
      entityKind: 'edge',
      namespace: edge.namespace,
      id: edge.id,
      edgeKind: edge.kind,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      sourceRevision: edge.revision.revisionId,
    }));

    return [...nodeRows, ...edgeRows].sort((a, b) => rowSortKey(a).localeCompare(rowSortKey(b)));
  }

  async digest(namespace: NamespaceId): Promise<string> {
    return createHash('sha256').update(JSON.stringify(this.rows(namespace))).digest('hex');
  }
}

export interface ReferenceReadModelSnapshot {
  rows: ReferenceRow[];
  digest: string;
}

/**
 * Drop-and-rebuild proof: replays a namespace's full revision history from
 * the repository into a brand-new, empty projection -- never seeded from the
 * live instance -- and returns its rows/digest for comparison against the
 * live projection.
 */
export async function rebuildReferenceReadModel(repository: Repository, namespace: NamespaceId): Promise<ReferenceReadModelSnapshot> {
  const fresh = new ReferenceReadModel();
  const revisions = await repository.listRevisionsSince(namespace, 0);
  for (const record of revisions) {
    fresh.ingestRevision(record);
  }
  return { rows: fresh.rows(namespace), digest: await fresh.digest(namespace) };
}
