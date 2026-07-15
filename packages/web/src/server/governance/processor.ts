import { asProcessorId, type Processor, type ProcessorInfo } from '@algerknown/governed';

/**
 * Single-operator trust profile: exactly one registered processor identity
 * (the RAG backend), configured via GOVERNANCE_PROCESSOR_ID/_SECRET and
 * already authenticated by requireProcessorAuth before this is consulted.
 */
export function createStaticProcessor(processorId: string, version: string): Processor {
  const registered = asProcessorId(processorId);
  return {
    async describe(id): Promise<ProcessorInfo | undefined> {
      if (id !== registered) return undefined;
      return { id: registered, version };
    },
  };
}
