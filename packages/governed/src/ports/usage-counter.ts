import type { ProcessorId } from '../domain/ids.js';

/** Rolling-window write accounting per processor; recorded only on a successful prepared write. */
export interface UsageCounter {
  countInWindow(processorId: ProcessorId, windowMs: number, asOf: string): Promise<number>;
  record(processorId: ProcessorId, at: string): Promise<void>;
}
