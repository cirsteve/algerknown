import * as path from 'node:path';
import { defaultNamespaceBindingsPath } from './namespace-bindings.js';

export class GovernanceCompositionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GovernanceCompositionConfigError';
  }
}

export interface GovernanceCompositionConfig {
  /** Durable SQLite database file backing proposals, sqlite-engine namespaces, and web-owned operation intents. */
  dbPath: string;
  /** Root of the git-backed Algerknown content repository. */
  algerknownRoot: string;
  /** JSON file listing the DossierBinding[] that determine governed canonical.project.* namespaces. */
  namespaceBindingsPath: string;
  processorId: string;
  processorVersion: string;
}

/**
 * Reads the composition root's required configuration. Fails closed: when
 * governance is enabled (per GovernanceConfig from ../auth/governance-config.js)
 * but this configuration is incomplete, startup must not silently fall back
 * to an ungoverned or partially-governed server.
 */
export function loadGovernanceCompositionConfig(env: NodeJS.ProcessEnv = process.env): GovernanceCompositionConfig {
  const dbPath = env.GOVERNANCE_DB_PATH;
  const algerknownRoot = env.ALGERKNOWN_ROOT;

  if (!dbPath) {
    throw new GovernanceCompositionConfigError('GOVERNANCE_DB_PATH is required when governance is enabled');
  }
  if (!algerknownRoot) {
    throw new GovernanceCompositionConfigError('ALGERKNOWN_ROOT is required when governance is enabled');
  }

  const resolvedRoot = path.resolve(algerknownRoot);
  const processorId = env.GOVERNANCE_PROCESSOR_ID;
  if (!processorId) {
    throw new GovernanceCompositionConfigError('GOVERNANCE_PROCESSOR_ID is required when governance is enabled');
  }

  return {
    dbPath: path.resolve(dbPath),
    algerknownRoot: resolvedRoot,
    namespaceBindingsPath: env.GOVERNANCE_NAMESPACE_BINDINGS_PATH
      ? path.resolve(env.GOVERNANCE_NAMESPACE_BINDINGS_PATH)
      : defaultNamespaceBindingsPath(resolvedRoot),
    processorId,
    processorVersion: env.GOVERNANCE_PROCESSOR_VERSION ?? 'rag-backend',
  };
}
