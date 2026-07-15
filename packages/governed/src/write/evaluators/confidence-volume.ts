import type { NodeType } from '../../domain/node.js';
import type { ProcessorId } from '../../domain/ids.js';
import { resolveConfidenceFloor } from '../../config/confidence-policy.js';
import type { ConfidencePolicy } from '../../config/confidence-policy.js';
import { resolveVolumeCap } from '../../config/volume-policy.js';
import type { VolumePolicy } from '../../config/volume-policy.js';
import type { UsageCounter } from '../../ports/usage-counter.js';
import type { EvaluatorVerdict } from '../../domain/provenance.js';
import { makeVerdict } from './verdict.js';

export function evaluateConfidence(
  policy: ConfidencePolicy,
  nodeType: NodeType,
  confidence: number | undefined,
): EvaluatorVerdict {
  if (confidence === undefined) {
    return makeVerdict('confidence-volume', false, ['CONFIDENCE_MISSING']);
  }
  const floor = resolveConfidenceFloor(policy, nodeType);
  if (confidence < floor) {
    return makeVerdict('confidence-volume', false, ['CONFIDENCE_BELOW_FLOOR'], { floor, confidence });
  }
  return makeVerdict('confidence-volume', true);
}

export async function evaluateProcessorVolume(
  policy: VolumePolicy,
  usageCounter: UsageCounter,
  processorId: ProcessorId,
  asOf: string,
): Promise<EvaluatorVerdict> {
  const cap = resolveVolumeCap(policy, processorId);
  if (!cap) {
    return makeVerdict('confidence-volume', true);
  }
  const count = await usageCounter.countInWindow(processorId, cap.windowMs, asOf);
  if (count >= cap.maxWrites) {
    return makeVerdict('confidence-volume', false, ['PROCESSOR_VOLUME_CAP_EXCEEDED'], {
      count,
      maxWrites: cap.maxWrites,
      windowMs: cap.windowMs,
    });
  }
  return makeVerdict('confidence-volume', true);
}
