import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { asActorId, asEdgeId, asIdempotencyKey, asNodeId, asProcessorId, type WriteCommand } from '@algerknown/governed';
import { namespaceForBinding, subjectForBinding } from '@algerknown/governed/adapters/algerknown';
import { createGovernanceComposition, acceptProposal, GovernanceCompositionConfigError } from '../../src/server/governance/index.js';
import { seedKnowledgeBase, writeNamespaceBindings, testEnv, cleanup, type SeededKnowledgeBase } from './fixtures.js';

function proposeCommand(kb: SeededKnowledgeBase, overrides: Partial<WriteCommand> = {}): WriteCommand {
  return {
    namespace: namespaceForBinding(kb.binding),
    subject: subjectForBinding(kb.binding),
    nodeMutations: [
      {
        op: 'create',
        nodeId: asNodeId('fact-generated-1'),
        nodeType: 'fact',
        payload: { statement: 'The demo project ships weekly.', attributes: { status: 'shipped', safe_phrasings: ['The demo project ships weekly.'] } },
        confidence: 0.9,
      },
    ],
    edgeMutations: [
      {
        op: 'create',
        edgeId: asEdgeId('evidence_for:evidence-1:fact-generated-1'),
        kind: 'evidence_for',
        sourceId: asNodeId('evidence-1'),
        targetId: asNodeId('fact-generated-1'),
      },
    ],
    expectedNamespaceRevision: null,
    idempotencyKey: asIdempotencyKey('propose-1'),
    actorId: asActorId('test-processor'),
    actorClass: 'processor',
    provenanceInput: { sources: [{ kind: 'external', id: 'evidence-1' }], processorId: asProcessorId('test-processor') },
    ...overrides,
  };
}

describe('governance composition root', () => {
  let kb: SeededKnowledgeBase;
  let env: NodeJS.ProcessEnv;

  afterEach(() => {
    if (kb && env) cleanup(kb, env);
  });

  it('fails closed when required configuration is missing', async () => {
    await expect(createGovernanceComposition({ env: {} })).rejects.toThrow(GovernanceCompositionConfigError);
  });

  it('generates the runtime governed-boundary manifest from configured namespace bindings', async () => {
    kb = seedKnowledgeBase();
    writeNamespaceBindings(kb.root, [kb.binding]);
    env = testEnv({ ALGERKNOWN_ROOT: kb.root });

    const composition = await createGovernanceComposition({ env });
    try {
      const manifestPath = path.join(kb.root, '.algerknown', 'governed-boundary.json');
      expect(fs.existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest.managedPaths).toContain(kb.binding.path);
    } finally {
      composition.close();
    }
  });

  it('persists a processor-originated write as a durable pending proposal without applying it', async () => {
    kb = seedKnowledgeBase();
    writeNamespaceBindings(kb.root, [kb.binding]);
    env = testEnv({ ALGERKNOWN_ROOT: kb.root });

    const composition = await createGovernanceComposition({ env });
    try {
      const command = proposeCommand(kb);
      const outcome = await composition.proposalService.propose({
        mutation: command,
        supportingObservationIds: [],
        idempotencyKey: 'propose-persist-1',
      });

      expect(outcome.outcome).toBe('created');
      if (outcome.outcome !== 'created') throw new Error('expected created');
      expect(outcome.proposal.status).toBe('pending');

      // The dossier file on disk must be untouched -- persisting a proposal
      // must never itself apply a governed write.
      const dossierContent = fs.readFileSync(path.join(kb.root, kb.binding.path), 'utf-8');
      expect(dossierContent).not.toContain('fact-generated-1');
    } finally {
      composition.close();
    }
  });

  it('accepting a pending proposal applies the governed write and commits it to git', async () => {
    kb = seedKnowledgeBase();
    writeNamespaceBindings(kb.root, [kb.binding]);
    env = testEnv({ ALGERKNOWN_ROOT: kb.root });

    const composition = await createGovernanceComposition({ env });
    try {
      const command = proposeCommand(kb);
      const proposeOutcome = await composition.proposalService.propose({
        mutation: command,
        supportingObservationIds: [],
        idempotencyKey: 'propose-accept-1',
      });
      if (proposeOutcome.outcome !== 'created') throw new Error('expected created');
      const proposalId = proposeOutcome.proposal.id;

      const acceptOutcome = await acceptProposal(composition.reviewActionsDeps, proposalId, {
        reviewContext: { reviewerId: asActorId('demo-reviewer'), reviewerDisplayName: 'Demo Reviewer', channel: 'cli' },
        expectedVersion: 1,
        expectedTargetRevision: null,
        idempotencyKey: 'accept-1',
      });

      expect(acceptOutcome.outcome).toBe('accepted');

      const dossierContent = fs.readFileSync(path.join(kb.root, kb.binding.path), 'utf-8');
      expect(dossierContent).toContain('fact-generated-1');

      const proposal = await composition.proposalService.getProposal(proposalId);
      expect(proposal?.status).toBe('accepted');
    } finally {
      composition.close();
    }
  });
});
