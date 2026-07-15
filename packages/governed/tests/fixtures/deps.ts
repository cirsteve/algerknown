import { DEFAULT_GOVERNED_CONFIG, type GovernedConfig, type WriteOrchestratorDeps } from '../../src/index.js';
import { createTestClock } from './clock.js';
import { createTestIdGenerator } from './id-generator.js';
import { InMemoryRepository } from './repository.js';
import { InMemoryProposalRepository } from './proposal-repository.js';
import { InMemoryOperationSink } from './operation-sink.js';
import { StubProcessor } from './processor.js';
import { ConfigurableContradictionDetector } from './contradiction-detector.js';
import { StubAttestationVerifier } from './attestation-verifier.js';
import { InMemoryUsageCounter } from './usage-counter.js';

export interface TestHarness extends WriteOrchestratorDeps {
  repository: InMemoryRepository;
  proposalRepository: InMemoryProposalRepository;
  operationSink: InMemoryOperationSink;
  processor: StubProcessor;
  contradictionDetector: ConfigurableContradictionDetector;
  attestationVerifier: StubAttestationVerifier;
  usageCounter: InMemoryUsageCounter;
}

export function createTestHarness(config: GovernedConfig = DEFAULT_GOVERNED_CONFIG): TestHarness {
  return {
    config,
    repository: new InMemoryRepository(),
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

export * from './clock.js';
export * from './id-generator.js';
export * from './repository.js';
export * from './proposal-repository.js';
export * from './operation-sink.js';
export * from './processor.js';
export * from './contradiction-detector.js';
export * from './attestation-verifier.js';
export * from './usage-counter.js';
