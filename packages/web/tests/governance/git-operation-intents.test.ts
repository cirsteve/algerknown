import { describe, expect, it, vi } from 'vitest';
import {
  asActorId,
  asAttestationId,
  asMutationHash,
  asNamespaceId,
  asProposalId,
  asSubjectId,
  openGovernedDatabase,
  type DurableProposalService,
} from '@algerknown/governed';
import { createLocalAttestationVerifier } from '../../src/server/governance/attestation-verifier.js';
import { recoverIncompleteGitOperations } from '../../src/server/governance/git-operation-recovery.js';
import { createIntent, ensureGitOperationIntentsTable, listIncompleteIntents } from '../../src/server/governance/git-operation-intents.js';

describe('git operation intent persistence', () => {
  it('upgrades the pre-attestation table and persists the replayable attestation', () => {
    const connection = openGovernedDatabase({ filename: ':memory:' });
    connection.migrate();
    connection.db.exec(`
      CREATE TABLE web_git_operation_intents (
        operation_id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        action TEXT NOT NULL,
        namespace TEXT NOT NULL,
        command_idempotency_key TEXT NOT NULL,
        expected_mutation_hash TEXT NOT NULL,
        review_input_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        resulting_revision INTEGER,
        note TEXT
      )
    `);

    ensureGitOperationIntentsTable(connection.db);
    const columns = connection.db.prepare(`PRAGMA table_info(web_git_operation_intents)`).all() as { name: string }[];
    expect(columns.map((column) => column.name)).toContain('attestation_json');

    const proposalId = asProposalId('proposal-1');
    const attestationId = asAttestationId('attestation-1');
    const mutationHash = asMutationHash('mutation-hash-1');
    createIntent(connection.db, {
      operationId: 'operation-1',
      proposalId,
      action: 'accept',
      namespace: 'canonical.project.demo',
      commandIdempotencyKey: 'write-1',
      expectedMutationHash: mutationHash,
      reviewInput: {
        expectedVersion: 1,
        expectedTargetRevision: null,
        attestationId,
        actorId: asActorId('reviewer-1'),
        channel: 'browser',
        idempotencyKey: 'accept-1',
      },
      attestation: {
        id: attestationId,
        reviewerId: asActorId('reviewer-1'),
        approvedAt: '2026-07-15T12:00:00.000Z',
        proposalId,
        proposalVersion: 1,
        targetRevision: null,
        mutationHash,
        channel: 'browser',
        verifierMeta: {},
      },
      createdAt: '2026-07-15T12:00:00.000Z',
    });

    const [intent] = listIncompleteIntents(connection.db);
    expect(intent?.attestationJson).not.toBeNull();
    expect(JSON.parse(intent!.attestationJson!)).toMatchObject({
      id: attestationId,
      proposalId,
      mutationHash,
      reviewerId: 'reviewer-1',
    });
    connection.close();
  });

  it('blocks malformed attestation JSON without aborting later recovery intents', async () => {
    const connection = openGovernedDatabase({ filename: ':memory:' });
    connection.migrate();
    ensureGitOperationIntentsTable(connection.db);

    const createdAt = '2026-07-15T12:00:00.000Z';
    const invalidProposalId = asProposalId('proposal-invalid-json');
    const validProposalId = asProposalId('proposal-valid-json');
    for (const [index, proposalId] of [invalidProposalId, validProposalId].entries()) {
      const attestationId = asAttestationId(`attestation-${index}`);
      const mutationHash = asMutationHash(`mutation-hash-${index}`);
      createIntent(connection.db, {
        operationId: `operation-${index}`,
        proposalId,
        action: 'accept',
        namespace: 'canonical.project.demo',
        commandIdempotencyKey: `write-${index}`,
        expectedMutationHash: mutationHash,
        reviewInput: {
          expectedVersion: 1,
          expectedTargetRevision: null,
          attestationId,
          actorId: asActorId('reviewer-1'),
          channel: 'browser',
          idempotencyKey: `accept-${index}`,
        },
        attestation: {
          id: attestationId,
          reviewerId: asActorId('reviewer-1'),
          approvedAt: createdAt,
          proposalId,
          proposalVersion: 1,
          targetRevision: null,
          mutationHash,
          channel: 'browser',
          verifierMeta: {},
        },
        createdAt: index === 0 ? '2026-07-15T11:00:00.000Z' : createdAt,
      });
    }
    connection.db.prepare(`UPDATE web_git_operation_intents SET attestation_json = '{' WHERE operation_id = 'operation-0'`).run();

    const accept = vi.fn(async () => ({ outcome: 'accepted' as const, resultingRevision: 1 }));
    const proposalService = {
      getProposal: vi.fn(async (proposalId: string) => ({
        id: proposalId,
        targetNamespace: asNamespaceId('canonical.project.demo'),
        targetSubject: asSubjectId('subject-1'),
        status: 'pending',
        version: 1,
        mutationHash: asMutationHash(proposalId === invalidProposalId ? 'mutation-hash-0' : 'mutation-hash-1'),
        fingerprint: 'fingerprint',
        expectedTargetRevision: null,
        createdAt,
        updatedAt: createdAt,
        resultingRevision: null,
        reverted: false,
      })),
      inspect: vi.fn(async (proposalId: string) => ({
        currentVersion: {
          mutationHash: asMutationHash(proposalId === invalidProposalId ? 'mutation-hash-0' : 'mutation-hash-1'),
        },
      })),
      accept,
    } as unknown as DurableProposalService;

    await recoverIncompleteGitOperations({
      db: connection.db,
      proposalService,
      attestationVerifier: createLocalAttestationVerifier(),
      clock: { now: () => createdAt },
    });

    const rows = connection.db
      .prepare(`SELECT operation_id AS operationId, status, note FROM web_git_operation_intents ORDER BY operation_id`)
      .all() as { operationId: string; status: string; note: string | null }[];
    expect(rows[0]).toMatchObject({ operationId: 'operation-0', status: 'blocked' });
    expect(rows[0]!.note).toContain('invalid durable attestation JSON');
    expect(rows[1]).toMatchObject({ operationId: 'operation-1', status: 'completed' });
    expect(accept).toHaveBeenCalledOnce();
    expect(accept).toHaveBeenCalledWith(validProposalId, expect.objectContaining({ idempotencyKey: 'accept-1' }));
    connection.close();
  });
});
