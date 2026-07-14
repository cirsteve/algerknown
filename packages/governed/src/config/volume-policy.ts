export interface VolumeCap {
  windowMs: number;
  maxWrites: number;
}

export interface VolumePolicy {
  perProcessorCap: Record<string, VolumeCap>;
  defaultCap?: VolumeCap;
}

export const DEFAULT_VOLUME_POLICY: VolumePolicy = {
  perProcessorCap: {},
};

export function resolveVolumeCap(policy: VolumePolicy, processorId: string): VolumeCap | undefined {
  return policy.perProcessorCap[processorId] ?? policy.defaultCap;
}
