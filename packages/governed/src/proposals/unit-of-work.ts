import type { DatabaseType } from '../sqlite/connection.js';

/**
 * Wraps proposal-side bookkeeping (status transition, attestation record,
 * events, reversal, idempotency result) in one SQLite transaction opened
 * with BEGIN IMMEDIATE, which acquires the write lock up front and is
 * sufficient here since this unit of work only ever touches proposal
 * bookkeeping tables after the governed write has already committed.
 * The governed write itself is already atomic via SqliteRepository.commit,
 * which WriteOrchestrator.write() invokes as its own transaction boundary;
 * that fixed orchestrator call sequence is outside this cohort's scope to
 * restructure, so this unit of work covers everything the adapter controls
 * after the write resolves, applied as a single all-or-nothing step.
 */
export class SqliteUnitOfWork {
  constructor(private readonly db: DatabaseType) {}

  run<T>(fn: () => T): T {
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
