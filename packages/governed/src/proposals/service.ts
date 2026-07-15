import { randomUUID } from 'node:crypto';
import type { DatabaseType } from '../sqlite/connection.js';
import { canonicalStringify, contentHash } from '../sqlite/canonical.js';
import { computeProposalFingerprint } from '../sqlite/proposal-fingerprint.js';
import { SqliteUnitOfWork } from './unit-of-work.js';
import {
  ProposalAttestationError,
  ProposalIdempotencyMismatchError,
  ProposalInvalidTransitionError,
  ProposalNotFoundError,
  ProposalValidationError,
  ProposalVersionConflictError,
} from './errors.js';
import type {
  AcceptInput,
  AcceptOutcome,
  AmendInput,
  AuditSample,
  DeleteInput,
  DurableProposal,
  DurableProposalEvent,
  DurableProposalStatus,
  DurableProposalVersion,
  ExpireInput,
  MarkAuditSampleReviewedInput,
  ProposalInspection,
  ProposeInput,
  ProposeOutcome,
  ProposeRevertOutcome,
  RejectInput,
  RevertInput,
  RevertOutcome,
  ReviewMeasurements,
  ReviewMeasurementsQuery,
} from './types.js';
import {
  asActorId,
  asEventId,
  asIdempotencyKey,
  asMutationHash,
  asNamespaceId,
  asProcessorId,
  asProposalId,
  asRevisionId,
  asSubjectId,
} from '../domain/ids.js';
import type { ActorId, NamespaceId, ProposalId } from '../domain/ids.js';
import type { ActorClass, Provenance } from '../domain/provenance.js';
import type { WriteCommand } from '../domain/write-command.js';
import { normalizeWriteCommand } from '../write/normalize.js';
import type { WriteOrchestrator } from '../write/orchestrator.js';
import type { AttestationVerifier } from '../ports/attestation-verifier.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { Repository } from '../ports/repository.js';

export interface DurableProposalServiceDeps {
  db: DatabaseType;
  orchestrator: WriteOrchestrator;
  attestationVerifier: AttestationVerifier;
  clock: Clock;
  idGenerator: IdGenerator;
  /**
   * Same Repository the orchestrator writes through. buildRevertCommand reads
   * applied-revision ids and the current namespace revision from here rather
   * than the sqlite `namespace_revisions`/`namespaces` tables directly, so
   * revert works for every backend (git-backed namespaces never populate
   * those sqlite tables).
   */
  repository: Repository;
}

interface ProposalRow {
  proposal_id: string;
  target_namespace: string;
  target_subject: string;
  status: DurableProposalStatus;
  version: number;
  mutation_hash: string;
  fingerprint: string;
  expected_target_revision: number | null;
  created_at: string;
  updated_at: string;
  resulting_revision: number | null;
  reverted: number;
}

interface ProposalVersionRow {
  version_id: string;
  proposal_id: string;
  version: number;
  canonical_mutation_json: string;
  mutation_hash: string;
  expected_target_revision: number | null;
  supporting_observation_ids_json: string;
  provenance_json: string;
  created_at: string;
}

interface ProposalEventRow {
  event_id: string;
  proposal_id: string;
  kind: string;
  at: string;
  actor_id: string | null;
  proposal_version: number | null;
  reason: string | null;
  note: string | null;
  channel: string | null;
  review_batch_id: string | null;
  detail_json: string | null;
}

interface AuditSampleRow {
  sample_id: string;
  namespace: string;
  namespace_revision: number;
  processor_id: string | null;
  sampled_at: string;
  reviewed: number;
  reviewer_id: string | null;
  verdict: string | null;
  note: string | null;
  reviewed_at: string | null;
}

function rowToProposal(row: ProposalRow): DurableProposal {
  return {
    id: asProposalId(row.proposal_id),
    targetNamespace: asNamespaceId(row.target_namespace),
    targetSubject: asSubjectId(row.target_subject),
    status: row.status,
    version: row.version,
    mutationHash: asMutationHash(row.mutation_hash),
    fingerprint: row.fingerprint,
    expectedTargetRevision: row.expected_target_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resultingRevision: row.resulting_revision,
    reverted: row.reverted === 1,
  };
}

function rowToVersion(row: ProposalVersionRow): DurableProposalVersion {
  return {
    versionId: row.version_id,
    proposalId: asProposalId(row.proposal_id),
    version: row.version,
    canonicalMutation: JSON.parse(row.canonical_mutation_json),
    mutationHash: asMutationHash(row.mutation_hash),
    expectedTargetRevision: row.expected_target_revision,
    supportingObservationIds: JSON.parse(row.supporting_observation_ids_json),
    provenance: JSON.parse(row.provenance_json),
    createdAt: row.created_at,
  };
}

function rowToEvent(row: ProposalEventRow): DurableProposalEvent {
  const event: DurableProposalEvent = {
    eventId: asEventId(row.event_id),
    proposalId: asProposalId(row.proposal_id),
    kind: row.kind,
    at: row.at,
  };
  if (row.actor_id) event.actorId = asActorId(row.actor_id);
  if (row.proposal_version !== null) event.proposalVersion = row.proposal_version;
  if (row.reason) event.reason = row.reason;
  if (row.note) event.note = row.note;
  if (row.channel) event.channel = row.channel;
  if (row.review_batch_id) event.reviewBatchId = row.review_batch_id;
  if (row.detail_json) event.detail = JSON.parse(row.detail_json);
  return event;
}

function rowToAuditSample(row: AuditSampleRow): AuditSample {
  const sample: AuditSample = {
    sampleId: row.sample_id,
    namespace: asNamespaceId(row.namespace),
    namespaceRevision: row.namespace_revision,
    processorId: row.processor_id ? asProcessorId(row.processor_id) : undefined,
    sampledAt: row.sampled_at,
    reviewed: row.reviewed === 1,
  };
  if (row.reviewer_id) sample.reviewerId = asActorId(row.reviewer_id);
  if (row.verdict) sample.verdict = row.verdict;
  if (row.note) sample.note = row.note;
  if (row.reviewed_at) sample.reviewedAt = row.reviewed_at;
  return sample;
}

function provenanceFromInput(input: WriteCommand['provenanceInput'], railId: string): Provenance {
  return {
    sources: input.sources,
    railId,
    evaluatorVerdicts: [],
    ...(input.processorId !== undefined ? { processorId: input.processorId } : {}),
    ...(input.processorVersion !== undefined ? { processorVersion: input.processorVersion } : {}),
    ...(input.sourceDerived !== undefined ? { sourceDerived: input.sourceDerived } : {}),
  };
}

/**
 * Restart-safe proposal lifecycle (propose/inspect/amend/accept/reject/
 * expire/delete/revert) on top of the same durable `proposals` tables that
 * SqliteProposalRepository serves the settled ProposalRepository port from.
 * Every mutating action is idempotent per (scope, caller-supplied key) via
 * idempotency_records, and every non-inspect action runs inside one
 * SqliteUnitOfWork transaction. Corrections (amend/delete/revert) and
 * acceptance all route through the same WriteOrchestrator used elsewhere --
 * this class never mutates governed state directly.
 */
export class DurableProposalService {
  private readonly db: DatabaseType;
  private readonly orchestrator: WriteOrchestrator;
  private readonly attestationVerifier: AttestationVerifier;
  private readonly clock: Clock;
  private readonly idGenerator: IdGenerator;
  private readonly repository: Repository;
  private readonly unitOfWork: SqliteUnitOfWork;

  constructor(deps: DurableProposalServiceDeps) {
    this.db = deps.db;
    this.orchestrator = deps.orchestrator;
    this.attestationVerifier = deps.attestationVerifier;
    this.clock = deps.clock;
    this.idGenerator = deps.idGenerator;
    this.repository = deps.repository;
    this.unitOfWork = new SqliteUnitOfWork(deps.db);
  }

  async getProposal(proposalId: ProposalId): Promise<DurableProposal | undefined> {
    const row = this.getProposalRow(proposalId);
    return row ? rowToProposal(row) : undefined;
  }

  async inspect(proposalId: ProposalId, version?: number): Promise<ProposalInspection> {
    const row = this.mustGetProposalRow(proposalId);
    const targetVersion = version ?? row.version;
    const versionRow = this.getVersionRow(proposalId, targetVersion);
    if (!versionRow) throw new ProposalNotFoundError(`${proposalId}@v${targetVersion}`);
    const events = this.listEventRows(proposalId).map(rowToEvent);
    return { proposal: rowToProposal(row), currentVersion: rowToVersion(versionRow), events };
  }

  async propose(input: ProposeInput): Promise<ProposeOutcome> {
    const { command: normalized, mutationHash } = normalizeWriteCommand(input.mutation);
    const requestHash = contentHash({
      mutation: normalized,
      supportingObservationIds: [...input.supportingObservationIds].sort(),
    });

    const idem = this.checkIdempotency<
      { outcome: 'created'; proposalId: string } | { outcome: 'suppressed'; priorProposalId: string; reason: string | null }
    >('proposal.propose', input.idempotencyKey, requestHash);
    if (idem) {
      if (idem.outcome === 'created') {
        const proposal = await this.mustGetProposal(idem.proposalId);
        return { outcome: 'created', proposal };
      }
      return { outcome: 'suppressed', priorProposalId: asProposalId(idem.priorProposalId), reason: idem.reason ?? undefined };
    }

    const fingerprint = computeProposalFingerprint({
      targetNamespace: normalized.namespace,
      targetSubject: normalized.subject,
      nodeMutations: normalized.nodeMutations,
      edgeMutations: normalized.edgeMutations,
      supportingObservationIds: input.supportingObservationIds,
      sourceReferences: normalized.provenanceInput.sources,
    });

    const at = this.clock.now();

    return this.unitOfWork.run(() => {
      const priorRejected = this.db
        .prepare(
          `SELECT proposal_id, mutation_hash FROM proposals
           WHERE target_namespace = ? AND fingerprint = ? AND status = 'rejected'
           ORDER BY updated_at DESC LIMIT 1`,
        )
        .get(normalized.namespace, fingerprint) as { proposal_id: string; mutation_hash: string } | undefined;

      if (priorRejected && priorRejected.mutation_hash === mutationHash) {
        const rejectionEvent = this.db
          .prepare(`SELECT reason FROM proposal_events WHERE proposal_id = ? AND kind = 'rejected' ORDER BY at DESC LIMIT 1`)
          .get(priorRejected.proposal_id) as { reason: string | null } | undefined;
        const reason = rejectionEvent?.reason ?? null;

        this.recordIdempotency(
          'proposal.propose',
          input.idempotencyKey,
          requestHash,
          { outcome: 'suppressed', priorProposalId: priorRejected.proposal_id, reason },
          at,
        );
        return { outcome: 'suppressed', priorProposalId: asProposalId(priorRejected.proposal_id), reason: reason ?? undefined };
      }

      const proposalId = this.idGenerator.nextProposalId();
      const versionId = randomUUID();

      this.db
        .prepare(
          `INSERT INTO proposals
             (proposal_id, target_namespace, target_subject, status, version, mutation_hash, fingerprint,
              expected_target_revision, created_at, updated_at, resulting_revision, reverted)
           VALUES (?, ?, ?, 'pending', 1, ?, ?, ?, ?, ?, NULL, 0)`,
        )
        .run(proposalId, normalized.namespace, normalized.subject, mutationHash, fingerprint, normalized.expectedNamespaceRevision, at, at);

      this.db
        .prepare(
          `INSERT INTO proposal_versions
             (version_id, proposal_id, version, canonical_mutation_json, mutation_hash, expected_target_revision,
              supporting_observation_ids_json, provenance_json, created_at)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          proposalId,
          canonicalStringify(normalized),
          mutationHash,
          normalized.expectedNamespaceRevision,
          canonicalStringify(input.supportingObservationIds),
          canonicalStringify(provenanceFromInput(normalized.provenanceInput, 'durable-proposal')),
          at,
        );

      this.insertEvent({ eventId: this.idGenerator.nextEventId(), proposalId, kind: 'proposed', at, proposalVersion: 1 });

      const proposal = rowToProposal(this.getProposalRow(proposalId)!);
      this.recordIdempotency('proposal.propose', input.idempotencyKey, requestHash, { outcome: 'created', proposalId }, at);
      return { outcome: 'created', proposal };
    });
  }

  async amend(proposalId: ProposalId, input: AmendInput): Promise<DurableProposal> {
    const row = this.mustGetProposalRow(proposalId);
    if (row.status !== 'pending') throw new ProposalInvalidTransitionError(proposalId, row.status, 'amend');
    if (row.version !== input.expectedVersion) throw new ProposalVersionConflictError(proposalId, input.expectedVersion, row.version);

    const { command: normalized, mutationHash } = normalizeWriteCommand(input.mutation);
    const requestHash = contentHash({
      expectedVersion: input.expectedVersion,
      mutation: normalized,
      supportingObservationIds: [...input.supportingObservationIds].sort(),
    });
    const idem = this.checkIdempotency<{ proposalId: string }>('proposal.amend', input.idempotencyKey, requestHash);
    if (idem) return (await this.getProposal(asProposalId(idem.proposalId)))!;

    const fingerprint = computeProposalFingerprint({
      targetNamespace: asNamespaceId(row.target_namespace),
      targetSubject: asSubjectId(row.target_subject),
      nodeMutations: normalized.nodeMutations,
      edgeMutations: normalized.edgeMutations,
      supportingObservationIds: input.supportingObservationIds,
      sourceReferences: normalized.provenanceInput.sources,
    });
    const at = this.clock.now();

    return this.unitOfWork.run(() => {
      const newVersion = row.version + 1;
      this.db
        .prepare(
          `INSERT INTO proposal_versions
             (version_id, proposal_id, version, canonical_mutation_json, mutation_hash, expected_target_revision,
              supporting_observation_ids_json, provenance_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          proposalId,
          newVersion,
          canonicalStringify(normalized),
          mutationHash,
          normalized.expectedNamespaceRevision,
          canonicalStringify(input.supportingObservationIds),
          canonicalStringify(provenanceFromInput(normalized.provenanceInput, 'durable-proposal')),
          at,
        );

      this.db
        .prepare(
          `UPDATE proposals SET version = ?, mutation_hash = ?, fingerprint = ?, expected_target_revision = ?, updated_at = ?
           WHERE proposal_id = ?`,
        )
        .run(newVersion, mutationHash, fingerprint, normalized.expectedNamespaceRevision, at, proposalId);

      this.insertEvent({ eventId: this.idGenerator.nextEventId(), proposalId, kind: 'amended', at, proposalVersion: newVersion });

      const updated = rowToProposal(this.getProposalRow(proposalId)!);
      this.recordIdempotency('proposal.amend', input.idempotencyKey, requestHash, { proposalId }, at);
      return updated;
    });
  }

  async accept(proposalId: ProposalId, input: AcceptInput): Promise<AcceptOutcome> {
    const row = this.mustGetProposalRow(proposalId);
    if (row.status !== 'pending') throw new ProposalInvalidTransitionError(proposalId, row.status, 'accept');

    const requestHash = contentHash({
      expectedVersion: input.expectedVersion,
      expectedTargetRevision: input.expectedTargetRevision,
      attestationId: input.attestationId,
      actorId: input.actorId,
      channel: input.channel,
      reviewNote: input.reviewNote ?? null,
      reviewBatchId: input.reviewBatchId ?? null,
    });
    const idem = this.checkIdempotency<AcceptOutcome>('proposal.accept', input.idempotencyKey, requestHash);
    if (idem) return idem;

    const at = this.clock.now();

    if (row.version !== input.expectedVersion) {
      const result: AcceptOutcome = { outcome: 'version_conflict', expectedVersion: input.expectedVersion, actualVersion: row.version };
      this.unitOfWork.run(() => {
        this.insertEvent({ eventId: this.idGenerator.nextEventId(), proposalId, kind: 'accept_conflict', at, actorId: input.actorId, detail: result });
        this.recordIdempotency('proposal.accept', input.idempotencyKey, requestHash, result, at);
      });
      return result;
    }

    const versionRow = this.getVersionRow(proposalId, row.version)!;
    const currentVersion = rowToVersion(versionRow);

    const attestation = await this.attestationVerifier.verify({
      attestationId: input.attestationId,
      expectedProposalId: proposalId,
      expectedProposalVersion: row.version,
      expectedMutationHash: currentVersion.mutationHash,
    });
    if (!attestation) {
      throw new ProposalAttestationError(
        `no verifiable attestation "${input.attestationId}" for proposal "${proposalId}" version ${row.version}`,
      );
    }

    const command: WriteCommand = {
      ...currentVersion.canonicalMutation,
      expectedNamespaceRevision: input.expectedTargetRevision,
      attestation: { attestationId: input.attestationId },
    };

    const writeResult = await this.orchestrator.write(command);
    const applied =
      writeResult.outcome === 'applied'
        ? writeResult
        : writeResult.outcome === 'idempotent_replay' && writeResult.original.outcome === 'applied'
          ? writeResult.original
          : undefined;

    if (writeResult.outcome === 'conflict') {
      const result: AcceptOutcome = {
        outcome: 'target_revision_conflict',
        expectedRevision: writeResult.expectedRevision,
        actualRevision: writeResult.actualRevision,
      };
      this.unitOfWork.run(() => {
        this.insertEvent({ eventId: this.idGenerator.nextEventId(), proposalId, kind: 'accept_conflict', at, actorId: input.actorId, detail: result });
        this.recordIdempotency('proposal.accept', input.idempotencyKey, requestHash, result, at);
      });
      return result;
    }

    if (!applied) {
      const reasonCodes = writeResult.outcome === 'rejected' || writeResult.outcome === 'routed_to_proposal' ? writeResult.reasonCodes : [];
      throw new ProposalValidationError(`accept of proposal "${proposalId}" was not applied: ${writeResult.outcome} (${reasonCodes.join(', ')})`);
    }

    const result: AcceptOutcome = { outcome: 'accepted', resultingRevision: applied.resultingRevision };
    this.unitOfWork.run(() => {
      this.db.prepare(`UPDATE proposals SET status = 'accepted', resulting_revision = ?, updated_at = ? WHERE proposal_id = ?`).run(
        applied.resultingRevision,
        at,
        proposalId,
      );
      this.insertEvent({
        eventId: this.idGenerator.nextEventId(),
        proposalId,
        kind: 'accepted',
        at,
        actorId: input.actorId,
        proposalVersion: row.version,
        channel: input.channel,
        note: input.reviewNote,
        reviewBatchId: input.reviewBatchId,
      });
      this.db
        .prepare(
          `INSERT OR IGNORE INTO attestations
             (attestation_id, proposal_id, proposal_version, reviewer_id, approved_at, target_revision, mutation_hash,
              review_note, channel, verifier_meta_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          attestation.id,
          proposalId,
          attestation.proposalVersion,
          attestation.reviewerId,
          attestation.approvedAt,
          attestation.targetRevision,
          attestation.mutationHash,
          attestation.reviewNote ?? null,
          attestation.channel,
          canonicalStringify(attestation.verifierMeta),
        );
      this.recordIdempotency('proposal.accept', input.idempotencyKey, requestHash, result, at);
    });
    return result;
  }

  async reject(proposalId: ProposalId, input: RejectInput): Promise<DurableProposal> {
    const row = this.mustGetProposalRow(proposalId);
    if (row.status !== 'pending') throw new ProposalInvalidTransitionError(proposalId, row.status, 'reject');
    if (row.version !== input.expectedVersion) throw new ProposalVersionConflictError(proposalId, input.expectedVersion, row.version);
    const reason = input.reason.trim();
    if (!reason) throw new ProposalValidationError('reject requires a non-empty reason');

    const requestHash = contentHash({ expectedVersion: input.expectedVersion, reason, channel: input.channel ?? null });
    const idem = this.checkIdempotency<{ proposalId: string }>('proposal.reject', input.idempotencyKey, requestHash);
    if (idem) return (await this.getProposal(proposalId))!;

    const at = this.clock.now();
    return this.unitOfWork.run(() => {
      this.db.prepare(`UPDATE proposals SET status = 'rejected', updated_at = ? WHERE proposal_id = ?`).run(at, proposalId);
      this.insertEvent({
        eventId: this.idGenerator.nextEventId(),
        proposalId,
        kind: 'rejected',
        at,
        actorId: input.actorId,
        proposalVersion: row.version,
        reason,
        channel: input.channel,
      });
      this.recordIdempotency('proposal.reject', input.idempotencyKey, requestHash, { proposalId }, at);
      return rowToProposal(this.getProposalRow(proposalId)!);
    });
  }

  async expire(proposalId: ProposalId, input: ExpireInput): Promise<DurableProposal> {
    const row = this.mustGetProposalRow(proposalId);
    if (row.status !== 'pending') throw new ProposalInvalidTransitionError(proposalId, row.status, 'expire');
    if (row.version !== input.expectedVersion) throw new ProposalVersionConflictError(proposalId, input.expectedVersion, row.version);
    const note = input.note.trim();
    if (!note) throw new ProposalValidationError('expire requires a non-empty note');

    const requestHash = contentHash({ expectedVersion: input.expectedVersion, note });
    const idem = this.checkIdempotency<{ proposalId: string }>('proposal.expire', input.idempotencyKey, requestHash);
    if (idem) return (await this.getProposal(proposalId))!;

    const at = this.clock.now();
    return this.unitOfWork.run(() => {
      this.db.prepare(`UPDATE proposals SET status = 'expired', updated_at = ? WHERE proposal_id = ?`).run(at, proposalId);
      this.insertEvent({
        eventId: this.idGenerator.nextEventId(),
        proposalId,
        kind: 'expired',
        at,
        proposalVersion: row.version,
        note,
        ...(input.actorId ? { actorId: input.actorId } : {}),
      });
      this.recordIdempotency('proposal.expire', input.idempotencyKey, requestHash, { proposalId }, at);
      return rowToProposal(this.getProposalRow(proposalId)!);
    });
  }

  async delete(proposalId: ProposalId, input: DeleteInput): Promise<DurableProposal> {
    const row = this.mustGetProposalRow(proposalId);
    if (row.status === 'deleted') throw new ProposalInvalidTransitionError(proposalId, row.status, 'delete');
    if (row.version !== input.expectedVersion) throw new ProposalVersionConflictError(proposalId, input.expectedVersion, row.version);
    const reason = input.reason.trim();
    if (!reason) throw new ProposalValidationError('delete requires a non-empty reason');

    const requestHash = contentHash({ expectedVersion: input.expectedVersion, reason });
    const idem = this.checkIdempotency<{ proposalId: string }>('proposal.delete', input.idempotencyKey, requestHash);
    if (idem) return (await this.getProposal(proposalId))!;

    const at = this.clock.now();
    return this.unitOfWork.run(() => {
      this.db.prepare(`UPDATE proposals SET status = 'deleted', updated_at = ? WHERE proposal_id = ?`).run(at, proposalId);
      this.insertEvent({
        eventId: this.idGenerator.nextEventId(),
        proposalId,
        kind: 'deleted',
        at,
        actorId: input.actorId,
        proposalVersion: row.version,
        reason,
      });
      this.recordIdempotency('proposal.delete', input.idempotencyKey, requestHash, { proposalId }, at);
      return rowToProposal(this.getProposalRow(proposalId)!);
    });
  }

  /**
   * Creates the inverse-mutation candidate for an accepted proposal's applied
   * revision as its own pending port-level proposal, so a namespace policy
   * that requires attestation (evaluateAttestationRequirement) has something
   * to verify an attestation against before revert() applies it. Namespaces
   * that permit direct mutation don't need this: revert() builds and applies
   * the inverse command directly in one call.
   */
  async proposeRevert(
    proposalId: ProposalId,
    input: { actorId: ActorId; actorClass: ActorClass; idempotencyKey: string },
  ): Promise<ProposeRevertOutcome> {
    const row = this.mustGetProposalRow(proposalId);
    if (row.status !== 'accepted') throw new ProposalInvalidTransitionError(proposalId, row.status, 'revert');
    if (row.reverted) throw new ProposalInvalidTransitionError(proposalId, 'accepted (already reverted)', 'revert');
    if (row.resulting_revision === null) throw new ProposalValidationError(`proposal "${proposalId}" has no applied revision to revert`);

    const built = await this.buildRevertCommand(row, input.actorId, input.actorClass, input.idempotencyKey);
    const { command: normalized, mutationHash } = normalizeWriteCommand(built);
    const at = this.clock.now();

    return this.unitOfWork.run(() => {
      const revertProposalId = this.idGenerator.nextProposalId();
      const versionId = randomUUID();
      const fingerprint = computeProposalFingerprint({
        targetNamespace: normalized.namespace,
        targetSubject: normalized.subject,
        nodeMutations: normalized.nodeMutations,
        edgeMutations: normalized.edgeMutations,
        supportingObservationIds: [],
        sourceReferences: normalized.provenanceInput.sources,
      });

      this.db
        .prepare(
          `INSERT INTO proposals
             (proposal_id, target_namespace, target_subject, status, version, mutation_hash, fingerprint,
              expected_target_revision, created_at, updated_at, resulting_revision, reverted)
           VALUES (?, ?, ?, 'pending', 1, ?, ?, ?, ?, ?, NULL, 0)`,
        )
        .run(revertProposalId, normalized.namespace, normalized.subject, mutationHash, fingerprint, normalized.expectedNamespaceRevision, at, at);
      this.db
        .prepare(
          `INSERT INTO proposal_versions
             (version_id, proposal_id, version, canonical_mutation_json, mutation_hash, expected_target_revision,
              supporting_observation_ids_json, provenance_json, created_at)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          revertProposalId,
          canonicalStringify(normalized),
          mutationHash,
          normalized.expectedNamespaceRevision,
          canonicalStringify([]),
          canonicalStringify(provenanceFromInput(normalized.provenanceInput, 'durable-proposal-revert')),
          at,
        );
      this.insertEvent({
        eventId: this.idGenerator.nextEventId(),
        proposalId: revertProposalId,
        kind: 'proposed',
        at,
        proposalVersion: 1,
        detail: { revertOf: proposalId },
      });

      return { revertProposalId: asProposalId(revertProposalId), revertProposalVersion: 1, mutationHash };
    });
  }

  async revert(proposalId: ProposalId, input: RevertInput): Promise<RevertOutcome> {
    const row = this.mustGetProposalRow(proposalId);
    if (row.status !== 'accepted') throw new ProposalInvalidTransitionError(proposalId, row.status, 'revert');
    if (row.reverted) throw new ProposalInvalidTransitionError(proposalId, 'accepted (already reverted)', 'revert');
    if (row.resulting_revision === null) throw new ProposalValidationError(`proposal "${proposalId}" has no applied revision to revert`);
    const reason = input.reason.trim();
    if (!reason) throw new ProposalValidationError('revert requires a non-empty reason');

    const requestHash = contentHash({ reason, channel: input.channel ?? null, revertCandidateId: input.revertCandidateId ?? null });
    const idem = this.checkIdempotency<RevertOutcome>('proposal.revert', input.idempotencyKey, requestHash);
    if (idem) return idem;

    let command: WriteCommand;
    if (input.revertCandidateId) {
      const candidateRow = this.mustGetProposalRow(input.revertCandidateId);
      if (candidateRow.status !== 'pending') {
        throw new ProposalInvalidTransitionError(input.revertCandidateId, candidateRow.status, 'complete revert via');
      }
      if (!input.attestationId) {
        throw new ProposalAttestationError(`revert of proposal "${proposalId}" via candidate "${input.revertCandidateId}" requires an attestationId`);
      }
      const candidateVersion = rowToVersion(this.getVersionRow(input.revertCandidateId, candidateRow.version)!);
      const attestation = await this.attestationVerifier.verify({
        attestationId: input.attestationId,
        expectedProposalId: input.revertCandidateId,
        expectedProposalVersion: candidateRow.version,
        expectedMutationHash: candidateVersion.mutationHash,
      });
      if (!attestation) {
        throw new ProposalAttestationError(`no verifiable attestation "${input.attestationId}" for revert candidate "${input.revertCandidateId}"`);
      }
      command = { ...candidateVersion.canonicalMutation, attestation: { attestationId: input.attestationId } };
    } else {
      command = await this.buildRevertCommand(row, input.actorId, input.actorClass, input.idempotencyKey);
    }

    const at = this.clock.now();
    const writeResult = await this.orchestrator.write(command);
    const applied =
      writeResult.outcome === 'applied'
        ? writeResult
        : writeResult.outcome === 'idempotent_replay' && writeResult.original.outcome === 'applied'
          ? writeResult.original
          : undefined;

    if (writeResult.outcome === 'conflict') {
      return { outcome: 'target_revision_conflict', expectedRevision: writeResult.expectedRevision, actualRevision: writeResult.actualRevision };
    }

    if (!applied) {
      const reasonCodes = writeResult.outcome === 'rejected' || writeResult.outcome === 'routed_to_proposal' ? writeResult.reasonCodes : [];
      throw new ProposalValidationError(`revert of proposal "${proposalId}" was not applied: ${writeResult.outcome} (${reasonCodes.join(', ')})`);
    }

    const result: RevertOutcome = { outcome: 'reverted', newRevision: applied.resultingRevision };
    this.unitOfWork.run(() => {
      this.db.prepare(`UPDATE proposals SET reverted = 1, updated_at = ? WHERE proposal_id = ?`).run(at, proposalId);
      if (input.revertCandidateId) {
        this.db
          .prepare(`UPDATE proposals SET status = 'accepted', resulting_revision = ?, updated_at = ? WHERE proposal_id = ?`)
          .run(applied.resultingRevision, at, input.revertCandidateId);
        this.insertEvent({
          eventId: this.idGenerator.nextEventId(),
          proposalId: input.revertCandidateId,
          kind: 'accepted',
          at,
          actorId: input.actorId,
          proposalVersion: 1,
          channel: input.channel,
          detail: { revertOf: proposalId },
        });
      }
      this.db
        .prepare(
          `INSERT INTO reversals (reversal_id, proposal_id, original_revision, new_revision, actor_id, channel, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), proposalId, row.resulting_revision, applied.resultingRevision, input.actorId, input.channel ?? null, reason, at);
      this.insertEvent({
        eventId: this.idGenerator.nextEventId(),
        proposalId,
        kind: 'reverted',
        at,
        actorId: input.actorId,
        channel: input.channel,
        reason,
        detail: { originalRevision: row.resulting_revision, newRevision: applied.resultingRevision },
      });
      this.recordIdempotency('proposal.revert', input.idempotencyKey, requestHash, result, at);
    });
    return result;
  }

  private async buildRevertCommand(
    row: ProposalRow,
    actorId: ActorId,
    actorClass: ActorClass,
    idempotencyKey: string,
  ): Promise<WriteCommand> {
    const currentVersion = rowToVersion(this.getVersionRow(row.proposal_id, row.version)!);
    const namespace = asNamespaceId(row.target_namespace);
    const resultingRevision = row.resulting_revision;
    if (resultingRevision === null) {
      throw new ProposalValidationError(`proposal "${row.proposal_id}" has no applied revision to revert`);
    }

    // Read through the same Repository port the orchestrator writes
    // through -- never the sqlite `namespace_revisions`/`namespaces` tables
    // directly -- so revert works identically for sqlite- and git-backed
    // namespaces.
    const [revisionRecord] = await this.repository.listRevisionsSince(namespace, resultingRevision - 1);
    if (!revisionRecord || revisionRecord.namespaceRevision !== resultingRevision) {
      throw new ProposalValidationError(`applied revision ${resultingRevision} for proposal "${row.proposal_id}" was not found`);
    }
    const targetRevisionId = asRevisionId(revisionRecord.revisionId);

    const expectedNamespaceRevision = await this.repository.getNamespaceRevision(namespace);

    return {
      namespace,
      subject: asSubjectId(row.target_subject),
      nodeMutations: currentVersion.canonicalMutation.nodeMutations.map((m) => ({ op: 'revert' as const, nodeId: m.nodeId, targetRevisionId })),
      edgeMutations: currentVersion.canonicalMutation.edgeMutations.map((m) => ({ op: 'revert' as const, edgeId: m.edgeId, targetRevisionId })),
      expectedNamespaceRevision,
      idempotencyKey: asIdempotencyKey(idempotencyKey),
      actorId,
      actorClass,
      provenanceInput: { sources: currentVersion.provenance.sources },
    };
  }

  async reviewMeasurements(query: ReviewMeasurementsQuery): Promise<ReviewMeasurements> {
    const namespaceFilter = query.namespace ? 'AND p.target_namespace = @namespace' : '';
    const params: Record<string, unknown> = { from: query.from, to: query.to };
    if (query.namespace) params.namespace = query.namespace;

    const countsRows = this.db
      .prepare(
        `SELECT p.status AS status, COUNT(*) AS count FROM proposals p
         WHERE p.updated_at >= @from AND p.updated_at <= @to ${namespaceFilter}
         GROUP BY p.status`,
      )
      .all(params) as { status: DurableProposalStatus; count: number }[];

    const countsByStatus: Record<DurableProposalStatus, number> = { pending: 0, accepted: 0, rejected: 0, expired: 0, deleted: 0 };
    for (const row of countsRows) countsByStatus[row.status] = row.count;

    const decisionRows = this.db
      .prepare(
        `SELECT e.kind AS kind, e.at AS at, e.actor_id AS actor_id, e.review_batch_id AS review_batch_id, p.created_at AS proposed_at
         FROM proposal_events e
         JOIN proposals p ON p.proposal_id = e.proposal_id
         WHERE e.kind IN ('accepted', 'rejected') AND e.at >= @from AND e.at <= @to ${namespaceFilter}`,
      )
      .all(params) as { kind: string; at: string; actor_id: string | null; review_batch_id: string | null; proposed_at: string }[];

    const acceptedCount = decisionRows.filter((r) => r.kind === 'accepted').length;
    const rejectedCount = decisionRows.filter((r) => r.kind === 'rejected').length;
    const denom = acceptedCount + rejectedCount;
    const acceptanceRate = denom > 0 ? acceptedCount / denom : null;

    const latencies = decisionRows
      .map((r) => new Date(r.at).getTime() - new Date(r.proposed_at).getTime())
      .filter((ms) => Number.isFinite(ms));
    const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

    const batchSizes: Record<string, number> = {};
    for (const row of decisionRows) {
      if (!row.review_batch_id) continue;
      batchSizes[row.review_batch_id] = (batchSizes[row.review_batch_id] ?? 0) + 1;
    }
    const batchStartTimes = Object.keys(batchSizes)
      .map((batchId) => Math.min(...decisionRows.filter((r) => r.review_batch_id === batchId).map((r) => new Date(r.at).getTime())))
      .sort((a, b) => a - b);
    let batchCadenceMsAvg: number | null = null;
    if (batchStartTimes.length > 1) {
      const gaps: number[] = [];
      for (let i = 1; i < batchStartTimes.length; i += 1) gaps.push(batchStartTimes[i]! - batchStartTimes[i - 1]!);
      batchCadenceMsAvg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    }

    const reviewerMinutes: Record<string, number> = {};
    for (const row of decisionRows) {
      if (!row.actor_id) continue;
      const ms = new Date(row.at).getTime() - new Date(row.proposed_at).getTime();
      if (!Number.isFinite(ms)) continue;
      reviewerMinutes[row.actor_id] = (reviewerMinutes[row.actor_id] ?? 0) + ms / 60_000;
    }

    return {
      namespace: query.namespace ?? null,
      from: query.from,
      to: query.to,
      countsByStatus,
      acceptedCount,
      rejectedCount,
      acceptanceRate,
      firstReviewLatencyMsAvg: avgLatency,
      reviewDurationMsAvg: avgLatency,
      batchSizes,
      batchCadenceMsAvg,
      reviewerMinutes,
    };
  }

  async pendingAuditSamples(namespace?: NamespaceId): Promise<AuditSample[]> {
    const rows = namespace
      ? (this.db.prepare('SELECT * FROM audit_samples WHERE reviewed = 0 AND namespace = ? ORDER BY sampled_at ASC').all(namespace) as AuditSampleRow[])
      : (this.db.prepare('SELECT * FROM audit_samples WHERE reviewed = 0 ORDER BY sampled_at ASC').all() as AuditSampleRow[]);
    return rows.map(rowToAuditSample);
  }

  async markAuditSampleReviewed(sampleId: string, input: MarkAuditSampleReviewedInput): Promise<AuditSample> {
    const result = this.db
      .prepare(`UPDATE audit_samples SET reviewed = 1, reviewer_id = ?, verdict = ?, note = ?, reviewed_at = ? WHERE sample_id = ? AND reviewed = 0`)
      .run(input.reviewerId, input.verdict, input.note ?? null, input.at, sampleId);

    if (result.changes === 0) {
      const existing = this.db.prepare('SELECT 1 FROM audit_samples WHERE sample_id = ?').get(sampleId);
      if (!existing) throw new ProposalNotFoundError(sampleId);
      throw new ProposalValidationError(`audit sample "${sampleId}" was already reviewed`);
    }

    return rowToAuditSample(this.db.prepare('SELECT * FROM audit_samples WHERE sample_id = ?').get(sampleId) as AuditSampleRow);
  }

  private getProposalRow(proposalId: string): ProposalRow | undefined {
    return this.db.prepare('SELECT * FROM proposals WHERE proposal_id = ?').get(proposalId) as ProposalRow | undefined;
  }

  private mustGetProposalRow(proposalId: string): ProposalRow {
    const row = this.getProposalRow(proposalId);
    if (!row) throw new ProposalNotFoundError(proposalId);
    return row;
  }

  private async mustGetProposal(proposalId: string): Promise<DurableProposal> {
    return rowToProposal(this.mustGetProposalRow(proposalId));
  }

  private getVersionRow(proposalId: string, version: number): ProposalVersionRow | undefined {
    return this.db.prepare('SELECT * FROM proposal_versions WHERE proposal_id = ? AND version = ?').get(proposalId, version) as
      | ProposalVersionRow
      | undefined;
  }

  private listEventRows(proposalId: string): ProposalEventRow[] {
    return this.db.prepare('SELECT * FROM proposal_events WHERE proposal_id = ? ORDER BY at ASC').all(proposalId) as ProposalEventRow[];
  }

  private insertEvent(params: {
    eventId: string;
    proposalId: string;
    kind: string;
    at: string;
    actorId?: string;
    proposalVersion?: number;
    reason?: string;
    note?: string;
    channel?: string;
    reviewBatchId?: string;
    detail?: unknown;
  }): void {
    this.db
      .prepare(
        `INSERT INTO proposal_events
           (event_id, proposal_id, kind, at, actor_id, proposal_version, reason, note, channel, review_batch_id, detail_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.eventId,
        params.proposalId,
        params.kind,
        params.at,
        params.actorId ?? null,
        params.proposalVersion ?? null,
        params.reason ?? null,
        params.note ?? null,
        params.channel ?? null,
        params.reviewBatchId ?? null,
        params.detail !== undefined ? canonicalStringify(params.detail) : null,
      );
  }

  private checkIdempotency<T>(scope: string, key: string, requestHash: string): T | undefined {
    const row = this.db.prepare('SELECT request_hash, result_json FROM idempotency_records WHERE scope = ? AND key = ?').get(scope, key) as
      | { request_hash: string; result_json: string }
      | undefined;
    if (!row) return undefined;
    if (row.request_hash !== requestHash) throw new ProposalIdempotencyMismatchError(scope, key);
    return JSON.parse(row.result_json) as T;
  }

  private recordIdempotency(scope: string, key: string, requestHash: string, result: unknown, at: string): void {
    this.db
      .prepare('INSERT INTO idempotency_records (scope, key, request_hash, result_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(scope, key, requestHash, canonicalStringify(result), at);
  }
}
