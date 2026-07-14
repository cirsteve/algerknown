import type {
  Dossier,
  DossierEvidence,
  DossierFact,
  DossierFactStatus,
  DossierKnownGap,
  DossierProhibition,
  DossierProhibitionRegex,
  DossierResource,
} from '@algerknown/core';
import { asNodeId } from '../../domain/ids.js';
import type { EdgeId, NamespaceId, NodeId, SubjectId } from '../../domain/ids.js';
import type { EdgeKind } from '../../domain/edge.js';
import type { GovernedEdge } from '../../domain/edge.js';
import type { GovernedNode } from '../../domain/node.js';
import type { Provenance } from '../../domain/provenance.js';
import type { RevisionMeta } from '../../domain/revision.js';
import { buildEdgeId, isNativeEdgeKind, parseEdgeId } from './edge-ids.js';

// ---------------------------------------------------------------------------
// Read direction: Dossier -> governed nodes/edges
// ---------------------------------------------------------------------------

export interface RecordAttribution {
  provenance: Provenance;
  revision: RevisionMeta;
}

/** Supplies the governance metadata a dossier record itself does not carry (sidecar-backed, or synthesized). */
export type AttributionResolver = (recordOrEdgeId: string) => RecordAttribution;

function prohibitionMatcher(proh: DossierProhibition): Record<string, unknown> {
  if ('exact_phrase' in proh && proh.exact_phrase !== undefined) {
    return { exact_phrase: proh.exact_phrase };
  }
  if ('normalized_phrase' in proh && proh.normalized_phrase !== undefined) {
    return { normalized_phrase: proh.normalized_phrase };
  }
  const regexProh = proh as DossierProhibitionRegex;
  return { regex: regexProh.regex, ...(regexProh.flags !== undefined ? { flags: regexProh.flags } : {}) };
}

function prohibitionRule(proh: DossierProhibition): string {
  if ('exact_phrase' in proh && proh.exact_phrase !== undefined) {
    return `Do not use the exact phrase: "${proh.exact_phrase}"`;
  }
  if ('normalized_phrase' in proh && proh.normalized_phrase !== undefined) {
    return `Do not use phrasing that normalizes to: "${proh.normalized_phrase}"`;
  }
  const regexProh = proh as DossierProhibitionRegex;
  return `Do not match the forbidden pattern /${regexProh.regex}/${regexProh.flags ?? ''}`;
}

export function mapDossierToGoverned(
  dossier: Dossier,
  namespace: NamespaceId,
  subject: SubjectId,
  resolveAttribution: AttributionResolver,
): { nodes: GovernedNode[]; edges: GovernedEdge[] } {
  const nodes: GovernedNode[] = [];
  const edges: GovernedEdge[] = [];

  const mkNode = (id: string, type: GovernedNode['type'], payload: Record<string, unknown>): GovernedNode => {
    const { provenance, revision } = resolveAttribution(id);
    return {
      id: asNodeId(id),
      type,
      namespace,
      subject,
      payload,
      confidence: 1,
      provenance,
      revision,
    } as unknown as GovernedNode;
  };

  const mkEdge = (kind: EdgeKind, sourceId: string, targetId: string): GovernedEdge => {
    const id = buildEdgeId(kind, asNodeId(sourceId), asNodeId(targetId));
    const { provenance, revision } = resolveAttribution(String(id));
    return { id, kind, namespace, sourceId: asNodeId(sourceId), targetId: asNodeId(targetId), provenance, revision };
  };

  for (const ev of dossier.evidence) {
    nodes.push(
      mkNode(ev.id, 'observation', {
        description: ev.locator,
        context: { recordKind: 'evidence', kind: ev.kind, immutable_ref: ev.immutable_ref },
      }),
    );
  }

  for (const fact of dossier.facts) {
    nodes.push(
      mkNode(fact.id, 'fact', {
        statement: fact.claim,
        attributes: { status: fact.status, safe_phrasings: fact.safe_phrasings },
      }),
    );
    for (const evId of fact.evidence_ids) edges.push(mkEdge('evidence_for', evId, fact.id));
  }

  for (const res of dossier.resources) {
    nodes.push(
      mkNode(res.id, 'resource', {
        locator: res.canonical_url,
        label: res.label,
        extensions: { purpose: res.purpose },
      }),
    );
    for (const evId of res.evidence_ids) edges.push(mkEdge('evidence_for', evId, res.id));
  }

  for (const proh of dossier.prohibitions) {
    nodes.push(
      mkNode(proh.id, 'prohibition', {
        rule: prohibitionRule(proh),
        extensions: { matcher: prohibitionMatcher(proh), forbidden_phrasings: proh.forbidden_phrasings },
      }),
    );
    for (const evId of proh.evidence_ids) edges.push(mkEdge('evidence_for', evId, proh.id));
    for (const resId of proh.resource_ids ?? []) edges.push(mkEdge('about', proh.id, resId));
  }

  for (const gap of dossier.known_gaps) {
    nodes.push(
      mkNode(gap.id, 'observation', {
        description: gap.question,
        context: { recordKind: 'known_gap' },
      }),
    );
    for (const factId of gap.related_fact_ids ?? []) edges.push(mkEdge('about', gap.id, factId));
    for (const resId of gap.related_resource_ids ?? []) edges.push(mkEdge('about', gap.id, resId));
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Write direction: governed node/edge mutations -> updated Dossier
// ---------------------------------------------------------------------------

type RecordKind = 'evidence' | 'fact' | 'resource' | 'prohibition' | 'known_gap';

interface RecordLocation {
  kind: RecordKind;
  index: number;
}

function locateRecord(dossier: Dossier, id: string): RecordLocation | undefined {
  let index = dossier.evidence.findIndex((r) => r.id === id);
  if (index !== -1) return { kind: 'evidence', index };
  index = dossier.facts.findIndex((r) => r.id === id);
  if (index !== -1) return { kind: 'fact', index };
  index = dossier.resources.findIndex((r) => r.id === id);
  if (index !== -1) return { kind: 'resource', index };
  index = dossier.prohibitions.findIndex((r) => r.id === id);
  if (index !== -1) return { kind: 'prohibition', index };
  index = dossier.known_gaps.findIndex((r) => r.id === id);
  if (index !== -1) return { kind: 'known_gap', index };
  return undefined;
}

function recordKindForNode(node: GovernedNode): RecordKind {
  if (node.type === 'fact') return 'fact';
  if (node.type === 'resource') return 'resource';
  if (node.type === 'prohibition') return 'prohibition';
  if (node.type === 'observation') {
    const context = (node.payload as { context?: { recordKind?: string } }).context;
    if (context?.recordKind === 'evidence') return 'evidence';
    if (context?.recordKind === 'known_gap') return 'known_gap';
  }
  throw new Error(`node type "${node.type}" (id ${String(node.id)}) has no algerknown dossier mapping; cannot round-trip losslessly`);
}

function addUnique(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr : [...arr, value];
}

function removeValue(arr: string[], value: string): string[] {
  return arr.filter((v) => v !== value);
}

function upsertNode(dossier: Dossier, node: GovernedNode): void {
  const recordKind = recordKindForNode(node);
  const id = String(node.id);
  const location = locateRecord(dossier, id);
  const existingIndex = location && location.kind === recordKind ? location.index : undefined;

  if (recordKind === 'evidence') {
    const payload = node.payload as unknown as { description: string; context: { kind: string; immutable_ref: string } };
    const record: DossierEvidence = {
      id,
      kind: payload.context.kind,
      locator: payload.description,
      immutable_ref: payload.context.immutable_ref,
    };
    if (existingIndex !== undefined) dossier.evidence[existingIndex] = record;
    else dossier.evidence.push(record);
    return;
  }

  if (recordKind === 'fact') {
    const payload = node.payload as unknown as {
      statement: string;
      attributes: { status: DossierFactStatus; safe_phrasings: string[] };
    };
    const existing = existingIndex !== undefined ? dossier.facts[existingIndex] : undefined;
    const record: DossierFact = {
      id,
      claim: payload.statement,
      status: payload.attributes.status,
      safe_phrasings: payload.attributes.safe_phrasings as [string, ...string[]],
      evidence_ids: (existing?.evidence_ids ?? []) as [string, ...string[]],
    };
    if (existingIndex !== undefined) dossier.facts[existingIndex] = record;
    else dossier.facts.push(record);
    return;
  }

  if (recordKind === 'resource') {
    const payload = node.payload as unknown as { locator: string; label?: string; extensions?: { purpose?: string } };
    const existing = existingIndex !== undefined ? dossier.resources[existingIndex] : undefined;
    const record: DossierResource = {
      id,
      label: payload.label ?? existing?.label ?? '',
      canonical_url: payload.locator,
      purpose: payload.extensions?.purpose ?? existing?.purpose ?? '',
      evidence_ids: (existing?.evidence_ids ?? []) as [string, ...string[]],
    };
    if (existingIndex !== undefined) dossier.resources[existingIndex] = record;
    else dossier.resources.push(record);
    return;
  }

  if (recordKind === 'prohibition') {
    const payload = node.payload as unknown as {
      extensions: { matcher: Record<string, unknown>; forbidden_phrasings: string[] };
    };
    const existing = existingIndex !== undefined ? dossier.prohibitions[existingIndex] : undefined;
    const matcher = payload.extensions.matcher;
    const base = {
      id,
      forbidden_phrasings: payload.extensions.forbidden_phrasings as [string, ...string[]],
      evidence_ids: (existing?.evidence_ids ?? []) as [string, ...string[]],
      resource_ids: existing?.resource_ids ?? [],
    };
    let record: DossierProhibition;
    if (typeof matcher.exact_phrase === 'string') {
      record = { ...base, exact_phrase: matcher.exact_phrase };
    } else if (typeof matcher.normalized_phrase === 'string') {
      record = { ...base, normalized_phrase: matcher.normalized_phrase };
    } else {
      record = {
        ...base,
        regex: matcher.regex as string,
        ...(typeof matcher.flags === 'string' ? { flags: matcher.flags } : {}),
      };
    }
    if (existingIndex !== undefined) dossier.prohibitions[existingIndex] = record;
    else dossier.prohibitions.push(record);
    return;
  }

  // known_gap
  const payload = node.payload as unknown as { description: string };
  const existing = existingIndex !== undefined ? dossier.known_gaps[existingIndex] : undefined;
  const record: DossierKnownGap = {
    id,
    question: payload.description,
    related_fact_ids: existing?.related_fact_ids ?? [],
    related_resource_ids: existing?.related_resource_ids ?? [],
  };
  if (existingIndex !== undefined) dossier.known_gaps[existingIndex] = record;
  else dossier.known_gaps.push(record);
}

function deleteNode(dossier: Dossier, nodeId: NodeId): void {
  const id = String(nodeId);
  const location = locateRecord(dossier, id);
  if (!location) return; // already absent -- delete is idempotent
  switch (location.kind) {
    case 'evidence':
      dossier.evidence.splice(location.index, 1);
      return;
    case 'fact':
      dossier.facts.splice(location.index, 1);
      return;
    case 'resource':
      dossier.resources.splice(location.index, 1);
      return;
    case 'prohibition':
      dossier.prohibitions.splice(location.index, 1);
      return;
    case 'known_gap':
      dossier.known_gaps.splice(location.index, 1);
      return;
  }
}

function evidenceIdsHolder(dossier: Dossier, location: RecordLocation): { evidence_ids: string[] } {
  if (location.kind === 'fact') return dossier.facts[location.index]!;
  if (location.kind === 'resource') return dossier.resources[location.index]!;
  if (location.kind === 'prohibition') return dossier.prohibitions[location.index]!;
  throw new Error(`record kind "${location.kind}" does not carry evidence_ids`);
}

function applyNativeReference(dossier: Dossier, kind: EdgeKind, sourceId: string, targetId: string, add: boolean): void {
  const mutate = add ? addUnique : removeValue;

  if (kind === 'evidence_for') {
    const location = locateRecord(dossier, targetId);
    if (!location) {
      if (!add) return; // deleting a reference whose target is already gone is a no-op
      throw new Error(`evidence_for edge targets unknown record "${targetId}"`);
    }
    const holder = evidenceIdsHolder(dossier, location);
    holder.evidence_ids = mutate(holder.evidence_ids, sourceId);
    return;
  }

  if (kind === 'about') {
    const sourceLocation = locateRecord(dossier, sourceId);
    if (!sourceLocation) {
      if (!add) return;
      throw new Error(`about edge sources from unknown record "${sourceId}"`);
    }
    if (sourceLocation.kind === 'prohibition') {
      const proh = dossier.prohibitions[sourceLocation.index]!;
      proh.resource_ids = mutate(proh.resource_ids ?? [], targetId);
      return;
    }
    if (sourceLocation.kind === 'known_gap') {
      const gap = dossier.known_gaps[sourceLocation.index]!;
      const targetLocation = locateRecord(dossier, targetId);
      if (targetLocation?.kind === 'fact') {
        gap.related_fact_ids = mutate(gap.related_fact_ids ?? [], targetId);
      } else if (targetLocation?.kind === 'resource') {
        gap.related_resource_ids = mutate(gap.related_resource_ids ?? [], targetId);
      } else if (add) {
        throw new Error(`about edge from known_gap "${sourceId}" targets unsupported record "${targetId}"`);
      }
      return;
    }
    if (add) {
      throw new Error(`about edge source "${sourceId}" must be a prohibition or known_gap record`);
    }
  }
}

/**
 * Applies a resolved set of node/edge mutations to a working copy of the
 * dossier. Native edges (evidence_for, about) are folded directly into the
 * relevant *_ids array; derived_from/contradicts/supersedes edges have no
 * dossier-field representation and are left for the caller to persist in the
 * namespace sidecar (see edge-ids.ts#isNativeEdgeKind).
 */
export function applyGovernedDeltaToDossier(
  currentDossier: Dossier,
  nodesUpserted: GovernedNode[],
  nodesDeleted: NodeId[],
  edgesUpserted: GovernedEdge[],
  edgesDeleted: EdgeId[],
): Dossier {
  const dossier = structuredClone(currentDossier);

  for (const node of nodesUpserted) upsertNode(dossier, node);
  for (const nodeId of nodesDeleted) deleteNode(dossier, nodeId);

  for (const edge of edgesUpserted) {
    if (isNativeEdgeKind(edge.kind)) {
      applyNativeReference(dossier, edge.kind, String(edge.sourceId), String(edge.targetId), true);
    }
  }
  for (const edgeId of edgesDeleted) {
    const parsed = parseEdgeId(edgeId);
    if (isNativeEdgeKind(parsed.kind)) {
      applyNativeReference(dossier, parsed.kind, String(parsed.sourceId), String(parsed.targetId), false);
    }
  }

  return dossier;
}
