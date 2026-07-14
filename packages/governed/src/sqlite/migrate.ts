import { createHash } from 'node:crypto';
import type { DatabaseType } from './connection.js';
import { MIGRATIONS } from './migrations/index.js';
import type { MigrationDefinition } from './migrations/index.js';

export class MigrationChecksumMismatchError extends Error {
  constructor(migrationId: string) {
    super(`applied migration "${migrationId}" checksum has changed on disk; refusing to start`);
    this.name = 'MigrationChecksumMismatchError';
  }
}

export class MigrationDatabaseNewerError extends Error {
  constructor(migrationId: string) {
    super(`database has applied migration "${migrationId}" unknown to this adapter; refusing to start`);
    this.name = 'MigrationDatabaseNewerError';
  }
}

interface AppliedMigrationRow {
  id: string;
  applied_at: string;
  checksum: string;
}

function checksumOf(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

/**
 * Applies every unapplied migration inside one exclusive startup transaction.
 * Refuses to start if an already-applied migration's checksum has drifted or
 * if the database has applied a migration this adapter does not define
 * (i.e. the database schema is newer than the adapter).
 */
export function migrate(db: DatabaseType, migrations: MigrationDefinition[] = MIGRATIONS): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS governed_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL,
      checksum TEXT NOT NULL
    )`,
  );

  const definedIds = new Set(migrations.map((m) => m.id));
  const applied = db.prepare('SELECT id, applied_at, checksum FROM governed_migrations ORDER BY id').all() as AppliedMigrationRow[];
  const appliedById = new Map(applied.map((row) => [row.id, row]));

  for (const row of applied) {
    if (!definedIds.has(row.id)) {
      throw new MigrationDatabaseNewerError(row.id);
    }
  }

  for (const migration of migrations) {
    const appliedRow = appliedById.get(migration.id);
    if (appliedRow && appliedRow.checksum !== checksumOf(migration.sql)) {
      throw new MigrationChecksumMismatchError(migration.id);
    }
  }

  const pending = migrations.filter((m) => !appliedById.has(m.id));
  if (pending.length === 0) return;

  db.exec('BEGIN EXCLUSIVE');
  try {
    const insert = db.prepare('INSERT INTO governed_migrations (id, applied_at, checksum) VALUES (?, ?, ?)');
    for (const migration of pending) {
      db.exec(migration.sql);
      insert.run(migration.id, new Date().toISOString(), checksumOf(migration.sql));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** The id of the most recently applied migration, or null on an unmigrated database. */
export function schemaVersion(db: DatabaseType): string | null {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'governed_migrations'")
    .get();
  if (!table) return null;
  const row = db.prepare('SELECT id FROM governed_migrations ORDER BY id DESC LIMIT 1').get() as { id: string } | undefined;
  return row?.id ?? null;
}
