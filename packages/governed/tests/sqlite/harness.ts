import { openGovernedDatabase } from '../../src/sqlite/connection.js';
import type { GovernedConnection } from '../../src/sqlite/connection.js';
import { SqliteRepository } from '../../src/sqlite/repository.js';
import { SqliteOperationSink } from '../../src/sqlite/operation-sink.js';
import { SqliteUsageCounter } from '../../src/sqlite/usage-counter.js';
import { SqliteProposalRepository } from '../../src/sqlite/proposal-repository.js';
import { DEFAULT_GOVERNED_CONFIG } from '../../src/index.js';
import type { GovernedConfig, WriteOrchestratorDeps } from '../../src/index.js';
import {
  createTestClock,
  createTestIdGenerator,
  StubProcessor,
  ConfigurableContradictionDetector,
  StubAttestationVerifier,
} from '../fixtures/deps.js';

export interface SqliteTestHarness extends WriteOrchestratorDeps {
  connection: GovernedConnection;
  repository: SqliteRepository;
  proposalRepository: SqliteProposalRepository;
  operationSink: SqliteOperationSink;
  usageCounter: SqliteUsageCounter;
}

/** Wires WriteOrchestratorDeps with real SQLite-backed adapters against a fresh migrated database. */
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
    proposalRepository: new SqliteProposalRepository(connection.db),
    operationSink: new SqliteOperationSink(connection.db),
    processor: new StubProcessor(),
    contradictionDetector: new ConfigurableContradictionDetector(),
    attestationVerifier: new StubAttestationVerifier(),
    usageCounter: new SqliteUsageCounter(connection.db),
    clock: createTestClock(),
    idGenerator: createTestIdGenerator(),
  };
}
