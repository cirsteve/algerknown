import { HUMAN_POLICY_MODE } from './human.js';
import { HUMAN_GATED_POLICY_MODE } from './human-gated.js';
import { AI_WITH_RAILS_POLICY_MODE } from './ai-with-rails.js';
import type { PolicyModeCapabilities, PolicyModeRegistry } from './policy-mode.js';
import type { PolicyId } from '../config/namespace-policy.js';

export const BUILT_IN_POLICY_MODES: PolicyModeRegistry = {
  human: HUMAN_POLICY_MODE,
  'human-gated': HUMAN_GATED_POLICY_MODE,
  'ai-with-rails': AI_WITH_RAILS_POLICY_MODE,
};

export function resolvePolicyMode(policy: PolicyId, registry: PolicyModeRegistry = BUILT_IN_POLICY_MODES): PolicyModeCapabilities {
  const mode = registry[policy];
  if (!mode) {
    throw new Error(`unregistered policy mode "${policy}"`);
  }
  return mode;
}
