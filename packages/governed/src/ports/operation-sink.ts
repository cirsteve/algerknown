import type { ActorId, NamespaceId, OperationId } from '../domain/ids.js';

export interface OperationRecord {
  operationId: OperationId;
  namespace: NamespaceId;
  recordedAt: string;
  actorId: ActorId;
  payload: Record<string, unknown>;
}

/** Append-only sink for operation.* namespace writes; never supports update or delete. */
export interface OperationSink {
  append(record: OperationRecord): Promise<void>;
}
