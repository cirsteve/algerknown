import type { NodeType } from '../domain/node.js';

export interface ConfidencePolicy {
  floors: Partial<Record<NodeType, number>>;
  defaultFloor: number;
}

export const DEFAULT_CONFIDENCE_POLICY: ConfidencePolicy = {
  floors: {},
  defaultFloor: 0.5,
};

export function resolveConfidenceFloor(policy: ConfidencePolicy, type: NodeType): number {
  return policy.floors[type] ?? policy.defaultFloor;
}
