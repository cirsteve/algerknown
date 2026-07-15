import { describe, expect, it } from 'vitest';
import {
  asActorId,
  asAttestationId,
  asMutationHash,
  asProposalId,
  openGovernedDatabase,
} from '@algerknown/governed';
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
});
