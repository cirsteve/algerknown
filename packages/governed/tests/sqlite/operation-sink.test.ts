import { describe, expect, it } from 'vitest';
import {
  asActorId,
  asIdempotencyKey,
  asNamespaceId,
  asNodeId,
  asOperationId,
  asProcessorId,
  asSubjectId,
  WriteOrchestrator,
} from '../../src/index.js';
import { openGovernedDatabase } from '../../src/sqlite/connection.js';
import { SqliteOperationSink } from '../../src/sqlite/operation-sink.js';
import { createSqliteTestHarness } from './harness.js';

describe('SqliteOperationSink', () => {
  function setup() {
    const conn = openGovernedDatabase({ filename: ':memory:' });
    conn.migrate();
    return { conn, sink: new SqliteOperationSink(conn.db) };
  }

  it('appends and orders events by ascending sequence within a namespace', async () => {
    const { conn, sink } = setup();
    const namespace = asNamespaceId('operation.ingest');

    await sink.append({
      operationId: asOperationId('op-1'),
      namespace,
      recordedAt: '2026-01-01T00:00:00.000Z',
      actorId: asActorId('actor-1'),
      payload: { kind: 'first' },
    });
    await sink.append({
      operationId: asOperationId('op-2'),
      namespace,
      recordedAt: '2026-01-01T00:00:01.000Z',
      actorId: asActorId('actor-1'),
      payload: { kind: 'second' },
    });

    const ordered = await sink.listOrdered(namespace);
    expect(ordered.map((e) => e.sequence)).toEqual([1, 2]);
    expect(ordered.map((e) => e.payload.kind)).toEqual(['first', 'second']);
    conn.close();
  });

  it('is idempotent on a repeated operationId: no duplicate row, no error', async () => {
    const { conn, sink } = setup();
    const namespace = asNamespaceId('operation.ingest');
    const record = {
      operationId: asOperationId('op-1'),
      namespace,
      recordedAt: '2026-01-01T00:00:00.000Z',
      actorId: asActorId('actor-1'),
      payload: { kind: 'first' },
    };

    await sink.append(record);
    await sink.append(record);
    await sink.append(record);

    const ordered = await sink.listOrdered(namespace);
    expect(ordered).toHaveLength(1);
    conn.close();
  });

  it('assigns independent sequence counters per namespace', async () => {
    const { conn, sink } = setup();
    await sink.append({
      operationId: asOperationId('op-a1'),
      namespace: asNamespaceId('operation.a'),
      recordedAt: '2026-01-01T00:00:00.000Z',
      actorId: asActorId('actor-1'),
      payload: {},
    });
    await sink.append({
      operationId: asOperationId('op-b1'),
      namespace: asNamespaceId('operation.b'),
      recordedAt: '2026-01-01T00:00:01.000Z',
      actorId: asActorId('actor-1'),
      payload: {},
    });

    expect((await sink.listOrdered(asNamespaceId('operation.a')))[0]!.sequence).toBe(1);
    expect((await sink.listOrdered(asNamespaceId('operation.b')))[0]!.sequence).toBe(1);
    conn.close();
  });

  it('rejects update and delete against operation_events at the database level', async () => {
    const { conn, sink } = setup();
    await sink.append({
      operationId: asOperationId('op-1'),
      namespace: asNamespaceId('operation.ingest'),
      recordedAt: '2026-01-01T00:00:00.000Z',
      actorId: asActorId('actor-1'),
      payload: { kind: 'first' },
    });

    expect(() => conn.db.prepare("UPDATE operation_events SET operation_kind = 'x'").run()).toThrow();
    expect(() => conn.db.prepare('DELETE FROM operation_events').run()).toThrow();
    conn.close();
  });
});

describe('SQLite operation sink and usage counter via WriteOrchestrator', () => {
  it('records an operation-sink entry for an applied append-only write and counts processor usage', async () => {
    const harness = createSqliteTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const processorId = asProcessorId('proc-1');

    const before = await harness.usageCounter.countInWindow(processorId, 60_000, harness.clock.now());
    expect(before).toBe(0);

    const result = await orchestrator.write({
      namespace: asNamespaceId('operation.ingest'),
      subject: asSubjectId('subject-1'),
      nodeMutations: [{ op: 'create', nodeId: asNodeId('n-1'), nodeType: 'observation', payload: { description: 'logged' }, confidence: 0.7 }],
      edgeMutations: [],
      expectedNamespaceRevision: null,
      idempotencyKey: asIdempotencyKey('idem-1'),
      actorId: asActorId('actor-1'),
      actorClass: 'processor',
      provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }], processorId },
    });

    expect(result.outcome).toBe('applied');
    const events = await harness.operationSink.listOrdered(asNamespaceId('operation.ingest'));
    expect(events).toHaveLength(1);

    const after = await harness.usageCounter.countInWindow(processorId, 60_000, harness.clock.now());
    expect(after).toBe(1);
    harness.connection.close();
  });
});
