import { describe, expect, it } from 'vitest';
import { asProcessorId } from '../../src/index.js';
import { openGovernedDatabase } from '../../src/sqlite/connection.js';
import { SqliteUsageCounter } from '../../src/sqlite/usage-counter.js';

describe('SqliteUsageCounter', () => {
  function setup() {
    const conn = openGovernedDatabase({ filename: ':memory:' });
    conn.migrate();
    return { conn, counter: new SqliteUsageCounter(conn.db) };
  }

  it('counts only records within the rolling window ending at asOf', async () => {
    const { conn, counter } = setup();
    const processorId = asProcessorId('proc-1');

    // Window is (asOf - windowMs, asOf]: 00:00:00 sits exactly on the excluded
    // lower boundary, 00:00:30 is inside, and 00:01:30 is after asOf entirely.
    await counter.record(processorId, '2026-01-01T00:00:00.000Z');
    await counter.record(processorId, '2026-01-01T00:00:30.000Z');
    await counter.record(processorId, '2026-01-01T00:01:30.000Z');

    const count = await counter.countInWindow(processorId, 60_000, '2026-01-01T00:01:00.000Z');
    expect(count).toBe(1);
    conn.close();
  });

  it('excludes the lower window boundary but includes asOf itself', async () => {
    const { conn, counter } = setup();
    const processorId = asProcessorId('proc-1');
    await counter.record(processorId, '2026-01-01T00:00:00.000Z');
    await counter.record(processorId, '2026-01-01T00:01:00.000Z');

    expect(await counter.countInWindow(processorId, 60_000, '2026-01-01T00:01:00.000Z')).toBe(1);
    conn.close();
  });

  it('tracks separate processors independently', async () => {
    const { conn, counter } = setup();
    await counter.record(asProcessorId('proc-a'), '2026-01-01T00:00:00.000Z');
    await counter.record(asProcessorId('proc-b'), '2026-01-01T00:00:00.000Z');
    await counter.record(asProcessorId('proc-b'), '2026-01-01T00:00:01.000Z');

    expect(await counter.countInWindow(asProcessorId('proc-a'), 60_000, '2026-01-01T00:00:10.000Z')).toBe(1);
    expect(await counter.countInWindow(asProcessorId('proc-b'), 60_000, '2026-01-01T00:00:10.000Z')).toBe(2);
    conn.close();
  });
});
