import type { ProcessorId } from './ids.js';
import type { ReasonCode } from './reason-codes.js';

export type ActorClass = 'human' | 'processor';

export type SourceReferenceKind = 'node' | 'edge' | 'observation' | 'external';

export interface SourceReference {
  kind: SourceReferenceKind;
  id: string;
  locator?: string;
}

export interface EvaluatorVerdict {
  evaluator: string;
  passed: boolean;
  reasonCodes: ReasonCode[];
  detail?: Record<string, unknown>;
}

export interface Provenance {
  sources: SourceReference[];
  processorId?: ProcessorId;
  processorVersion?: string;
  railId: string;
  evaluatorVerdicts: EvaluatorVerdict[];
  sourceDerived?: boolean;
}
