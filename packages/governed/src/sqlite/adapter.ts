import { openGovernedDatabase } from './connection.js';
import type { GovernedConnection, GovernedSqliteConfig } from './connection.js';
import { SqliteRepository } from './repository.js';
import { SqliteOperationSink } from './operation-sink.js';
import { SqliteUsageCounter } from './usage-counter.js';
import { SqliteProposalRepository } from './proposal-repository.js';
import { DurableProposalService } from '../proposals/service.js';
import { WriteOrchestrator } from '../write/orchestrator.js';
import { DEFAULT_GOVERNED_CONFIG } from '../config/governed-config.js';
import type { GovernedConfig } from '../config/governed-config.js';
import type { AttestationVerifier } from '../ports/attestation-verifier.js';
import type { ContradictionDetector } from '../ports/contradiction-detector.js';
import type { Processor } from '../ports/processor.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { PolicyModeRegistry } from '../rails/policy-mode.js';

export interface SqliteGovernedAdapterDeps {
  attestationVerifier: AttestationVerifier;
  contradictionDetector: ContradictionDetector;
  processor: Processor;
  clock: Clock;
  idGenerator: IdGenerator;
  config?: GovernedConfig;
  policyModes?: PolicyModeRegistry;
}

export interface SqliteGovernedAdapter {
  connection: GovernedConnection;
  repository: SqliteRepository;
  proposalRepository: SqliteProposalRepository;
  operationSink: SqliteOperationSink;
  usageCounter: SqliteUsageCounter;
  orchestrator: WriteOrchestrator;
  proposalService: DurableProposalService;
}

/**
 * Single registration point wiring every SQLite-backed piece of this cohort
 * (connection, migrations, repository, proposal repository, operation sink,
 * usage counter) together with the core WriteOrchestrator and the durable
 * proposal lifecycle service, against one migrated database. Callers still
 * supply the ports this package intentionally does not implement itself
 * (attestation verification, contradiction detection, processor identity,
 * clock, id generation) -- this only removes the SQLite wiring boilerplate.
 */
export function createSqliteGovernedAdapter(sqliteConfig: GovernedSqliteConfig, deps: SqliteGovernedAdapterDeps): SqliteGovernedAdapter {
  const connection = openGovernedDatabase(sqliteConfig);
  connection.migrate();

  const repository = new SqliteRepository(connection.db);
  const proposalRepository = new SqliteProposalRepository(connection.db);
  const operationSink = new SqliteOperationSink(connection.db);
  const usageCounter = new SqliteUsageCounter(connection.db);

  const orchestrator = new WriteOrchestrator({
    config: deps.config ?? DEFAULT_GOVERNED_CONFIG,
    repository,
    proposalRepository,
    operationSink,
    processor: deps.processor,
    contradictionDetector: deps.contradictionDetector,
    attestationVerifier: deps.attestationVerifier,
    usageCounter,
    clock: deps.clock,
    idGenerator: deps.idGenerator,
    ...(deps.policyModes ? { policyModes: deps.policyModes } : {}),
  });

  const proposalService = new DurableProposalService({
    db: connection.db,
    orchestrator,
    attestationVerifier: deps.attestationVerifier,
    clock: deps.clock,
    idGenerator: deps.idGenerator,
  });

  return { connection, repository, proposalRepository, operationSink, usageCounter, orchestrator, proposalService };
}
