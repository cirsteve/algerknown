import { randomUUID } from 'node:crypto';
import type { DatabaseType } from './connection.js';
import { canonicalStringify } from './canonical.js';
import { computeProposalFingerprint } from './proposal-fingerprint.js';
import { asEventId, asMutationHash, asNamespaceId, asProposalId, asSubjectId } from '../domain/ids.js';
import type { MutationHash, NamespaceId, ProposalId } from '../domain/ids.js';
import type { Proposal, ProposalStatus } from '../domain/proposal.js';
import type { ProposalRepository } from '../ports/proposal-repository.js';

/**
 * The internal SQLite proposal lifecycle recognizes five states (adding
 * expired and deleted tombstones); the settled ProposalRepository port's
 * domain Proposal type only recognizes four. These maps are a lossy but
 * documented compatibility shim so this class can satisfy the narrow port
 * without widening domain/proposal.ts, which is out of scope for this
 * cohort. The richer five-state model lives in src/proposals/ and reads the
 * same underlying rows directly.
 */
export type InternalProposalStatus = 'pending' | 'accepted' | 'rejected' | 'expired' | 'deleted';

const PORT_TO_INTERNAL_STATUS: Record<ProposalStatus, InternalProposalStatus> = {
  pending: 'pending',
  accepted: 'accepted',
  rejected: 'rejected',
  superseded: 'expired',
};

const INTERNAL_TO_PORT_STATUS: Record<InternalProposalStatus, ProposalStatus> = {
  pending: 'pending',
  accepted: 'accepted',
  rejected: 'rejected',
  expired: 'rejected',
  deleted: 'rejected',
};

interface ProposalRow {
  proposal_id: string;
  target_namespace: string;
  target_subject: string;
  status: InternalProposalStatus;
  version: number;
  mutation_hash: string;
  expected_target_revision: number | null;
  created_at: string;
}

interface ProposalVersionRow {
  canonical_mutation_json: string;
  supporting_observation_ids_json: string;
  provenance_json: string;
}

interface ProposalEventRow {
  event_id: string;
  kind: string;
  at: string;
}

/**
 * ProposalRepository port adapter backed by the durable `proposals` and
 * `proposal_versions` tables. save() upserts the current projection row and
 * the version row for the proposal's current version, and idempotently
 * appends any event rows not already recorded (proposal_events is
 * append-only, so a repeated save() of an already-seen event is a no-op,
 * never an error).
 */
export class SqliteProposalRepository implements ProposalRepository {
  constructor(private readonly db: DatabaseType) {}

  async save(proposal: Proposal): Promise<void> {
    const internalStatus = PORT_TO_INTERNAL_STATUS[proposal.status];
    const now = new Date().toISOString();
    const fingerprint = computeProposalFingerprint({
      targetNamespace: proposal.targetNamespace,
      targetSubject: proposal.targetSubject,
      nodeMutations: proposal.canonicalMutation.nodeMutations,
      edgeMutations: proposal.canonicalMutation.edgeMutations,
      supportingObservationIds: proposal.supportingObservationIds,
      sourceReferences: proposal.provenance.sources,
    });

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare('SELECT created_at FROM proposals WHERE proposal_id = ?').get(proposal.id) as
        | { created_at: string }
        | undefined;
      const createdAt = existing?.created_at ?? now;

      this.db
        .prepare(
          `INSERT INTO proposals
             (proposal_id, target_namespace, target_subject, status, version, mutation_hash, fingerprint,
              expected_target_revision, created_at, updated_at, resulting_revision, reverted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)
           ON CONFLICT(proposal_id) DO UPDATE SET
             status = excluded.status,
             version = excluded.version,
             mutation_hash = excluded.mutation_hash,
             fingerprint = excluded.fingerprint,
             expected_target_revision = excluded.expected_target_revision,
             updated_at = excluded.updated_at`,
        )
        .run(
          proposal.id,
          proposal.targetNamespace,
          proposal.targetSubject,
          internalStatus,
          proposal.version,
          proposal.mutationHash,
          fingerprint,
          proposal.expectedTargetRevision,
          createdAt,
          now,
        );

      const versionExists = this.db
        .prepare('SELECT 1 FROM proposal_versions WHERE proposal_id = ? AND version = ?')
        .get(proposal.id, proposal.version);
      if (!versionExists) {
        this.db
          .prepare(
            `INSERT INTO proposal_versions
               (version_id, proposal_id, version, canonical_mutation_json, mutation_hash, expected_target_revision,
                supporting_observation_ids_json, provenance_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            proposal.id,
            proposal.version,
            canonicalStringify(proposal.canonicalMutation),
            proposal.mutationHash,
            proposal.expectedTargetRevision,
            canonicalStringify(proposal.supportingObservationIds),
            canonicalStringify(proposal.provenance),
            now,
          );
      }

      const insertEvent = this.db.prepare(
        `INSERT OR IGNORE INTO proposal_events (event_id, proposal_id, kind, at) VALUES (?, ?, ?, ?)`,
      );
      for (const event of proposal.events) {
        insertEvent.run(event.eventId, proposal.id, event.kind, event.at);
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async get(proposalId: ProposalId): Promise<Proposal | undefined> {
    const row = this.db.prepare('SELECT * FROM proposals WHERE proposal_id = ?').get(proposalId) as ProposalRow | undefined;
    if (!row) return undefined;
    return this.hydrate(row);
  }

  async findPendingByMutationHash(namespace: NamespaceId, hash: MutationHash): Promise<Proposal | undefined> {
    const row = this.db
      .prepare(
        `SELECT * FROM proposals
         WHERE target_namespace = ? AND mutation_hash = ? AND status = 'pending'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(namespace, hash) as ProposalRow | undefined;
    if (!row) return undefined;
    return this.hydrate(row);
  }

  private hydrate(row: ProposalRow): Proposal | undefined {
    const versionRow = this.db
      .prepare('SELECT canonical_mutation_json, supporting_observation_ids_json, provenance_json FROM proposal_versions WHERE proposal_id = ? AND version = ?')
      .get(row.proposal_id, row.version) as ProposalVersionRow | undefined;
    if (!versionRow) return undefined;

    const eventRows = this.db
      .prepare('SELECT event_id, kind, at FROM proposal_events WHERE proposal_id = ? ORDER BY at ASC')
      .all(row.proposal_id) as ProposalEventRow[];

    return {
      id: asProposalId(row.proposal_id),
      canonicalMutation: JSON.parse(versionRow.canonical_mutation_json),
      mutationHash: asMutationHash(row.mutation_hash),
      targetNamespace: asNamespaceId(row.target_namespace),
      targetSubject: asSubjectId(row.target_subject),
      expectedTargetRevision: row.expected_target_revision,
      supportingObservationIds: JSON.parse(versionRow.supporting_observation_ids_json),
      provenance: JSON.parse(versionRow.provenance_json),
      version: row.version,
      status: INTERNAL_TO_PORT_STATUS[row.status],
      events: eventRows.map((e) => ({ eventId: asEventId(e.event_id), kind: e.kind, at: e.at })),
    };
  }
}
