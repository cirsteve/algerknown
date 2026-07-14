import type { ProcessorId, UsageCounter } from '../../src/index.js';

/** Models an actual rolling window over recorded timestamps, not just a running total. */
export class InMemoryUsageCounter implements UsageCounter {
  private readonly recordedAt = new Map<ProcessorId, string[]>();

  async countInWindow(processorId: ProcessorId, windowMs: number, asOf: string): Promise<number> {
    const asOfMs = new Date(asOf).getTime();
    const timestamps = this.recordedAt.get(processorId) ?? [];
    return timestamps.filter((t) => {
      const age = asOfMs - new Date(t).getTime();
      return age >= 0 && age < windowMs;
    }).length;
  }

  async record(processorId: ProcessorId, at: string): Promise<void> {
    const timestamps = this.recordedAt.get(processorId) ?? [];
    timestamps.push(at);
    this.recordedAt.set(processorId, timestamps);
  }
}
