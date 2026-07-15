import type { DatabaseType } from './connection.js';
import { canonicalStringify, contentHash } from './canonical.js';
import { asActorId, asNamespaceId, asOperationId } from '../domain/ids.js';
import type { ActorId, NamespaceId, OperationId } from '../domain/ids.js';
import type { OperationRecord, OperationSink } from '../ports/operation-sink.js';

export class OperationSinkIdempotencyMismatchError extends Error {
  constructor(operationId: string) {
    super(`operation id "${operationId}" was already recorded with different content`);
    this.name = 'OperationSinkIdempotencyMismatchError';
  }
}

export interface StoredOperationEvent {
  eventId: string;
  operationId: OperationId;
  namespace: NamespaceId;
  sequence: number;
  operationKind: string | undefined;
  actorId: ActorId;
  sourceReferences: unknown;
  recordedAt: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  idempotencyKey: string | undefined;
}

interface OperationEventRow {
  event_id: string;
  operation_namespace: string;
  sequence: number;
  operation_kind: string | null;
  actor_id: string;
  source_refs_json: string | null;
  recorded_at: string;
  payload_json: string;
  payload_hash: string;
  idempotency_key: string | null;
}

function rowToStored(row: OperationEventRow): StoredOperationEvent {
  return {
    eventId: row.event_id,
    operationId: asOperationId(row.event_id),
    namespace: asNamespaceId(row.operation_namespace),
    sequence: row.sequence,
    operationKind: row.operation_kind ?? undefined,
    actorId: asActorId(row.actor_id),
    sourceReferences: row.source_refs_json ? JSON.parse(row.source_refs_json) : undefined,
    recordedAt: row.recorded_at,
    payload: JSON.parse(row.payload_json),
    payloadHash: row.payload_hash,
    idempotencyKey: row.idempotency_key ?? undefined,
  };
}

/**
 * Generic append-only operation.<trace> sink: append is idempotent on the
 * caller-supplied operationId (a retried append with the same id is a
 * silent no-op rather than a duplicate row), sequence numbers increase
 * monotonically per namespace, and only append and ordered-read are
 * exposed -- update, delete, and revert are refused structurally by the
 * operation_events triggers, not just by omission from this class.
 */
export class SqliteOperationSink implements OperationSink {
  constructor(private readonly db: DatabaseType) {}

  async append(record: OperationRecord): Promise<void> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Checked inside the transaction, after BEGIN IMMEDIATE has already
      // acquired the write lock: two concurrent callers can no longer both
      // observe "not present" and race to insert, which would otherwise
      // surface a raw UNIQUE-constraint error instead of the promised
      // idempotent no-op.
      const existing = this.db.prepare('SELECT payload_hash FROM operation_events WHERE event_id = ?').get(record.operationId) as
        | { payload_hash: string }
        | undefined;
      if (existing) {
        if (existing.payload_hash !== contentHash(record.payload)) {
          throw new OperationSinkIdempotencyMismatchError(record.operationId);
        }
        this.db.exec('COMMIT');
        return;
      }

      const nextSeqRow = this.db
        .prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM operation_events WHERE operation_namespace = ?')
        .get(record.namespace) as { next: number };

      const operationKind = typeof record.payload['operationKind'] === 'string' ? (record.payload['operationKind'] as string) : null;
      const sourceReferences = record.payload['sourceReferences'];
      const idempotencyKey = typeof record.payload['idempotencyKey'] === 'string' ? (record.payload['idempotencyKey'] as string) : null;

      this.db
        .prepare(
          `INSERT INTO operation_events
             (event_id, operation_namespace, sequence, operation_kind, actor_id, source_refs_json, recorded_at,
              payload_json, payload_hash, idempotency_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.operationId,
          record.namespace,
          nextSeqRow.next,
          operationKind,
          record.actorId,
          sourceReferences !== undefined ? canonicalStringify(sourceReferences) : null,
          record.recordedAt,
          canonicalStringify(record.payload),
          contentHash(record.payload),
          idempotencyKey,
        );
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Ordered ascending by sequence; the only read path this sink exposes. */
  async listOrdered(namespace: NamespaceId, sinceSequence = 0): Promise<StoredOperationEvent[]> {
    const rows = this.db
      .prepare('SELECT * FROM operation_events WHERE operation_namespace = ? AND sequence > ? ORDER BY sequence ASC')
      .all(namespace, sinceSequence) as OperationEventRow[];
    return rows.map(rowToStored);
  }
}
