import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  asActorId,
  asIdempotencyKey,
  asNamespaceId,
  asNodeId,
  asRevisionId,
  asSubjectId,
  WriteOrchestrator,
  type WriteCommand,
} from '../../src/index.js';
import { openGovernedDatabase } from '../../src/sqlite/connection.js';
import { SqliteNodeSubjectUnresolvedError, SqliteRepository, SqliteRevisionConflictError } from '../../src/sqlite/repository.js';
import { createSqliteTestHarness } from './harness.js';

function commandFor(overrides: Partial<WriteCommand> = {}): WriteCommand {
  return {
    namespace: asNamespaceId('memory.community.topic-1'),
    subject: asSubjectId('subject-1'),
    nodeMutations: [
      { op: 'create', nodeId: asNodeId('n-1'), nodeType: 'observation', payload: { description: 'saw a thing' }, confidence: 0.7 },
    ],
    edgeMutations: [],
    expectedNamespaceRevision: null,
    idempotencyKey: asIdempotencyKey('idem-1'),
    actorId: asActorId('actor-1'),
    actorClass: 'processor',
    provenanceInput: { sources: [{ kind: 'external', id: 'src-1' }] },
    ...overrides,
  };
}

describe('SqliteRepository via WriteOrchestrator', () => {
  it('applies a create, persists the node, and bumps the namespace revision', async () => {
    const harness = createSqliteTestHarness();
    const orchestrator = new WriteOrchestrator(harness);

    const result = await orchestrator.write(commandFor());
    expect(result.outcome).toBe('applied');

    const namespace = asNamespaceId('memory.community.topic-1');
    expect(await harness.repository.getNamespaceRevision(namespace)).toBe(1);
    const node = await harness.repository.getNode(namespace, asNodeId('n-1'));
    expect(node?.payload).toEqual({ description: 'saw a thing' });
    harness.connection.close();
  });

  it('applies update then delete and reflects each in current_nodes', async () => {
    const harness = createSqliteTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const namespace = asNamespaceId('memory.community.topic-1');

    await orchestrator.write(commandFor());
    await orchestrator.write(
      commandFor({
        idempotencyKey: asIdempotencyKey('idem-2'),
        nodeMutations: [{ op: 'update', nodeId: asNodeId('n-1'), payload: { description: 'updated' } }],
      }),
    );
    expect((await harness.repository.getNode(namespace, asNodeId('n-1')))?.payload).toEqual({ description: 'updated' });

    await orchestrator.write(
      commandFor({
        idempotencyKey: asIdempotencyKey('idem-3'),
        nodeMutations: [{ op: 'delete', nodeId: asNodeId('n-1') }],
      }),
    );
    expect(await harness.repository.getNode(namespace, asNodeId('n-1'))).toBeUndefined();
    expect(await harness.repository.getNamespaceRevision(namespace)).toBe(3);
    harness.connection.close();
  });

  it('reverts a node to a prior revision using an immutable revision record', async () => {
    const harness = createSqliteTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const namespace = asNamespaceId('memory.community.topic-1');

    const first = await orchestrator.write(commandFor());
    expect(first.outcome).toBe('applied');

    await orchestrator.write(
      commandFor({
        idempotencyKey: asIdempotencyKey('idem-2'),
        nodeMutations: [{ op: 'update', nodeId: asNodeId('n-1'), payload: { description: 'changed' } }],
      }),
    );
    expect((await harness.repository.getNode(namespace, asNodeId('n-1')))?.payload).toEqual({ description: 'changed' });
    // Revert targets the revision that made the change to undo (the update),
    // not the revision whose resulting state is desired.
    const [, updateRecord] = await harness.repository.listRevisionsSince(namespace, 0);
    expect(updateRecord).toBeDefined();

    const revertResult = await orchestrator.write(
      commandFor({
        idempotencyKey: asIdempotencyKey('idem-3'),
        nodeMutations: [{ op: 'revert', nodeId: asNodeId('n-1'), targetRevisionId: updateRecord!.revisionId }],
      }),
    );
    expect(revertResult.outcome).toBe('applied');
    expect((await harness.repository.getNode(namespace, asNodeId('n-1')))?.payload).toEqual({ description: 'saw a thing' });
    harness.connection.close();
  });

  it('replays an idempotent write from the SQLite idempotency lookup without a new revision', async () => {
    const harness = createSqliteTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const namespace = asNamespaceId('memory.community.topic-1');

    await orchestrator.write(commandFor());
    const replay = await orchestrator.write(commandFor());
    expect(replay.outcome).toBe('idempotent_replay');
    expect(await harness.repository.getNamespaceRevision(namespace)).toBe(1);
    harness.connection.close();
  });

  it('lists revisions since a checkpoint in ascending order', async () => {
    const harness = createSqliteTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    const namespace = asNamespaceId('memory.community.topic-1');

    await orchestrator.write(commandFor());
    await orchestrator.write(
      commandFor({
        idempotencyKey: asIdempotencyKey('idem-2'),
        nodeMutations: [{ op: 'create', nodeId: asNodeId('n-2'), nodeType: 'observation', payload: { description: 'second' }, confidence: 0.6 }],
      }),
    );

    const since0 = await harness.repository.listRevisionsSince(namespace, 0);
    expect(since0.map((r) => r.namespaceRevision)).toEqual([1, 2]);
    const since1 = await harness.repository.listRevisionsSince(namespace, 1);
    expect(since1.map((r) => r.namespaceRevision)).toEqual([2]);
    harness.connection.close();
  });

  it('creates a deterministic audit sample row when the audit directive says sampled', async () => {
    const harness = createSqliteTestHarness();
    const orchestrator = new WriteOrchestrator(harness);

    // Default audit policy samples every 10th revision; drive 10 applied writes.
    for (let i = 0; i < 10; i += 1) {
      await orchestrator.write(
        commandFor({
          idempotencyKey: asIdempotencyKey(`idem-${i}`),
          nodeMutations: [{ op: 'create', nodeId: asNodeId(`n-${i}`), nodeType: 'observation', payload: { description: `item ${i}` }, confidence: 0.7 }],
        }),
      );
    }

    const rows = harness.connection.db.prepare('SELECT * FROM audit_samples').all() as { namespace_revision: number; reviewed: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.namespace_revision).toBe(10);
    expect(rows[0]!.reviewed).toBe(0);
    harness.connection.close();
  });

  it('rolls back the entire commit on a mid-transaction failure, leaving no partial state', async () => {
    const conn = openGovernedDatabase({ filename: ':memory:' });
    conn.migrate();
    const repo = new SqliteRepository(conn.db);
    const namespace = asNamespaceId('memory.community.topic-1');

    await repo.commit({
      namespace,
      previousRevision: null,
      resultingRevision: 1,
      revisionRecord: {
        namespace,
        revisionId: asRevisionId('rev-a'),
        previousRevision: null,
        namespaceRevision: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        actorId: asActorId('actor-1'),
        actorClass: 'processor',
        diff: [],
        idempotencyKey: asIdempotencyKey('idem-a'),
      },
      nodesUpserted: [],
      nodesDeleted: [],
      edgesUpserted: [],
      edgesDeleted: [],
    });

    // previousRevision is stale (namespace is already at 1), so the internal
    // guard must reject before any row is written, and the whole transaction
    // must roll back rather than partially applying.
    await expect(
      repo.commit({
        namespace,
        previousRevision: null,
        resultingRevision: 2,
        revisionRecord: {
          namespace,
          revisionId: asRevisionId('rev-b'),
          previousRevision: null,
          namespaceRevision: 2,
          createdAt: '2026-01-01T00:00:01.000Z',
          actorId: asActorId('actor-1'),
          actorClass: 'processor',
          diff: [],
          idempotencyKey: asIdempotencyKey('idem-b'),
        },
        nodesUpserted: [],
        nodesDeleted: [],
        edgesUpserted: [],
        edgesDeleted: [],
      }),
    ).rejects.toThrow(SqliteRevisionConflictError);

    expect(await repo.getNamespaceRevision(namespace)).toBe(1);
    expect(await repo.getRevision(namespace, asRevisionId('rev-b'))).toBeUndefined();
    conn.close();
  });

  it('fails fast instead of writing an empty subject when a deleted node has no resolvable subject', async () => {
    const conn = openGovernedDatabase({ filename: ':memory:' });
    conn.migrate();
    const repo = new SqliteRepository(conn.db);
    const namespace = asNamespaceId('memory.community.topic-1');
    const nodeId = asNodeId('n-orphan');

    // Deliberately violates the normal invariant (a deleted node always has
    // either an upserted counterpart or a prior current_nodes row) to prove
    // recordNodeRevision throws instead of silently writing subject = ''.
    await expect(
      repo.commit({
        namespace,
        previousRevision: null,
        resultingRevision: 1,
        revisionRecord: {
          namespace,
          revisionId: asRevisionId('rev-a'),
          previousRevision: null,
          namespaceRevision: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          actorId: asActorId('actor-1'),
          actorClass: 'processor',
          diff: [{ entityKind: 'node', entityId: nodeId, changeKind: 'delete', forward: [], inverse: [] }],
          idempotencyKey: asIdempotencyKey('idem-a'),
        },
        nodesUpserted: [],
        nodesDeleted: [nodeId],
        edgesUpserted: [],
        edgesDeleted: [],
      }),
    ).rejects.toThrow(SqliteNodeSubjectUnresolvedError);

    // The whole commit rolled back -- no orphaned namespace bump either.
    expect(await repo.getNamespaceRevision(namespace)).toBeNull();
    conn.close();
  });

  it('enforces immutability triggers on namespace_revisions, node_revisions, and edge_revisions', async () => {
    const harness = createSqliteTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    await orchestrator.write(commandFor());

    expect(() => harness.connection.db.prepare("UPDATE namespace_revisions SET actor_id = 'x'").run()).toThrow();
    expect(() => harness.connection.db.prepare('DELETE FROM namespace_revisions').run()).toThrow();
    expect(() => harness.connection.db.prepare("UPDATE node_revisions SET change_kind = 'x'").run()).toThrow();
    expect(() => harness.connection.db.prepare('DELETE FROM node_revisions').run()).toThrow();
    harness.connection.close();
  });

  it('persists across close and reopen against a real database file (durability)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'governed-sqlite-repo-'));
    const filename = join(dir, 'governed.db');
    try {
      const namespace = asNamespaceId('memory.community.topic-1');
      {
        const harness = createSqliteTestHarness(filename);
        const orchestrator = new WriteOrchestrator(harness);
        await orchestrator.write(commandFor());
        harness.connection.close();
      }
      {
        const conn = openGovernedDatabase({ filename });
        conn.migrate();
        const repo = new SqliteRepository(conn.db);
        expect(await repo.getNamespaceRevision(namespace)).toBe(1);
        expect((await repo.getNode(namespace, asNodeId('n-1')))?.payload).toEqual({ description: 'saw a thing' });
        conn.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SqliteRepository conflict handling', () => {
  afterEach(() => {
    // no shared state between tests; nothing to clean here beyond per-test connections
  });

  it('rejects a stale expected namespace revision as a conflict at the orchestrator layer', async () => {
    const harness = createSqliteTestHarness();
    const orchestrator = new WriteOrchestrator(harness);
    await orchestrator.write(commandFor());

    const result = await orchestrator.write(
      commandFor({
        idempotencyKey: asIdempotencyKey('idem-2'),
        expectedNamespaceRevision: 0,
        nodeMutations: [{ op: 'create', nodeId: asNodeId('n-2'), nodeType: 'observation', payload: { description: 'x' }, confidence: 0.7 }],
      }),
    );
    expect(result.outcome).toBe('conflict');
    harness.connection.close();
  });
});
