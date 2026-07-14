import { openGovernedDatabase } from '../../src/sqlite/connection.js';
import type { GovernedConnection } from '../../src/sqlite/connection.js';
import { SqliteRepository } from '../../src/sqlite/repository.js';
import { SqliteOperationSink } from '../../src/sqlite/operation-sink.js';
import { SqliteUsageCounter } from '../../src/sqlite/usage-counter.js';
import { SqliteProposalRepository } from '../../src/sqlite/proposal-repository.js';
import { DurableProposalService } from '../../src/proposals/service.js';
import { DEFAULT_GOVERNED_CONFIG, WriteOrchestrator } from '../../src/index.js';
import type { Clock, GovernedConfig, IdGenerator } from '../../src/index.js';
import {
  createTestClock,
  createTestIdGenerator,
  StubProcessor,
  ConfigurableContradictionDetector,
  StubAttestationVerifier,
} from '../fixtures/deps.js';

export interface ProposalsTestHarness {
  connection: GovernedConnection;
  repository: SqliteRepository;
  proposalRepository: SqliteProposalRepository;
  operationSink: SqliteOperationSink;
  usageCounter: SqliteUsageCounter;
  attestationVerifier: StubAttestationVerifier;
  contradictionDetector: ConfigurableContradictionDetector;
  orchestrator: WriteOrchestrator;
  service: DurableProposalService;
  clock: Clock;
  idGenerator: IdGenerator;
}

export function createProposalsTestHarness(
  filename = ':memory:',
  config: GovernedConfig = DEFAULT_GOVERNED_CONFIG,
): ProposalsTestHarness {
  const connection = openGovernedDatabase({ filename });
  connection.migrate();

  const clock = createTestClock();
  const idGenerator = createTestIdGenerator();
  const attestationVerifier = new StubAttestationVerifier();
  const contradictionDetector = new ConfigurableContradictionDetector();

  const deps = {
    config,
    repository: new SqliteRepository(connection.db),
    proposalRepository: new SqliteProposalRepository(connection.db),
    operationSink: new SqliteOperationSink(connection.db),
    processor: new StubProcessor(),
    contradictionDetector,
    attestationVerifier,
    usageCounter: new SqliteUsageCounter(connection.db),
    clock,
    idGenerator,
  };

  const orchestrator = new WriteOrchestrator(deps);
  const service = new DurableProposalService({
    db: connection.db,
    orchestrator,
    attestationVerifier,
    clock,
    idGenerator,
  });

  return {
    connection,
    repository: deps.repository,
    proposalRepository: deps.proposalRepository,
    operationSink: deps.operationSink,
    usageCounter: deps.usageCounter,
    attestationVerifier,
    contradictionDetector,
    orchestrator,
    service,
    clock,
    idGenerator,
  };
}
