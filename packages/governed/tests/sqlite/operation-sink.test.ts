import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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
import { OperationSinkIdempotencyMismatchError, SqliteOperationSink } from '../../src/sqlite/operation-sink.js';
import { createSqliteTestHarness } from './harness.js';
import { recordSuiteEvidence, trackSuiteFailures } from '../acceptance/evidence-helpers.js';

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

  it('is idempotent on a repeated operationId: no duplicate row, no error, exact replay returns the original sequence', async () => {
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
    // A second, unrelated event so a replay of op-1 could only "succeed
    // wrong" by appearing at the end (sequence 2) rather than staying put.
    await sink.append({ ...record, operationId: asOperationId('op-2'), payload: { kind: 'second' } });
    await sink.append(record);
    await sink.append(record);

    const ordered = await sink.listOrdered(namespace);
    expect(ordered).toHaveLength(2);
    expect(ordered.map((e) => e.sequence)).toEqual([1, 2]);
    expect(ordered[0]!.payload).toEqual({ kind: 'first' });
    conn.close();
  });

  it('rejects a changed-content replay under a reused operationId', async () => {
    const { conn, sink } = setup();
    const namespace = asNamespaceId('operation.ingest');
    await sink.append({
      operationId: asOperationId('op-1'),
      namespace,
      recordedAt: '2026-01-01T00:00:00.000Z',
      actorId: asActorId('actor-1'),
      payload: { kind: 'first' },
    });

    await expect(
      sink.append({
        operationId: asOperationId('op-1'),
        namespace,
        recordedAt: '2026-01-01T00:00:00.000Z',
        actorId: asActorId('actor-1'),
        payload: { kind: 'different content' },
      }),
    ).rejects.toThrow(OperationSinkIdempotencyMismatchError);

    // The rejected replay changed nothing -- still exactly the original row.
    const ordered = await sink.listOrdered(namespace);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]!.payload).toEqual({ kind: 'first' });
    conn.close();
  });

  it('ordering survives a real close and reopen of the database file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'governed-operation-sink-reopen-'));
    const filename = path.join(dir, 'governed.db');
    const namespace = asNamespaceId('operation.ingest');

    const first = openGovernedDatabase({ filename });
    first.migrate();
    const firstSink = new SqliteOperationSink(first.db);
    await firstSink.append({ operationId: asOperationId('op-1'), namespace, recordedAt: '2026-01-01T00:00:00.000Z', actorId: asActorId('actor-1'), payload: { kind: 'first' } });
    await firstSink.append({ operationId: asOperationId('op-2'), namespace, recordedAt: '2026-01-01T00:00:01.000Z', actorId: asActorId('actor-1'), payload: { kind: 'second' } });
    first.close();

    const reopened = openGovernedDatabase({ filename });
    reopened.migrate();
    const reopenedSink = new SqliteOperationSink(reopened.db);
    // A third event appended *after* reopen must continue the same
    // per-namespace sequence, not restart it.
    await reopenedSink.append({ operationId: asOperationId('op-3'), namespace, recordedAt: '2026-01-01T00:00:02.000Z', actorId: asActorId('actor-1'), payload: { kind: 'third' } });

    const ordered = await reopenedSink.listOrdered(namespace);
    expect(ordered.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(ordered.map((e) => e.payload.kind)).toEqual(['first', 'second', 'third']);
    reopened.close();
    fs.rmSync(dir, { recursive: true, force: true });
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

const suiteHealth = trackSuiteFailures();
const suiteStart = Date.now();

describe('INV2: operation sink acceptance evidence', () => {
  it('records inv2-operation-sink-append-only evidence once every case above has passed', () => {
    recordSuiteEvidence(suiteHealth, {
      checkId: 'inv2-operation-sink-append-only',
      suite: 'packages/governed/tests/sqlite/operation-sink.test.ts',
      fixture: 'SqliteOperationSink append/replay/ordering/UPDATE-DELETE-rejection, including a real file close+reopen',
      backend: 'sqlite',
      durationMs: Date.now() - suiteStart,
    });
  });
});
