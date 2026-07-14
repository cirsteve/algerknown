import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openGovernedDatabase,
  MigrationChecksumMismatchError,
  MigrationDatabaseNewerError,
  MIGRATIONS,
} from '../../src/sqlite/index.js';

describe('governed sqlite migrations', () => {
  const dirs: string[] = [];

  function tempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'governed-sqlite-'));
    dirs.push(dir);
    return join(dir, 'governed.db');
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrates a fresh in-memory database and reports the applied schema version', () => {
    const conn = openGovernedDatabase({ filename: ':memory:' });
    expect(conn.schemaVersion()).toBeNull();
    conn.migrate();
    expect(conn.schemaVersion()).toBe('0001_init');
    expect(conn.healthCheck()).toBe(true);
    conn.close();
  });

  it('migrates, closes, and reopens a real database file with the same schema version', () => {
    const filename = tempDbPath();

    const first = openGovernedDatabase({ filename });
    first.migrate();
    const versionAfterFirstMigrate = first.schemaVersion();
    expect(versionAfterFirstMigrate).toBe('0001_init');
    first.close();

    const second = openGovernedDatabase({ filename });
    // Re-running migrate on an already-migrated database is a no-op, not an error.
    second.migrate();
    expect(second.schemaVersion()).toBe(versionAfterFirstMigrate);
    expect(second.healthCheck()).toBe(true);
    second.close();
  });

  it('reports unhealthy after close', () => {
    const conn = openGovernedDatabase({ filename: ':memory:' });
    conn.migrate();
    conn.close();
    expect(conn.healthCheck()).toBe(false);
  });

  it('creates the tables and triggers declared by the init migration', () => {
    const conn = openGovernedDatabase({ filename: ':memory:' });
    conn.migrate();
    const tables = conn.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    for (const expected of [
      'namespaces',
      'current_nodes',
      'current_edges',
      'namespace_revisions',
      'node_revisions',
      'edge_revisions',
      'idempotency_records',
      'processor_usage',
      'proposals',
      'proposal_versions',
      'proposal_events',
      'attestations',
      'evaluator_verdicts',
      'reversals',
      'audit_samples',
      'operation_events',
      'governed_migrations',
    ]) {
      expect(names).toContain(expected);
    }
    conn.close();
  });

  it('refuses to start when an applied migration checksum has drifted', () => {
    const conn = openGovernedDatabase({ filename: ':memory:' });
    conn.migrate();
    conn.db.prepare('UPDATE governed_migrations SET checksum = ? WHERE id = ?').run('tampered', '0001_init');
    expect(() => conn.migrate()).toThrow(MigrationChecksumMismatchError);
    conn.close();
  });

  it('refuses to start when the database has a migration unknown to this adapter', () => {
    const conn = openGovernedDatabase({ filename: ':memory:' });
    conn.migrate();
    conn.db
      .prepare('INSERT INTO governed_migrations (id, applied_at, checksum) VALUES (?, ?, ?)')
      .run('9999_future', new Date().toISOString(), 'whatever');
    expect(() => conn.migrate(MIGRATIONS)).toThrow(MigrationDatabaseNewerError);
    conn.close();
  });

  it('applies a fresh migration alongside previously applied ones without reapplying them', () => {
    const conn = openGovernedDatabase({ filename: ':memory:' });
    conn.migrate([MIGRATIONS[0]!]);
    expect(conn.schemaVersion()).toBe('0001_init');

    conn.db.exec('CREATE TABLE probe_marker (x INTEGER)');
    conn.migrate([MIGRATIONS[0]!, { id: '0002_noop', sql: '-- no-op migration' }]);
    expect(conn.schemaVersion()).toBe('0002_noop');
    // Proves 0001_init was not reapplied (which would have failed: table already exists).
    expect(conn.db.prepare("SELECT name FROM sqlite_master WHERE name = 'probe_marker'").get()).toBeTruthy();
    conn.close();
  });
});
