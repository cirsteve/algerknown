/** Human-readable messages for @algerknown/governed ReasonCode values; the API sends only the stable code. */
const REASON_CODE_MESSAGES: Record<string, string> = {
  CROSS_NAMESPACE_COMMAND: 'The command touched more than one namespace.',
  UNKNOWN_NAMESPACE: 'The target namespace is not registered.',
  AMBIGUOUS_NAMESPACE_MATCH: 'The namespace pattern matched more than one policy entry.',
  APPEND_ONLY_VIOLATION: 'The namespace is append-only and cannot be updated or deleted.',
  INVALID_MUTATION_SHAPE: 'A node or edge mutation had an invalid shape.',
  TARGET_NOT_FOUND: 'The mutation targeted an entity that does not exist.',
  STALE_REVISION: 'The namespace has moved past the expected revision.',
  IDEMPOTENCY_KEY_REPLAYED: 'This idempotency key was already used for a different request.',
  UNKNOWN_NODE_TYPE: 'The node type is not recognized.',
  SCHEMA_VALIDATION_FAILED: 'The payload failed schema validation.',
  TRUTH_TYPE_REQUIRES_CANONICAL_NAMESPACE: 'Fact/resource/prohibition nodes must live in a canonical namespace.',
  AI_TRUTH_MUTATION_FORBIDDEN: 'A processor actor cannot mutate a canonical truth type.',
  ACTOR_CLASS_NOT_PERMITTED_BY_POLICY: "The namespace's policy does not permit this actor class.",
  ATTESTATION_REQUIRED: 'This namespace requires a reviewer attestation before applying.',
  ATTESTATION_NOT_FOUND: 'No matching attestation was found.',
  ATTESTATION_MUTATION_MISMATCH: "The attestation's mutation hash does not match.",
  ATTESTATION_VERSION_MISMATCH: "The attestation's proposal version does not match.",
  ATTESTATION_TARGET_REVISION_MISMATCH: "The attestation's target revision does not match the current revision.",
  PROVENANCE_MISSING_SOURCE: 'The proposal is missing a source reference.',
  PROVENANCE_MISSING_DERIVED_FROM_EDGE: 'A derived node is missing its derived_from edge.',
  PROPOSAL_MISSING_OBSERVATION_SUPPORT: 'The proposal has no supporting observation.',
  PROPOSAL_MISSING_SUPPORT_EDGE: 'The proposal is missing a supporting edge to its observation.',
  CONFIDENCE_MISSING: 'A node mutation is missing a confidence value.',
  CONFIDENCE_BELOW_FLOOR: 'A node mutation is below the minimum confidence floor.',
  PROCESSOR_VOLUME_CAP_EXCEEDED: 'The processor exceeded its write volume cap.',
  CONTRADICTION_DETECTED: 'A higher-confidence existing node contradicts this proposal.',
  REVERT_TARGET_REVISION_NOT_FOUND: 'The revision being reverted to could not be found.',
};

export function reasonCodeMessage(code: string): string {
  return REASON_CODE_MESSAGES[code] ?? code;
}
