import { DEFAULT_NAMESPACE_TABLE } from './default-namespaces.js';
import { DEFAULT_NODE_SCHEMAS } from './default-schemas.js';
import { DEFAULT_CONFIDENCE_POLICY, type ConfidencePolicy } from './confidence-policy.js';
import { DEFAULT_VOLUME_POLICY, type VolumePolicy } from './volume-policy.js';
import { DEFAULT_AUDIT_POLICY, type AuditPolicy } from './audit-policy.js';
import type { NamespaceTableConfig } from './namespace-policy.js';
import type { NodeSchemaMap } from './schema-registry.js';

export interface GovernedConfig {
  namespaceTable: NamespaceTableConfig;
  schemas: NodeSchemaMap;
  confidencePolicy: ConfidencePolicy;
  volumePolicy: VolumePolicy;
  auditPolicy: AuditPolicy;
}

export const DEFAULT_GOVERNED_CONFIG: GovernedConfig = {
  namespaceTable: DEFAULT_NAMESPACE_TABLE,
  schemas: DEFAULT_NODE_SCHEMAS,
  confidencePolicy: DEFAULT_CONFIDENCE_POLICY,
  volumePolicy: DEFAULT_VOLUME_POLICY,
  auditPolicy: DEFAULT_AUDIT_POLICY,
};
