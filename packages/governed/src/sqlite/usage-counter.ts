import type { DatabaseType } from './connection.js';
import type { ProcessorId } from '../domain/ids.js';
import type { UsageCounter } from '../ports/usage-counter.js';

/** Rolling-window write accounting per processor, backed by an append-only timestamp log. */
export class SqliteUsageCounter implements UsageCounter {
  constructor(private readonly db: DatabaseType) {}

  async countInWindow(processorId: ProcessorId, windowMs: number, asOf: string): Promise<number> {
    const sinceIso = new Date(new Date(asOf).getTime() - windowMs).toISOString();
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM processor_usage WHERE processor_id = ? AND recorded_at > ? AND recorded_at <= ?')
      .get(processorId, sinceIso, asOf) as { count: number };
    return row.count;
  }

  async record(processorId: ProcessorId, at: string): Promise<void> {
    this.db.prepare('INSERT INTO processor_usage (processor_id, recorded_at) VALUES (?, ?)').run(processorId, at);
  }
}
