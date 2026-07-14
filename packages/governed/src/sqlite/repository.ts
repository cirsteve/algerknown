import { randomUUID } from 'node:crypto';
import type { DatabaseType } from './connection.js';
import { canonicalStringify, contentHash } from './canonical.js';
import { asActorId, asEdgeId, asIdempotencyKey, asNodeId, asRevisionId } from '../domain/ids.js';
import type {
  EdgeId,
  IdempotencyKey,
  NamespaceId,
  NodeId,
  RevisionId,
} from '../domain/ids.js';
import type { GovernedEdge } from '../domain/edge.js';
import type { GovernedNode } from '../domain/node.js';
import type { PreparedWrite, Repository, RevisionRecord } from '../ports/repository.js';

export class SqliteRevisionConflictError extends Error {
  constructor(namespace: string, expected: number | null, actual: number | null) {
    super(`namespace "${namespace}" revision conflict: expected ${expected ?? 'null'}, found ${actual ?? 'null'}`);
    this.name = 'SqliteRevisionConflictError';
  }
}

interface CurrentNodeRow {
  node_id: string;
  type: string;
  subject: string;
  payload_json: string;
  confidence: number;
  provenance_json: string;
  revision_json: string;
}

interface CurrentEdgeRow {
  edge_id: string;
  kind: string;
  source_id: string;
  target_id: string;
  provenance_json: string;
  revision_json: string;
}

interface NamespaceRevisionRow {
  namespace_revision: number;
  revision_id: string;
  previous_revision: number | null;
  created_at: string;
  actor_id: string;
  actor_class: string;
  idempotency_key: string;
  diff_json: string;
  audit_directive_json: string | null;
}

function nodeRowToGovernedNode(namespace: NamespaceId, row: CurrentNodeRow): GovernedNode {
  return {
    id: asNodeId(row.node_id),
    type: row.type,
    namespace,
    subject: row.subject,
    payload: JSON.parse(row.payload_json),
    confidence: row.confidence,
    provenance: JSON.parse(row.provenance_json),
    revision: JSON.parse(row.revision_json),
  } as unknown as GovernedNode;
}

function edgeRowToGovernedEdge(namespace: NamespaceId, row: CurrentEdgeRow): GovernedEdge {
  return {
    id: asEdgeId(row.edge_id),
    kind: row.kind as GovernedEdge['kind'],
    namespace,
    sourceId: asNodeId(row.source_id),
    targetId: asNodeId(row.target_id),
    provenance: JSON.parse(row.provenance_json),
    revision: JSON.parse(row.revision_json),
  };
}

function revisionRowToRecord(namespace: NamespaceId, row: NamespaceRevisionRow): RevisionRecord {
  const record: RevisionRecord = {
    namespace,
    revisionId: asRevisionId(row.revision_id),
    previousRevision: row.previous_revision,
    namespaceRevision: row.namespace_revision,
    createdAt: row.created_at,
    actorId: asActorId(row.actor_id),
    actorClass: row.actor_class as RevisionRecord['actorClass'],
    diff: JSON.parse(row.diff_json),
    idempotencyKey: asIdempotencyKey(row.idempotency_key),
  };
  if (row.audit_directive_json) {
    record.auditDirective = JSON.parse(row.audit_directive_json);
  }
  return record;
}

/**
 * Repository port backed by the governed SQLite schema. commit() is the sole
 * write transaction boundary: it re-checks the expected namespace revision
 * under BEGIN IMMEDIATE, writes the immutable revision ledger plus per-entity
 * revision rows, replaces the current node/edge projections, records any
 * audit sample selection, and commits exactly once.
 */
export class SqliteRepository implements Repository {
  constructor(private readonly db: DatabaseType) {}

  async getNamespaceRevision(namespace: NamespaceId): Promise<number | null> {
    const row = this.db.prepare('SELECT current_revision FROM namespaces WHERE namespace = ?').get(namespace) as
      | { current_revision: number }
      | undefined;
    return row ? row.current_revision : null;
  }

  async getNode(namespace: NamespaceId, nodeId: NodeId): Promise<GovernedNode | undefined> {
    const row = this.db
      .prepare('SELECT * FROM current_nodes WHERE namespace = ? AND node_id = ?')
      .get(namespace, nodeId) as CurrentNodeRow | undefined;
    return row ? nodeRowToGovernedNode(namespace, row) : undefined;
  }

  async getEdge(namespace: NamespaceId, edgeId: EdgeId): Promise<GovernedEdge | undefined> {
    const row = this.db
      .prepare('SELECT * FROM current_edges WHERE namespace = ? AND edge_id = ?')
      .get(namespace, edgeId) as CurrentEdgeRow | undefined;
    return row ? edgeRowToGovernedEdge(namespace, row) : undefined;
  }

  async findByIdempotencyKey(namespace: NamespaceId, key: IdempotencyKey): Promise<RevisionRecord | undefined> {
    const row = this.db
      .prepare('SELECT * FROM namespace_revisions WHERE namespace = ? AND idempotency_key = ?')
      .get(namespace, key) as NamespaceRevisionRow | undefined;
    return row ? revisionRowToRecord(namespace, row) : undefined;
  }

  async getRevision(namespace: NamespaceId, revisionId: RevisionId): Promise<RevisionRecord | undefined> {
    const row = this.db
      .prepare('SELECT * FROM namespace_revisions WHERE namespace = ? AND revision_id = ?')
      .get(namespace, revisionId) as NamespaceRevisionRow | undefined;
    return row ? revisionRowToRecord(namespace, row) : undefined;
  }

  async listRevisionsSince(namespace: NamespaceId, sinceRevision: number): Promise<RevisionRecord[]> {
    const rows = this.db
      .prepare(
        'SELECT * FROM namespace_revisions WHERE namespace = ? AND namespace_revision > ? ORDER BY namespace_revision ASC',
      )
      .all(namespace, sinceRevision) as NamespaceRevisionRow[];
    return rows.map((row) => revisionRowToRecord(namespace, row));
  }

  async commit(write: PreparedWrite): Promise<void> {
    const { namespace } = write;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const namespaceRow = this.db.prepare('SELECT current_revision FROM namespaces WHERE namespace = ?').get(namespace) as
        | { current_revision: number }
        | undefined;
      const actualCurrentRevision = namespaceRow ? namespaceRow.current_revision : null;
      if (actualCurrentRevision !== write.previousRevision) {
        throw new SqliteRevisionConflictError(namespace, write.previousRevision, actualCurrentRevision);
      }

      this.db
        .prepare(
          `INSERT INTO namespaces (namespace, current_revision, next_sequence)
           VALUES (?, ?, 0)
           ON CONFLICT(namespace) DO UPDATE SET current_revision = excluded.current_revision`,
        )
        .run(namespace, write.resultingRevision);

      const record = write.revisionRecord;
      this.db
        .prepare(
          `INSERT INTO namespace_revisions
             (namespace, namespace_revision, revision_id, previous_revision, created_at, actor_id, actor_class,
              idempotency_key, diff_json, content_hash, audit_directive_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          namespace,
          record.namespaceRevision,
          record.revisionId,
          record.previousRevision,
          record.createdAt,
          record.actorId,
          record.actorClass,
          record.idempotencyKey,
          canonicalStringify(record.diff),
          contentHash(record.diff),
          record.auditDirective ? canonicalStringify(record.auditDirective) : null,
        );

      const upsertedNodesById = new Map(write.nodesUpserted.map((n) => [n.id, n]));
      const upsertedEdgesById = new Map(write.edgesUpserted.map((e) => [e.id, e]));

      for (const entry of record.diff) {
        if (entry.entityKind === 'node') {
          const nodeId = entry.entityId as NodeId;
          const node = upsertedNodesById.get(nodeId);
          this.recordNodeRevision(namespace, nodeId, record, node);
        } else {
          const edgeId = entry.entityId as EdgeId;
          const edge = upsertedEdgesById.get(edgeId);
          this.recordEdgeRevision(namespace, edgeId, record, edge);
        }
      }

      for (const node of write.nodesUpserted) {
        this.db
          .prepare(
            `INSERT INTO current_nodes
               (namespace, node_id, type, subject, payload_json, confidence, provenance_json, revision_json,
                content_hash, namespace_revision)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(namespace, node_id) DO UPDATE SET
               type = excluded.type,
               subject = excluded.subject,
               payload_json = excluded.payload_json,
               confidence = excluded.confidence,
               provenance_json = excluded.provenance_json,
               revision_json = excluded.revision_json,
               content_hash = excluded.content_hash,
               namespace_revision = excluded.namespace_revision`,
          )
          .run(
            namespace,
            node.id,
            node.type,
            node.subject,
            canonicalStringify(node.payload),
            node.confidence,
            canonicalStringify(node.provenance),
            canonicalStringify(node.revision),
            contentHash(node),
            record.namespaceRevision,
          );
      }

      for (const nodeId of write.nodesDeleted) {
        this.db.prepare('DELETE FROM current_nodes WHERE namespace = ? AND node_id = ?').run(namespace, nodeId);
      }

      for (const edge of write.edgesUpserted) {
        this.db
          .prepare(
            `INSERT INTO current_edges
               (namespace, edge_id, kind, source_id, target_id, provenance_json, revision_json, content_hash,
                namespace_revision)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(namespace, edge_id) DO UPDATE SET
               kind = excluded.kind,
               source_id = excluded.source_id,
               target_id = excluded.target_id,
               provenance_json = excluded.provenance_json,
               revision_json = excluded.revision_json,
               content_hash = excluded.content_hash,
               namespace_revision = excluded.namespace_revision`,
          )
          .run(
            namespace,
            edge.id,
            edge.kind,
            edge.sourceId,
            edge.targetId,
            canonicalStringify(edge.provenance),
            canonicalStringify(edge.revision),
            contentHash(edge),
            record.namespaceRevision,
          );
      }

      for (const edgeId of write.edgesDeleted) {
        this.db.prepare('DELETE FROM current_edges WHERE namespace = ? AND edge_id = ?').run(namespace, edgeId);
      }

      if (record.auditDirective?.sampled) {
        this.db
          .prepare(
            `INSERT INTO audit_samples (sample_id, namespace, namespace_revision, processor_id, sampled_at, reviewed)
             VALUES (?, ?, ?, ?, ?, 0)`,
          )
          .run(
            randomUUID(),
            namespace,
            record.namespaceRevision,
            record.auditDirective.processorId ?? null,
            record.createdAt,
          );
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private recordNodeRevision(
    namespace: NamespaceId,
    nodeId: NodeId,
    record: RevisionRecord,
    node: GovernedNode | undefined,
  ): void {
    const subject = node?.subject ?? this.lookupCurrentNodeSubject(namespace, nodeId);
    this.db
      .prepare(
        `INSERT INTO node_revisions
           (namespace, node_id, namespace_revision, revision_id, subject, change_kind, node_json, content_hash,
            created_at, actor_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        namespace,
        nodeId,
        record.namespaceRevision,
        record.revisionId,
        subject ?? '',
        node ? 'upsert' : 'delete',
        node ? canonicalStringify(node) : null,
        node ? contentHash(node) : null,
        record.createdAt,
        record.actorId,
      );
  }

  private recordEdgeRevision(
    namespace: NamespaceId,
    edgeId: EdgeId,
    record: RevisionRecord,
    edge: GovernedEdge | undefined,
  ): void {
    this.db
      .prepare(
        `INSERT INTO edge_revisions
           (namespace, edge_id, namespace_revision, revision_id, change_kind, edge_json, content_hash, created_at,
            actor_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        namespace,
        edgeId,
        record.namespaceRevision,
        record.revisionId,
        edge ? 'upsert' : 'delete',
        edge ? canonicalStringify(edge) : null,
        edge ? contentHash(edge) : null,
        record.createdAt,
        record.actorId,
      );
  }

  private lookupCurrentNodeSubject(namespace: NamespaceId, nodeId: NodeId): string | undefined {
    const row = this.db
      .prepare('SELECT subject FROM current_nodes WHERE namespace = ? AND node_id = ?')
      .get(namespace, nodeId) as { subject: string } | undefined;
    return row?.subject;
  }
}
