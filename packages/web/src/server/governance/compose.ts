import {
  DEFAULT_GOVERNED_CONFIG,
  DEFAULT_NODE_SCHEMAS,
  DurableProposalService,
  NamespaceMatcher,
  SqliteOperationSink,
  SqliteProposalRepository,
  SqliteRepository,
  SqliteUsageCounter,
  WriteOrchestrator,
  createReviewEventFactory,
  openGovernedDatabase,
  type Clock,
  type GovernedConfig,
  type Repository,
} from '@algerknown/governed';
import {
  ALGERKNOWN_ADAPTER_NODE_SCHEMAS,
  GitAlgerknownRepository,
  namespaceForBinding,
  type DossierBinding,
} from '@algerknown/governed/adapters/algerknown';
import { createLocalAttestationVerifier } from './attestation-verifier.js';
import { createStaticProcessor } from './processor.js';
import { createNoOpContradictionDetector } from './contradiction-detector.js';
import { createRoutingRepository } from './routing-repository.js';
import { createUuidIdGenerator } from './id-generator.js';
import { ensureGitOperationIntentsTable } from './git-operation-intents.js';
import { recoverIncompleteGitOperations } from './git-operation-recovery.js';
import { buildGovernedBoundaryManifest, writeGovernedBoundaryManifest } from './manifest.js';
import { loadNamespaceBindings } from './namespace-bindings.js';
import { loadGovernanceCompositionConfig, type GovernanceCompositionConfig } from './config.js';
import type { ReviewActionsDeps } from './review-actions.js';

export interface GovernanceComposition {
  config: GovernanceCompositionConfig;
  bindings: DossierBinding[];
  reviewActionsDeps: ReviewActionsDeps;
  proposalService: DurableProposalService;
  orchestrator: WriteOrchestrator;
  repository: Repository;
  namespaceMatcher: NamespaceMatcher;
  gitRepositoriesByNamespace: Map<string, GitAlgerknownRepository>;
  close(): void;
}

export interface CreateGovernanceCompositionOptions {
  env?: NodeJS.ProcessEnv;
  clock?: Clock;
  log?: (message: string) => void;
}

/**
 * The single operational boundary composing the governed core, the SQLite
 * proposal service, and the Algerknown git/YAML adapter into one
 * authoritative write path. Startup fails closed: any missing/invalid piece
 * throws here rather than falling back to a partially-governed server.
 */
export async function createGovernanceComposition(opts: CreateGovernanceCompositionOptions = {}): Promise<GovernanceComposition> {
  const env = opts.env ?? process.env;
  const clock = opts.clock ?? { now: () => new Date().toISOString() };
  const log = opts.log ?? ((message: string) => console.log(`[governance] ${message}`));

  const config = loadGovernanceCompositionConfig(env);
  const bindings = loadNamespaceBindings(config.namespaceBindingsPath);

  // Runtime manifest: the sole source of truth @algerknown/core's boundary
  // reader consults, regenerated fresh from the current bindings every
  // startup so it can never drift from what this process actually governs.
  const manifest = buildGovernedBoundaryManifest(bindings, clock.now());
  writeGovernedBoundaryManifest(config.algerknownRoot, manifest);

  const connection = openGovernedDatabase({ filename: config.dbPath });
  connection.migrate();
  ensureGitOperationIntentsTable(connection.db);

  const sqliteRepository = new SqliteRepository(connection.db);
  const proposalRepository = new SqliteProposalRepository(connection.db);
  const operationSink = new SqliteOperationSink(connection.db);
  const usageCounter = new SqliteUsageCounter(connection.db);

  const gitRepositoriesByNamespace = new Map<string, GitAlgerknownRepository>();
  for (const binding of bindings) {
    const namespace = String(namespaceForBinding(binding));
    if (gitRepositoriesByNamespace.has(namespace)) {
      throw new Error(`namespace "${namespace}" is bound to more than one dossier`);
    }
    gitRepositoriesByNamespace.set(namespace, new GitAlgerknownRepository({ repoRoot: config.algerknownRoot, binding }));
  }

  const repository = createRoutingRepository(new Map(gitRepositoriesByNamespace), sqliteRepository);
  const attestationVerifier = createLocalAttestationVerifier();
  const processor = createStaticProcessor(config.processorId, config.processorVersion);
  const contradictionDetector = createNoOpContradictionDetector();
  const idGenerator = createUuidIdGenerator();
  const namespaceMatcher = new NamespaceMatcher(DEFAULT_GOVERNED_CONFIG.namespaceTable);
  const reviewEventFactory = createReviewEventFactory({ clock });

  // fact/observation/resource/prohibition use the schema variants the git
  // adapter's mapping can actually round-trip (see ALGERKNOWN_ADAPTER_NODE_SCHEMAS);
  // interaction/decision/proposal keep their generic definitions, which only
  // sqlite-engine (memory.*/operation.*) namespaces can meaningfully use.
  const governedConfig: GovernedConfig = {
    ...DEFAULT_GOVERNED_CONFIG,
    schemas: { ...DEFAULT_NODE_SCHEMAS, ...ALGERKNOWN_ADAPTER_NODE_SCHEMAS },
  };

  const orchestrator = new WriteOrchestrator({
    config: governedConfig,
    repository,
    proposalRepository,
    operationSink,
    processor,
    contradictionDetector,
    attestationVerifier,
    usageCounter,
    clock,
    idGenerator,
  });

  const proposalService = new DurableProposalService({
    db: connection.db,
    orchestrator,
    attestationVerifier,
    clock,
    idGenerator,
  });

  const reviewActionsDeps: ReviewActionsDeps = {
    db: connection.db,
    proposalService,
    attestationVerifier,
    reviewEventFactory,
    idGenerator,
    clock,
    namespaceMatcher,
    gitRepositoriesByNamespace,
  };

  log(`recovering incomplete git operation intents (${bindings.length} bound namespace(s))`);
  await recoverIncompleteGitOperations({ db: connection.db, proposalService, clock, log });

  return {
    config,
    bindings,
    reviewActionsDeps,
    proposalService,
    orchestrator,
    repository,
    namespaceMatcher,
    gitRepositoriesByNamespace,
    close: () => connection.close(),
  };
}
