import type { Processor, ProcessorId, ProcessorInfo } from '../../src/index.js';

export class StubProcessor implements Processor {
  private readonly registry = new Map<ProcessorId, ProcessorInfo>();

  register(info: ProcessorInfo): void {
    this.registry.set(info.id, info);
  }

  async describe(processorId: ProcessorId): Promise<ProcessorInfo | undefined> {
    return this.registry.get(processorId);
  }
}
