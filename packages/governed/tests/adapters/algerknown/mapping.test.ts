import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Dossier, Summary } from '@algerknown/core';
import {
  asActorId,
  asNamespaceId,
  asRevisionId,
  asSubjectId,
  type GovernedEdge,
  type GovernedNode,
} from '../../../src/index.js';
import {
  applyGovernedDeltaToDossier,
  mapDossierToGoverned,
  namespaceForBinding,
  subjectForBinding,
  type RecordAttribution,
} from '../../../src/adapters/algerknown/index.js';
import { loadFixtureManifest, readSnapshot } from '../../fixtures/algerknown/loader.js';

const stubAttribution: RecordAttribution = {
  provenance: { sources: [], railId: 'human-gated', evaluatorVerdicts: [] },
  revision: {
    revisionId: asRevisionId('synthetic-0'),
    namespaceRevision: 0,
    createdAt: '2026-07-13T00:00:00.000Z',
    actorId: asActorId('fixture-seed'),
    actorClass: 'human',
  },
  confidence: 1,
};

function loadFixtureDossier(summaryId: string): Dossier {
  const manifest = loadFixtureManifest();
  const entry = manifest.dossiers.find((d) => d.summaryId === summaryId)!;
  const summary = parse(readSnapshot(entry)) as Summary;
  return summary.dossier!;
}

describe('mapDossierToGoverned', () => {
  const dossier = loadFixtureDossier('agent-evals-dossier');
  const namespace = namespaceForBinding({ projectKey: dossier.project_key, summaryId: 'agent-evals-dossier', path: 'summaries/agent-evals-dossier.yaml' });
  const subject = subjectForBinding({ projectKey: dossier.project_key, summaryId: 'agent-evals-dossier', path: 'summaries/agent-evals-dossier.yaml' });

  it('maps every dossier record to a node with an unchanged id', () => {
    const { nodes } = mapDossierToGoverned(dossier, namespace, subject, () => stubAttribution);
    const nodeIds = new Set(nodes.map((n) => String(n.id)));

    for (const ev of dossier.evidence) expect(nodeIds.has(ev.id)).toBe(true);
    for (const fact of dossier.facts) expect(nodeIds.has(fact.id)).toBe(true);
    for (const res of dossier.resources) expect(nodeIds.has(res.id)).toBe(true);
    for (const proh of dossier.prohibitions) expect(nodeIds.has(proh.id)).toBe(true);
    for (const gap of dossier.known_gaps) expect(nodeIds.has(gap.id)).toBe(true);

    const total = dossier.evidence.length + dossier.facts.length + dossier.resources.length + dossier.prohibitions.length + dossier.known_gaps.length;
    expect(nodes.length).toBe(total);
  });

  it('tags known-gap observations distinctly from evidence observations', () => {
    const { nodes } = mapDossierToGoverned(dossier, namespace, subject, () => stubAttribution);
    const gapIds = new Set(dossier.known_gaps.map((g) => g.id));
    const evidenceIds = new Set(dossier.evidence.map((e) => e.id));

    for (const node of nodes) {
      if (node.type !== 'observation') continue;
      const context = (node.payload as unknown as { context: { recordKind: string } }).context;
      if (gapIds.has(String(node.id))) expect(context.recordKind).toBe('known_gap');
      if (evidenceIds.has(String(node.id))) expect(context.recordKind).toBe('evidence');
    }
  });

  it('produces one evidence_for edge per fact/resource/prohibition evidence_id reference', () => {
    const { edges } = mapDossierToGoverned(dossier, namespace, subject, () => stubAttribution);
    const evidenceForEdges = edges.filter((e) => e.kind === 'evidence_for');

    const expectedCount =
      dossier.facts.reduce((n, f) => n + f.evidence_ids.length, 0) +
      dossier.resources.reduce((n, r) => n + r.evidence_ids.length, 0) +
      dossier.prohibitions.reduce((n, p) => n + p.evidence_ids.length, 0);

    expect(evidenceForEdges.length).toBe(expectedCount);
    for (const fact of dossier.facts) {
      for (const evId of fact.evidence_ids) {
        expect(evidenceForEdges.some((e) => String(e.sourceId) === evId && String(e.targetId) === fact.id)).toBe(true);
      }
    }
  });

  it('produces about edges for prohibition resource_ids and known-gap relations', () => {
    const { edges } = mapDossierToGoverned(dossier, namespace, subject, () => stubAttribution);
    const aboutEdges = edges.filter((e) => e.kind === 'about');

    for (const proh of dossier.prohibitions) {
      for (const resId of proh.resource_ids ?? []) {
        expect(aboutEdges.some((e) => String(e.sourceId) === proh.id && String(e.targetId) === resId)).toBe(true);
      }
    }
    for (const gap of dossier.known_gaps) {
      for (const factId of gap.related_fact_ids ?? []) {
        expect(aboutEdges.some((e) => String(e.sourceId) === gap.id && String(e.targetId) === factId)).toBe(true);
      }
      for (const resId of gap.related_resource_ids ?? []) {
        expect(aboutEdges.some((e) => String(e.sourceId) === gap.id && String(e.targetId) === resId)).toBe(true);
      }
    }
  });

  it('preserves algerknown-specific fields losslessly in payload extensions', () => {
    const { nodes } = mapDossierToGoverned(dossier, namespace, subject, () => stubAttribution);

    const fact = dossier.facts[0]!;
    const factNode = nodes.find((n) => String(n.id) === fact.id)!;
    const factPayload = factNode.payload as unknown as { attributes: { status: string; safe_phrasings: string[] } };
    expect(factPayload.attributes.status).toBe(fact.status);
    expect(factPayload.attributes.safe_phrasings).toEqual(fact.safe_phrasings);

    const resource = dossier.resources[0]!;
    const resourceNode = nodes.find((n) => String(n.id) === resource.id)!;
    expect((resourceNode.payload as unknown as { extensions: { purpose: string } }).extensions.purpose).toBe(resource.purpose);

    const evidence = dossier.evidence[0]!;
    const evidenceNode = nodes.find((n) => String(n.id) === evidence.id)!;
    expect((evidenceNode.payload as unknown as { context: { immutable_ref: string } }).context.immutable_ref).toBe(
      evidence.immutable_ref,
    );
  });
});

describe('applyGovernedDeltaToDossier: full round trip preserves dossier structure', () => {
  for (const summaryId of ['agent-evals-dossier', 'agent-ops-dossier']) {
    it(`${summaryId}: read then reapply the full node/edge set reproduces the original dossier`, () => {
      const dossier = loadFixtureDossier(summaryId);
      const namespace = asNamespaceId('canonical.project.test');
      const subject = asSubjectId('algerknown.summary:test:dossier');

      const { nodes, edges } = mapDossierToGoverned(dossier, namespace, subject, () => stubAttribution);

      const empty: Dossier = {
        project_key: dossier.project_key,
        last_reviewed: dossier.last_reviewed,
        reviewer: dossier.reviewer,
        evidence: [],
        facts: [],
        resources: [],
        prohibitions: [],
        known_gaps: [],
      };

      const rebuilt = applyGovernedDeltaToDossier(empty, nodes as GovernedNode[], [], edges as GovernedEdge[], []);

      expect(rebuilt).toEqual(dossier);
    });
  }
});

describe('exact_phrase prohibition variant (not exercised by the cohort-1 fixture)', () => {
  const dossier: Dossier = {
    project_key: 'synthetic',
    last_reviewed: '2026-07-01',
    reviewer: { id: 'r', display_name: 'R' },
    evidence: [{ id: 'ev-1', kind: 'git-blob', locator: 'loc', immutable_ref: 'a'.repeat(40) }],
    facts: [],
    resources: [],
    prohibitions: [
      {
        id: 'proh-exact',
        exact_phrase: 'guaranteed uptime',
        forbidden_phrasings: ['guaranteed uptime'],
        evidence_ids: ['ev-1'],
        resource_ids: [],
      },
    ],
    known_gaps: [],
  };
  const namespace = asNamespaceId('canonical.project.test');
  const subject = asSubjectId('algerknown.summary:test:dossier');

  it('maps exact_phrase into extensions.matcher and round-trips it', () => {
    const { nodes, edges } = mapDossierToGoverned(dossier, namespace, subject, () => stubAttribution);
    const node = nodes.find((n) => n.type === 'prohibition')!;
    expect(
      (node.payload as unknown as { extensions: { matcher: { exact_phrase?: string } } }).extensions.matcher.exact_phrase,
    ).toBe('guaranteed uptime');

    const empty: Dossier = { ...dossier, evidence: [], prohibitions: [] };
    const rebuilt = applyGovernedDeltaToDossier(empty, nodes as GovernedNode[], [], edges as GovernedEdge[], []);
    expect(rebuilt).toEqual(dossier);
  });
});

describe('applyGovernedDeltaToDossier: incremental mutation', () => {
  it('adding a new evidence_for edge appends to evidence_ids without disturbing existing ones', () => {
    const dossier = loadFixtureDossier('agent-evals-dossier');
    const namespace = asNamespaceId('canonical.project.test');
    const subject = asSubjectId('algerknown.summary:test:dossier');
    const { edges } = mapDossierToGoverned(dossier, namespace, subject, () => stubAttribution);

    const fact = dossier.facts[0]!;
    const evidence = dossier.evidence.find((e) => !fact.evidence_ids.includes(e.id))!;
    const newEdge = edges.find((e) => e.kind === 'evidence_for')!;
    void newEdge;

    const updated = applyGovernedDeltaToDossier(
      dossier,
      [],
      [],
      [
        {
          id: `evidence_for:${evidence.id}:${fact.id}` as GovernedEdge['id'],
          kind: 'evidence_for',
          namespace,
          sourceId: evidence.id as GovernedEdge['sourceId'],
          targetId: fact.id as GovernedEdge['targetId'],
          provenance: stubAttribution.provenance,
          revision: stubAttribution.revision,
        },
      ],
      [],
    );

    const updatedFact = updated.facts.find((f) => f.id === fact.id)!;
    expect(updatedFact.evidence_ids).toEqual([...fact.evidence_ids, evidence.id]);
  });

  it('deleting a node removes it from its containing array and is idempotent', () => {
    const dossier = loadFixtureDossier('agent-ops-dossier');
    const gap = dossier.known_gaps[0]!;

    const once = applyGovernedDeltaToDossier(dossier, [], [gap.id as any], [], []);
    expect(once.known_gaps.find((g) => g.id === gap.id)).toBeUndefined();

    const twice = applyGovernedDeltaToDossier(once, [], [gap.id as any], [], []);
    expect(twice.known_gaps).toEqual(once.known_gaps);
  });
});
