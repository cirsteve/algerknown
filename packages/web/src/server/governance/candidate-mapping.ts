import { execFileSync } from 'node:child_process';
import * as core from '@algerknown/core';
import {
  asActorId,
  asEdgeId,
  asIdempotencyKey,
  asNamespaceId,
  asNodeId,
  asProcessorId,
  asSubjectId,
  type IdGenerator,
  type NodeId,
  type ProposeInput,
  type Repository,
  type WriteCommand,
} from '@algerknown/governed';

export class CandidateMappingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'CandidateMappingError';
    this.code = code;
  }
}

export interface RagCandidateLearning {
  insight: string;
  context?: string;
  relevance?: string[];
}

export interface RagCandidateDecision {
  decision: string;
  rationale?: string;
  date?: string;
}

export interface RagCandidateLink {
  id: string;
  relationship: string;
  notes?: string;
}

export interface RagCandidateInput {
  sourceEntryId: string;
  targetSummaryId: string;
  confidence: number;
  processorVersion: string;
  newLearnings?: RagCandidateLearning[];
  newDecisions?: RagCandidateDecision[];
  newOpenQuestions?: string[];
  newLinks?: RagCandidateLink[];
}

function gitHeadCommit(repoRoot: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repoRoot, encoding: 'utf-8' }).trim();
  } catch {
    return undefined;
  }
}

function entryObservationId(entryId: string): NodeId {
  return asNodeId(`entry-observation:${entryId}`);
}

function linkObservationId(entryId: string): NodeId {
  return entryObservationId(entryId);
}

/**
 * Converts a specialized RAG candidate into a generic governed WriteCommand
 * targeting the sqlite-backed memory.project.<projectKey> namespace (not the
 * git-backed dossier namespace, whose mapping only round-trips
 * fact/resource/prohibition/observation records -- decision/interaction node
 * types and free-form list content have no dossier field to live in). File
 * identity and provenance are re-derived server-side from ALGERKNOWN_ROOT and
 * git, never trusted from the generation process.
 *
 * new_learnings -> observation-node creates; new_decisions -> decision-node
 * creates; new_open_questions -> observation nodes tagged open_question;
 * new_links -> 'about' edges via a small link-note observation node (the
 * governed Edge domain type carries no metadata fields of its own, so
 * relationship/notes are carried on that node's payload instead).
 */
export async function buildCandidateProposeInput(
  deps: { algerknownRoot: string; idGenerator: IdGenerator; repository: Repository; processorId: string; processorVersion: string },
  input: RagCandidateInput,
  idempotencyKey: string,
): Promise<ProposeInput> {
  const entry = core.readEntry(input.sourceEntryId, deps.algerknownRoot);
  if (!entry) {
    throw new CandidateMappingError('source_entry_not_found', `source entry "${input.sourceEntryId}" was not found`);
  }
  const summary = core.readEntry(input.targetSummaryId, deps.algerknownRoot);
  if (!summary || summary.type !== 'summary') {
    throw new CandidateMappingError('target_summary_not_found', `target summary "${input.targetSummaryId}" was not found`);
  }

  const entryPath = core.resolveEntryPath(input.sourceEntryId, deps.algerknownRoot);
  const commit = gitHeadCommit(deps.algerknownRoot);

  // The target Summary's own dossier project_key, when it has one, scopes
  // this to the same project as its governed dossier; otherwise the summary
  // id itself is a stable per-summary project key. Either way this is
  // derived server-side from ALGERKNOWN_ROOT, never trusted from the caller.
  const projectKey = summary.dossier?.project_key ?? input.targetSummaryId;
  const namespace = asNamespaceId(`memory.project.${projectKey}`);
  const subject = asSubjectId(`algerknown.summary:${input.targetSummaryId}:memory`);
  const anchorId = entryObservationId(input.sourceEntryId);

  const nodeMutations: WriteCommand['nodeMutations'] = [];
  const edgeMutations: WriteCommand['edgeMutations'] = [];

  const anchorExists = await deps.repository.getNode(namespace, anchorId);
  if (!anchorExists) {
    nodeMutations.push({
      op: 'create',
      nodeId: anchorId,
      nodeType: 'observation',
      payload: {
        description: `Source entry: ${input.sourceEntryId}`,
        context: { recordKind: 'source-entry', entryId: input.sourceEntryId, path: entryPath, commit: commit ?? null },
      },
      confidence: 1,
    });
  }

  const derivedFromAnchor = (nodeId: NodeId): void => {
    edgeMutations.push({
      op: 'create',
      edgeId: asEdgeId(`derived_from:${nodeId}:${anchorId}`),
      kind: 'derived_from',
      sourceId: nodeId,
      targetId: anchorId,
    });
  };

  for (const learning of input.newLearnings ?? []) {
    const nodeId = deps.idGenerator.nextNodeId();
    nodeMutations.push({
      op: 'create',
      nodeId,
      nodeType: 'observation',
      payload: { description: learning.insight, context: { recordKind: 'learning', context: learning.context, relevance: learning.relevance ?? [] } },
      confidence: input.confidence,
    });
    derivedFromAnchor(nodeId);
  }

  for (const decision of input.newDecisions ?? []) {
    const nodeId = deps.idGenerator.nextNodeId();
    nodeMutations.push({
      op: 'create',
      nodeId,
      nodeType: 'decision',
      payload: { statement: decision.decision, ...(decision.rationale !== undefined ? { rationale: decision.rationale } : {}), alternatives: [] },
      confidence: input.confidence,
    });
    derivedFromAnchor(nodeId);
  }

  for (const question of input.newOpenQuestions ?? []) {
    const nodeId = deps.idGenerator.nextNodeId();
    nodeMutations.push({
      op: 'create',
      nodeId,
      nodeType: 'observation',
      payload: { description: question, context: { recordKind: 'open_question' } },
      confidence: input.confidence,
    });
    derivedFromAnchor(nodeId);
  }

  for (const link of input.newLinks ?? []) {
    const linkNodeId = deps.idGenerator.nextNodeId();
    nodeMutations.push({
      op: 'create',
      nodeId: linkNodeId,
      nodeType: 'observation',
      payload: {
        description: link.notes ? `${link.relationship}: ${link.notes}` : link.relationship,
        context: { recordKind: 'link', relationship: link.relationship, targetEntryId: link.id },
      },
      confidence: input.confidence,
    });
    derivedFromAnchor(linkNodeId);

    const targetAnchor = linkObservationId(link.id);
    const targetAnchorExists = await deps.repository.getNode(namespace, targetAnchor);
    if (!targetAnchorExists && !nodeMutations.some((m) => m.op === 'create' && m.nodeId === targetAnchor)) {
      nodeMutations.push({
        op: 'create',
        nodeId: targetAnchor,
        nodeType: 'observation',
        payload: { description: `Source entry: ${link.id}`, context: { recordKind: 'source-entry', entryId: link.id } },
        confidence: 1,
      });
    }
    edgeMutations.push({
      op: 'create',
      edgeId: asEdgeId(`about:${linkNodeId}:${targetAnchor}`),
      kind: 'about',
      sourceId: linkNodeId,
      targetId: targetAnchor,
    });
  }

  const command: WriteCommand = {
    namespace,
    subject,
    nodeMutations,
    edgeMutations,
    expectedNamespaceRevision: null,
    idempotencyKey: asIdempotencyKey(idempotencyKey),
    actorId: asActorId(deps.processorId),
    actorClass: 'processor',
    provenanceInput: {
      sources: [{ kind: 'external', id: input.sourceEntryId, locator: entryPath ?? input.sourceEntryId }],
      processorId: asProcessorId(deps.processorId),
      processorVersion: input.processorVersion,
      sourceDerived: true,
    },
  };

  return {
    mutation: command,
    supportingObservationIds: [anchorId],
    idempotencyKey,
  };
}
