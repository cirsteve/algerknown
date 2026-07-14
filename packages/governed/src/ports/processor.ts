import type { ProcessorId } from '../domain/ids.js';

export interface ProcessorInfo {
  id: ProcessorId;
  version: string;
}

/** Resolves a claimed processor identity to its registered metadata, if any. */
export interface Processor {
  describe(processorId: ProcessorId): Promise<ProcessorInfo | undefined>;
}
