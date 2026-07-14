import { openGovernedDatabase } from '../../src/sqlite/connection.js';
import type { GovernedConnection } from '../../src/sqlite/connection.js';
import { SqliteRepository } from '../../src/sqlite/repository.js';
import { DEFAULT_GOVERNED_CONFIG } from '../../src/index.js';
import type { GovernedConfig, WriteOrchestratorDeps } from '../../src/index.js';
import {
  createTestClock,
  createTestIdGenerator,
  InMemoryProposalRepository,
  InMemoryOperationSink,
  StubProcessor,
  ConfigurableContradictionDetector,
  StubAttestationVerifier,
  InMemoryUsageCounter,
} from '../fixtures/deps.js';

export interface SqliteTestHarness extends WriteOrchestratorDeps {
  connection: GovernedConnection;
  repository: SqliteRepository;
  proposalRepository: InMemoryProposalRepository;
  operationSink: InMemoryOperationSink;
  usageCounter: InMemoryUsageCounter;
}

/** Wires WriteOrchestratorDeps with a real SqliteRepository against a fresh migrated database. */
export function createSqliteTestHarness(
  filename = ':memory:',
  config: GovernedConfig = DEFAULT_GOVERNED_CONFIG,
): SqliteTestHarness {
  const connection = openGovernedDatabase({ filename });
  connection.migrate();

  return {
    config,
    connection,
    repository: new SqliteRepository(connection.db),
    proposalRepository: new InMemoryProposalRepository(),
    operationSink: new InMemoryOperationSink(),
    processor: new StubProcessor(),
    contradictionDetector: new ConfigurableContradictionDetector(),
    attestationVerifier: new StubAttestationVerifier(),
    usageCounter: new InMemoryUsageCounter(),
    clock: createTestClock(),
    idGenerator: createTestIdGenerator(),
  };
}
