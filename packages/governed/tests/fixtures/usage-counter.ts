import type { ProcessorId, UsageCounter } from '../../src/index.js';

export class InMemoryUsageCounter implements UsageCounter {
  private readonly counts = new Map<ProcessorId, number>();

  async countInWindow(processorId: ProcessorId): Promise<number> {
    return this.counts.get(processorId) ?? 0;
  }

  async record(processorId: ProcessorId): Promise<void> {
    this.counts.set(processorId, (this.counts.get(processorId) ?? 0) + 1);
  }
}
