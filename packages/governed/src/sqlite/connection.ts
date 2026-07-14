import Database from 'better-sqlite3';
import { migrate, schemaVersion } from './migrate.js';
import type { MigrationDefinition } from './migrations/index.js';

export type DatabaseType = InstanceType<typeof Database>;

export interface GovernedSqliteConfig {
  /** Path to the SQLite database file, or ':memory:' for an ephemeral database. */
  filename: string;
  busyTimeoutMs?: number;
}

const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/**
 * A single configurable governed SQLite database. Opening applies integrity
 * pragmas immediately; callers must call migrate() explicitly before relying
 * on the schema being present.
 */
export interface GovernedConnection {
  readonly db: DatabaseType;
  readonly filename: string;
  /** Applies every unapplied migration; refuses to start on checksum drift or a newer database. */
  migrate(migrations?: MigrationDefinition[]): void;
  schemaVersion(): string | null;
  healthCheck(): boolean;
  close(): void;
}

function applyPragmas(db: DatabaseType, busyTimeoutMs: number): void {
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma(`busy_timeout = ${busyTimeoutMs}`);
}

/** Opens the database and applies pragmas; does not run migrations (call .migrate() explicitly). */
export function openGovernedDatabase(config: GovernedSqliteConfig): GovernedConnection {
  const db = new Database(config.filename);
  applyPragmas(db, config.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS);

  let closed = false;

  return {
    db,
    filename: config.filename,
    migrate(migrations?: MigrationDefinition[]): void {
      migrate(db, migrations);
    },
    schemaVersion(): string | null {
      return schemaVersion(db);
    },
    healthCheck(): boolean {
      if (closed) return false;
      try {
        const row = db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
        return row?.ok === 1;
      } catch {
        return false;
      }
    },
    close(): void {
      if (closed) return;
      db.close();
      closed = true;
    },
  };
}
