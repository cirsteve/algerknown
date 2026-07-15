import type { DatabaseType } from '../sqlite/connection.js';

/**
 * Wraps proposal-side bookkeeping (status transition, attestation record,
 * events, reversal, idempotency result) in one SQLite transaction opened
 * with BEGIN IMMEDIATE, which acquires the write lock up front and is
 * sufficient here since this unit of work only ever touches proposal
 * bookkeeping tables. When invoked inside SqliteRepository.commitAtomically,
 * it joins the existing transaction so target state and lifecycle state are
 * committed or rolled back together.
 */
export class SqliteUnitOfWork {
  constructor(private readonly db: DatabaseType) {}

  run<T>(fn: () => T): T {
    if (this.db.inTransaction) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
