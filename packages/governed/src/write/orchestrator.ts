import { NamespaceMatcher } from '../config/namespace-matcher.js';
import { SchemaRegistry } from '../config/schema-registry.js';
import type { GovernedConfig } from '../config/governed-config.js';
import type { PreparedWrite, Repository, RevisionRecord } from '../ports/repository.js';
import type { ProposalRepository } from '../ports/proposal-repository.js';
import type { OperationSink } from '../ports/operation-sink.js';
import type { Processor } from '../ports/processor.js';
import type { ContradictionDetector } from '../ports/contradiction-detector.js';
import type { AttestationVerifier } from '../ports/attestation-verifier.js';
import type { UsageCounter } from '../ports/usage-counter.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { EdgeMutation, NodeMutation, WriteCommand } from '../domain/write-command.js';
import type { AppliedWriteResult, WriteResult } from '../domain/write-result.js';
import type { GovernedNode, NodeType } from '../domain/node.js';
import type { GovernedEdge } from '../domain/edge.js';
import type { EdgeId, MutationHash, NodeId } from '../domain/ids.js';
import type { ReasonCode } from '../domain/reason-codes.js';
import type { EvaluatorVerdict } from '../domain/provenance.js';
import type { DiffChangeKind, NodeLevelDiff } from '../domain/revision.js';
import type { Proposal } from '../domain/proposal.js';
import { normalizeWriteCommand } from './normalize.js';
import { buildEdgeDiff, buildNodeDiff, invertDiff } from './diff.js';
import {
  evaluateOperationShape,
  evaluateLoadedTargets,
  evaluateTruthTypePlacement,
  evaluateAiTruthMutationBlock,
  evaluateNodeTypeKnown,
  evaluatePayloadSchema,
  evaluateActorClassAllowed,
  evaluateAttestationRequirement,
  evaluateProvenanceCompleteness,
  evaluateDerivedFromRequirement,
  evaluateProposalObservationSupport,
  evaluateProposalSupportEdge,
  evaluateConfidence,
  evaluateProcessorVolume,
  evaluateContradictions,
  computeAuditDirective,
} from './evaluators/index.js';
import { resolvePolicyMode } from '../rails/registry.js';
import type { PolicyModeRegistry } from '../rails/policy-mode.js';

export interface WriteOrchestratorDeps {
  config: GovernedConfig;
  repository: Repository;
  proposalRepository: ProposalRepository;
  operationSink: OperationSink;
  processor: Processor;
  contradictionDetector: ContradictionDetector;
  attestationVerifier: AttestationVerifier;
  usageCounter: UsageCounter;
  clock: Clock;
  idGenerator: IdGenerator;
  /** Defaults to the three built-in modes; pass a superset to register additional custom policies. */
  policyModes?: PolicyModeRegistry;
}

export interface WriteOptions {
  /**
   * Override only the final persistence call. SQLite proposal lifecycle code
   * uses this to commit the already-governed PreparedWrite and proposal-side
   * bookkeeping in one database transaction. Every evaluator still runs in
   * the normal orchestrator pipeline before this callback is reached.
   */
  commit?: (write: PreparedWrite) => void | Promise<void>;
}

function rejected(reasonCodes: ReasonCode[], verdicts: EvaluatorVerdict[]): WriteResult {
  return { outcome: 'rejected', reasonCodes, evaluatorVerdicts: verdicts };
}

function conflict(expectedRevision: number | null, actualRevision: number): WriteResult {
  return { outcome: 'conflict', reasonCodes: ['STALE_REVISION'], expectedRevision, actualRevision };
}

function appliedFromRevisionRecord(record: RevisionRecord): AppliedWriteResult {
  const result: AppliedWriteResult = {
    outcome: 'applied',
    previousRevision: record.previousRevision,
    resultingRevision: record.namespaceRevision,
    diff: record.diff,
  };
  if (record.auditDirective) {
    result.auditDirective = record.auditDirective;
  }
  return result;
}

interface ResolvedNode {
  mutation: NodeMutation;
  changeKind: DiffChangeKind;
  effectiveType: NodeType;
  existing: GovernedNode | undefined;
  resultingPayload: Record<string, unknown> | undefined;
  resultingConfidence: number | undefined;
}

interface ResolvedEdge {
  mutation: EdgeMutation;
  changeKind: DiffChangeKind;
  existing: GovernedEdge | undefined;
  resultingKind: string | undefined;
  resultingSourceId: NodeId | undefined;
  resultingTargetId: NodeId | undefined;
}

type ResolveOutcome<T> = { ok: true; value: T } | { ok: false; reasonCode: ReasonCode };

/**
 * The single deterministic write orchestrator. Every WriteCommand passes
 * through the fixed twelve-step pipeline in exactly this order; no adapter or
 * caller can skip a step.
 */
export class WriteOrchestrator {
  private readonly namespaceMatcher: NamespaceMatcher;
  private readonly schemaRegistry: SchemaRegistry;
  private readonly policyModes: PolicyModeRegistry | undefined;

  constructor(private readonly deps: WriteOrchestratorDeps) {
    this.namespaceMatcher = new NamespaceMatcher(deps.config.namespaceTable);
    this.schemaRegistry = new SchemaRegistry(deps.config.schemas);
    this.policyModes = deps.policyModes;
  }

  async write(command: WriteCommand, options: WriteOptions = {}): Promise<WriteResult> {
    const verdicts: EvaluatorVerdict[] = [];

    // Step 1: normalize and hash.
    const { command: normalized, mutationHash } = normalizeWriteCommand(command);

    // Step 2: resolve namespace policy.
    let namespaceEntry;
    try {
      namespaceEntry = this.namespaceMatcher.resolve(normalized.namespace);
    } catch {
      return rejected(['UNKNOWN_NAMESPACE'], verdicts);
    }
    const policyMode = resolvePolicyMode(namespaceEntry.policy, this.policyModes);

    // Step 3: enforce operation shape and append-only rules.
    const shapeVerdict = evaluateOperationShape(normalized, namespaceEntry);
    verdicts.push(shapeVerdict);
    if (!shapeVerdict.passed) return rejected(shapeVerdict.reasonCodes, verdicts);

    // Step 4: load authoritative state.
    const currentRevision = await this.deps.repository.getNamespaceRevision(normalized.namespace);
    const effectiveCurrentRevision = currentRevision ?? 0;
    const loadedNodes = new Map<NodeId, GovernedNode>();
    const loadedEdges = new Map<EdgeId, GovernedEdge>();

    for (const m of normalized.nodeMutations) {
      if (m.op !== 'create') {
        const node = await this.deps.repository.getNode(normalized.namespace, m.nodeId);
        if (node) loadedNodes.set(m.nodeId, node);
      }
    }
    for (const m of normalized.edgeMutations) {
      if (m.op === 'create') {
        for (const id of [m.sourceId, m.targetId]) {
          if (!loadedNodes.has(id)) {
            const node = await this.deps.repository.getNode(normalized.namespace, id);
            if (node) loadedNodes.set(id, node);
          }
        }
      } else {
        const edge = await this.deps.repository.getEdge(normalized.namespace, m.edgeId);
        if (edge) loadedEdges.set(m.edgeId, edge);
      }
    }

    const loadedTargetsVerdict = evaluateLoadedTargets(normalized, {
      nodeNamespaces: new Map([...loadedNodes.entries()].map(([id, n]) => [id, n.namespace])),
      edgeNamespaces: new Map([...loadedEdges.entries()].map(([id, e]) => [id, e.namespace])),
    });
    verdicts.push(loadedTargetsVerdict);
    if (!loadedTargetsVerdict.passed) return rejected(loadedTargetsVerdict.reasonCodes, verdicts);

    // Step 5: check idempotency and expected revision.
    const priorByIdempotency = await this.deps.repository.findByIdempotencyKey(normalized.namespace, normalized.idempotencyKey);
    if (priorByIdempotency) {
      return { outcome: 'idempotent_replay', original: appliedFromRevisionRecord(priorByIdempotency) };
    }
    if (normalized.expectedNamespaceRevision !== null && normalized.expectedNamespaceRevision !== effectiveCurrentRevision) {
      return conflict(normalized.expectedNamespaceRevision, effectiveCurrentRevision);
    }

    const resolvedNodes: ResolvedNode[] = [];
    for (const mutation of normalized.nodeMutations) {
      const outcome = await this.resolveNodeMutation(normalized, mutation, loadedNodes);
      if (!outcome.ok) return rejected([outcome.reasonCode], verdicts);
      resolvedNodes.push(outcome.value);
    }

    const resolvedEdges: ResolvedEdge[] = [];
    for (const mutation of normalized.edgeMutations) {
      const outcome = await this.resolveEdgeMutation(normalized, mutation, loadedEdges);
      if (!outcome.ok) return rejected([outcome.reasonCode], verdicts);
      resolvedEdges.push(outcome.value);
    }

    // Step 6: validate type and schema (create/update only carry a payload to validate).
    for (const rn of resolvedNodes) {
      if (rn.mutation.op === 'create') {
        const typeVerdict = evaluateNodeTypeKnown(rn.mutation.nodeType);
        verdicts.push(typeVerdict);
        if (!typeVerdict.passed) return rejected(typeVerdict.reasonCodes, verdicts);
      }
      if (rn.resultingPayload !== undefined) {
        const schemaVerdict = evaluatePayloadSchema(this.schemaRegistry, rn.effectiveType, rn.resultingPayload);
        verdicts.push(schemaVerdict);
        if (!schemaVerdict.passed) return rejected(schemaVerdict.reasonCodes, verdicts);
      }
    }

    // The two structural truth protections apply to every node mutation, regardless of op.
    for (const rn of resolvedNodes) {
      const placementVerdict = evaluateTruthTypePlacement(rn.effectiveType, namespaceEntry);
      verdicts.push(placementVerdict);
      if (!placementVerdict.passed) return rejected(placementVerdict.reasonCodes, verdicts);

      const aiBlockVerdict = evaluateAiTruthMutationBlock(rn.effectiveType, policyMode);
      verdicts.push(aiBlockVerdict);
      if (!aiBlockVerdict.passed) return rejected(aiBlockVerdict.reasonCodes, verdicts);
    }

    // A supersedes edge targeting a truth-type node is blocked the same way a direct mutation would be.
    for (const mutation of normalized.edgeMutations) {
      if (mutation.op === 'create' && mutation.kind === 'supersedes') {
        const target = loadedNodes.get(mutation.targetId);
        if (target) {
          const supersedeVerdict = evaluateAiTruthMutationBlock(target.type, policyMode);
          verdicts.push(supersedeVerdict);
          if (!supersedeVerdict.passed) return rejected(supersedeVerdict.reasonCodes, verdicts);
        }
      }
    }

    // Step 7: verify actor and attestation.
    const actorVerdict = evaluateActorClassAllowed(policyMode, normalized.actorClass);
    verdicts.push(actorVerdict);
    if (!actorVerdict.passed) return rejected(actorVerdict.reasonCodes, verdicts);

    const attestationVerdict = await evaluateAttestationRequirement(
      policyMode,
      normalized,
      mutationHash,
      this.deps.attestationVerifier,
      this.deps.proposalRepository,
    );
    verdicts.push(attestationVerdict);
    if (!attestationVerdict.passed) return rejected(attestationVerdict.reasonCodes, verdicts);

    // Step 8: validate provenance and support.
    const provenanceVerdict = evaluateProvenanceCompleteness(normalized);
    verdicts.push(provenanceVerdict);
    if (!provenanceVerdict.passed) return rejected(provenanceVerdict.reasonCodes, verdicts);

    const derivedFromVerdict = evaluateDerivedFromRequirement(normalized);
    verdicts.push(derivedFromVerdict);
    if (!derivedFromVerdict.passed) return rejected(derivedFromVerdict.reasonCodes, verdicts);

    const createsProposalNode = resolvedNodes.some((rn) => rn.mutation.op === 'create' && rn.effectiveType === 'proposal');
    if (createsProposalNode) {
      const supportingObservationIds = normalized.edgeMutations
        .filter((m): m is Extract<EdgeMutation, { op: 'create' }> => m.op === 'create' && (m.kind === 'derived_from' || m.kind === 'evidence_for'))
        .map((m) => m.targetId);
      const supportVerdict = evaluateProposalObservationSupport(supportingObservationIds, (id) => loadedNodes.get(id));
      verdicts.push(supportVerdict);
      if (!supportVerdict.passed) return rejected(supportVerdict.reasonCodes, verdicts);

      const supportEdgeVerdict = evaluateProposalSupportEdge(normalized);
      verdicts.push(supportEdgeVerdict);
      if (!supportEdgeVerdict.passed) return rejected(supportEdgeVerdict.reasonCodes, verdicts);
    }

    // Step 9: enforce confidence and processor volume.
    for (const rn of resolvedNodes) {
      if (rn.resultingConfidence !== undefined || rn.mutation.op === 'create' || rn.mutation.op === 'update') {
        const confidenceVerdict = evaluateConfidence(this.deps.config.confidencePolicy, rn.effectiveType, rn.resultingConfidence);
        verdicts.push(confidenceVerdict);
        if (!confidenceVerdict.passed) return rejected(confidenceVerdict.reasonCodes, verdicts);
      }
    }

    if (normalized.actorClass === 'processor' && normalized.provenanceInput.processorId !== undefined) {
      const volumeVerdict = await evaluateProcessorVolume(
        this.deps.config.volumePolicy,
        this.deps.usageCounter,
        normalized.provenanceInput.processorId,
        this.deps.clock.now(),
      );
      verdicts.push(volumeVerdict);
      if (!volumeVerdict.passed) return rejected(volumeVerdict.reasonCodes, verdicts);
    }

    // A write that carries an attestation verified against a pending proposal
    // for this exact mutation is an approved re-application of an
    // already-reviewed proposal (e.g. accepting a contradiction-routed
    // proposal, whose synthesized `contradicts` edges the reviewer has already
    // seen). Re-running contradiction detection on it would re-route the
    // approved write into a brand-new proposal, so it could never apply. Skip
    // detection once the attestation is confirmed: for attestation-required
    // policies step 7 already verified it; for ai-with-rails we confirm here
    // rather than trust mere presence of a caller-supplied attestation.
    const attestationApproved =
      normalized.attestation !== undefined &&
      (policyMode.requiresAttestation ? attestationVerdict.passed : await this.hasVerifiedAttestation(normalized, mutationHash));

    // Step 10: detect contradictions (only newly-created candidates can contradict).
    const contradictionsByCandidate = new Map<NodeId, NodeId[]>();
    if (!attestationApproved) {
      for (const rn of resolvedNodes) {
        if (rn.mutation.op !== 'create' || rn.resultingPayload === undefined || rn.resultingConfidence === undefined) continue;
        const check = await evaluateContradictions(
          this.deps.contradictionDetector,
          {
            namespace: normalized.namespace,
            subject: normalized.subject,
            candidateNode: {
              id: rn.mutation.nodeId,
              type: rn.effectiveType,
              namespace: normalized.namespace,
              subject: normalized.subject,
              payload: rn.resultingPayload,
              confidence: rn.resultingConfidence,
            },
          },
          (id) => this.deps.repository.getNode(normalized.namespace, id),
        );
        verdicts.push(check.verdict);
        if (check.contradictingNodeIds.length > 0) {
          contradictionsByCandidate.set(rn.mutation.nodeId, check.contradictingNodeIds);
        }
      }
    }

    if (contradictionsByCandidate.size > 0) {
      const proposal = await this.buildAndSaveProposal(normalized, effectiveCurrentRevision, contradictionsByCandidate);
      return {
        outcome: 'routed_to_proposal',
        proposalId: proposal.id,
        reasonCodes: ['CONTRADICTION_DETECTED'],
        evaluatorVerdicts: verdicts,
      };
    }

    // Step 11: compute diff/reversal and audit directive.
    const resultingRevision = effectiveCurrentRevision + 1;
    const revisionId = this.deps.idGenerator.nextRevisionId();
    const createdAt = this.deps.clock.now();

    const nodesUpserted: GovernedNode[] = [];
    const nodesDeleted: NodeId[] = [];
    const nodeDiffs: NodeLevelDiff[] = [];

    for (const rn of resolvedNodes) {
      if (rn.resultingPayload === undefined) {
        nodesDeleted.push(rn.mutation.nodeId);
        nodeDiffs.push(buildNodeDiff(rn.mutation.nodeId, rn.changeKind, rn.existing, undefined));
        continue;
      }
      const resultingNode = {
        id: rn.mutation.nodeId,
        type: rn.effectiveType,
        namespace: normalized.namespace,
        subject: normalized.subject,
        payload: rn.resultingPayload,
        confidence: rn.resultingConfidence ?? rn.existing?.confidence ?? 0,
        provenance: {
          sources: normalized.provenanceInput.sources,
          railId: namespaceEntry.policy,
          evaluatorVerdicts: verdicts,
          ...(normalized.provenanceInput.processorId !== undefined ? { processorId: normalized.provenanceInput.processorId } : {}),
          ...(normalized.provenanceInput.processorVersion !== undefined ? { processorVersion: normalized.provenanceInput.processorVersion } : {}),
          ...(normalized.provenanceInput.sourceDerived !== undefined ? { sourceDerived: normalized.provenanceInput.sourceDerived } : {}),
        },
        revision: {
          revisionId,
          namespaceRevision: resultingRevision,
          createdAt,
          actorId: normalized.actorId,
          actorClass: normalized.actorClass,
        },
      } as unknown as GovernedNode;
      nodesUpserted.push(resultingNode);
      nodeDiffs.push(buildNodeDiff(rn.mutation.nodeId, rn.changeKind, rn.existing, resultingNode));
    }

    const edgesUpserted: GovernedEdge[] = [];
    const edgesDeleted: EdgeId[] = [];
    const edgeDiffs: NodeLevelDiff[] = [];

    for (const re of resolvedEdges) {
      if (re.resultingKind === undefined) {
        edgesDeleted.push(re.mutation.edgeId);
        edgeDiffs.push(buildEdgeDiff(re.mutation.edgeId, re.changeKind, re.existing, undefined));
        continue;
      }
      const resultingEdge: GovernedEdge = {
        id: re.mutation.edgeId,
        kind: re.resultingKind as GovernedEdge['kind'],
        namespace: normalized.namespace,
        sourceId: re.resultingSourceId ?? re.existing!.sourceId,
        targetId: re.resultingTargetId ?? re.existing!.targetId,
        provenance: {
          sources: normalized.provenanceInput.sources,
          railId: namespaceEntry.policy,
          evaluatorVerdicts: verdicts,
        },
        revision: {
          revisionId,
          namespaceRevision: resultingRevision,
          createdAt,
          actorId: normalized.actorId,
          actorClass: normalized.actorClass,
        },
      };
      edgesUpserted.push(resultingEdge);
      edgeDiffs.push(buildEdgeDiff(re.mutation.edgeId, re.changeKind, re.existing, resultingEdge));
    }

    const diff = [...nodeDiffs, ...edgeDiffs];
    const processorId = normalized.provenanceInput.processorId;
    const auditDirective = policyMode.permitsDirectAiMutation
      ? computeAuditDirective(this.deps.config.auditPolicy, normalized.namespace, resultingRevision, processorId)
      : undefined;

    const revisionRecord: RevisionRecord = {
      namespace: normalized.namespace,
      revisionId,
      previousRevision: currentRevision,
      namespaceRevision: resultingRevision,
      createdAt,
      actorId: normalized.actorId,
      actorClass: normalized.actorClass,
      diff,
      idempotencyKey: normalized.idempotencyKey,
      ...(auditDirective ? { auditDirective } : {}),
    };

    // Step 12: call the repository once with a prepared write. The
    // getNamespaceRevision read in step 4 and this commit are not atomic
    // with each other -- two genuinely concurrent callers (e.g. duplicate
    // acceptance racing on the same idempotency key) can both pass the
    // step-5 idempotency/expected-revision checks before either has
    // committed, so the backend's own commit-time revision check can still
    // reject the loser. Rather than let that backend-specific error escape
    // raw, re-resolve it the same way a *sequential* retry would: if the
    // loser's own idempotency key is now recorded (the winner was in fact
    // this same request), replay it; otherwise it's a genuine conflict
    // against different content, reported the same way the early check
    // would have reported it had timing allowed.
    try {
      const preparedWrite: PreparedWrite = {
        namespace: normalized.namespace,
        previousRevision: currentRevision,
        resultingRevision,
        revisionRecord,
        nodesUpserted,
        nodesDeleted,
        edgesUpserted,
        edgesDeleted,
      };
      await (options.commit ? options.commit(preparedWrite) : this.deps.repository.commit(preparedWrite));
    } catch (err) {
      const raceWinner = await this.deps.repository.findByIdempotencyKey(normalized.namespace, normalized.idempotencyKey);
      if (raceWinner) {
        return { outcome: 'idempotent_replay', original: appliedFromRevisionRecord(raceWinner) };
      }
      const actualRevision = await this.deps.repository.getNamespaceRevision(normalized.namespace);
      if (actualRevision !== currentRevision) {
        return conflict(normalized.expectedNamespaceRevision, actualRevision ?? 0);
      }
      throw err;
    }

    if (namespaceEntry.appendOnly) {
      await this.deps.operationSink.append({
        operationId: this.deps.idGenerator.nextOperationId(),
        namespace: normalized.namespace,
        recordedAt: createdAt,
        actorId: normalized.actorId,
        payload: { revisionId, resultingRevision },
      });
    }

    if (normalized.actorClass === 'processor' && processorId !== undefined) {
      await this.deps.usageCounter.record(processorId, createdAt);
    }

    const result: AppliedWriteResult = {
      outcome: 'applied',
      previousRevision: currentRevision,
      resultingRevision,
      diff,
    };
    if (auditDirective) {
      result.auditDirective = auditDirective;
    }
    return result;
  }

  private async resolveNodeMutation(
    command: WriteCommand,
    mutation: NodeMutation,
    loadedNodes: Map<NodeId, GovernedNode>,
  ): Promise<ResolveOutcome<ResolvedNode>> {
    if (mutation.op === 'create') {
      return {
        ok: true,
        value: {
          mutation,
          changeKind: 'create',
          effectiveType: mutation.nodeType,
          existing: undefined,
          resultingPayload: mutation.payload,
          resultingConfidence: mutation.confidence,
        },
      };
    }

    const existing = loadedNodes.get(mutation.nodeId);

    if (mutation.op === 'update') {
      const resultingPayload = { ...((existing?.payload as Record<string, unknown> | undefined) ?? {}), ...(mutation.payload ?? {}) };
      const resultingConfidence = mutation.confidence ?? existing?.confidence;
      return {
        ok: true,
        value: {
          mutation,
          changeKind: 'update',
          effectiveType: existing!.type,
          existing,
          resultingPayload,
          resultingConfidence,
        },
      };
    }

    if (mutation.op === 'delete') {
      return {
        ok: true,
        value: {
          mutation,
          changeKind: 'delete',
          effectiveType: existing!.type,
          existing,
          resultingPayload: undefined,
          resultingConfidence: undefined,
        },
      };
    }

    // revert: apply the named prior revision's inverse as a new revision.
    const targetRevision = await this.deps.repository.getRevision(command.namespace, mutation.targetRevisionId);
    if (!targetRevision) {
      return { ok: false, reasonCode: 'REVERT_TARGET_REVISION_NOT_FOUND' };
    }
    const entry = targetRevision.diff.find((d) => d.entityKind === 'node' && d.entityId === mutation.nodeId);
    if (!entry) {
      return { ok: false, reasonCode: 'REVERT_TARGET_REVISION_NOT_FOUND' };
    }
    const inverted = invertDiff([entry])[0]!;

    if (inverted.changeKind === 'delete') {
      return {
        ok: true,
        value: {
          mutation,
          changeKind: 'revert',
          effectiveType: existing!.type,
          existing,
          resultingPayload: undefined,
          resultingConfidence: undefined,
        },
      };
    }

    if (inverted.changeKind === 'create') {
      const fullChange = inverted.forward.find((f) => f.path === '$');
      const node = fullChange?.after as GovernedNode | undefined;
      if (!node) {
        return { ok: false, reasonCode: 'REVERT_TARGET_REVISION_NOT_FOUND' };
      }
      return {
        ok: true,
        value: {
          mutation,
          changeKind: 'revert',
          effectiveType: node.type,
          existing,
          resultingPayload: node.payload as unknown as Record<string, unknown>,
          resultingConfidence: node.confidence,
        },
      };
    }

    const basePayload: Record<string, unknown> = { ...((existing?.payload as Record<string, unknown> | undefined) ?? {}) };
    let confidence = existing?.confidence;
    for (const change of inverted.forward) {
      if (change.path === 'confidence') {
        confidence = change.after as number;
      } else if (change.path.startsWith('payload.')) {
        basePayload[change.path.slice('payload.'.length)] = change.after;
      }
    }
    return {
      ok: true,
      value: {
        mutation,
        changeKind: 'revert',
        effectiveType: existing!.type,
        existing,
        resultingPayload: basePayload,
        resultingConfidence: confidence,
      },
    };
  }

  private async resolveEdgeMutation(
    command: WriteCommand,
    mutation: EdgeMutation,
    loadedEdges: Map<EdgeId, GovernedEdge>,
  ): Promise<ResolveOutcome<ResolvedEdge>> {
    if (mutation.op === 'create') {
      return {
        ok: true,
        value: {
          mutation,
          changeKind: 'create',
          existing: undefined,
          resultingKind: mutation.kind,
          resultingSourceId: mutation.sourceId,
          resultingTargetId: mutation.targetId,
        },
      };
    }

    const existing = loadedEdges.get(mutation.edgeId);

    if (mutation.op === 'update') {
      return {
        ok: true,
        value: {
          mutation,
          changeKind: 'update',
          existing,
          resultingKind: mutation.kind,
          resultingSourceId: existing?.sourceId,
          resultingTargetId: existing?.targetId,
        },
      };
    }

    if (mutation.op === 'delete') {
      return {
        ok: true,
        value: {
          mutation,
          changeKind: 'delete',
          existing,
          resultingKind: undefined,
          resultingSourceId: undefined,
          resultingTargetId: undefined,
        },
      };
    }

    const targetRevision = await this.deps.repository.getRevision(command.namespace, mutation.targetRevisionId);
    if (!targetRevision) {
      return { ok: false, reasonCode: 'REVERT_TARGET_REVISION_NOT_FOUND' };
    }
    const entry = targetRevision.diff.find((d) => d.entityKind === 'edge' && d.entityId === mutation.edgeId);
    if (!entry) {
      return { ok: false, reasonCode: 'REVERT_TARGET_REVISION_NOT_FOUND' };
    }
    const inverted = invertDiff([entry])[0]!;

    if (inverted.changeKind === 'delete') {
      return {
        ok: true,
        value: { mutation, changeKind: 'revert', existing, resultingKind: undefined, resultingSourceId: undefined, resultingTargetId: undefined },
      };
    }
    if (inverted.changeKind === 'create') {
      const fullChange = inverted.forward.find((f) => f.path === '$');
      const edge = fullChange?.after as GovernedEdge | undefined;
      if (!edge) {
        return { ok: false, reasonCode: 'REVERT_TARGET_REVISION_NOT_FOUND' };
      }
      return {
        ok: true,
        value: { mutation, changeKind: 'revert', existing, resultingKind: edge.kind, resultingSourceId: edge.sourceId, resultingTargetId: edge.targetId },
      };
    }

    const kindChange = inverted.forward.find((f) => f.path === 'kind');
    const resultingKind = (kindChange?.after as string | undefined) ?? existing?.kind;
    return {
      ok: true,
      value: { mutation, changeKind: 'revert', existing, resultingKind, resultingSourceId: existing?.sourceId, resultingTargetId: existing?.targetId },
    };
  }

  /**
   * True when the command carries an attestation that the verifier confirms
   * against a pending proposal for this exact mutation. Used to recognize an
   * approved re-application of an already-reviewed proposal so contradiction
   * detection is not re-run against it. Never trusts a caller-supplied
   * attestation id on its own -- it must resolve to a pending proposal and
   * verify against the port.
   */
  private async hasVerifiedAttestation(command: WriteCommand, mutationHash: MutationHash): Promise<boolean> {
    if (!command.attestation) return false;
    const pending = await this.deps.proposalRepository.findPendingByMutationHash(command.namespace, mutationHash);
    if (!pending) return false;
    const attestation = await this.deps.attestationVerifier.verify({
      attestationId: command.attestation.attestationId,
      expectedProposalId: pending.id,
      expectedProposalVersion: pending.version,
      expectedMutationHash: mutationHash,
    });
    return attestation !== undefined && attestation !== null;
  }

  private async buildAndSaveProposal(
    command: WriteCommand,
    expectedTargetRevision: number,
    contradictionsByCandidate: Map<NodeId, NodeId[]>,
  ): Promise<Proposal> {
    const supportingObservationIds = command.nodeMutations
      .filter((m): m is Extract<NodeMutation, { op: 'create' }> => m.op === 'create' && m.nodeType === 'observation')
      .map((m) => m.nodeId);

    const contradictsEdgeMutations: EdgeMutation[] = [];
    for (const [candidateId, contradictingIds] of contradictionsByCandidate) {
      for (const contradictingId of contradictingIds) {
        contradictsEdgeMutations.push({
          op: 'create',
          edgeId: this.deps.idGenerator.nextEdgeId(),
          kind: 'contradicts',
          sourceId: candidateId,
          targetId: contradictingId,
        });
      }
    }

    // The synthesized `contradicts` edges are part of the canonical mutation
    // the reviewer accepts, so the proposal's mutationHash must cover them.
    // Re-normalizing here yields the exact form (and hash) the orchestrator
    // recomputes when the proposal is later accepted and re-written --
    // otherwise attestation lookup by mutationHash misses and the proposal
    // can never be accepted.
    const { command: canonicalMutation, mutationHash } = normalizeWriteCommand({
      ...command,
      edgeMutations: [...command.edgeMutations, ...contradictsEdgeMutations],
    });

    const proposal: Proposal = {
      id: this.deps.idGenerator.nextProposalId(),
      canonicalMutation,
      mutationHash,
      targetNamespace: command.namespace,
      targetSubject: command.subject,
      expectedTargetRevision,
      supportingObservationIds,
      provenance: {
        sources: command.provenanceInput.sources,
        railId: 'contradiction-routing',
        evaluatorVerdicts: [],
      },
      version: 1,
      status: 'pending',
      events: [
        {
          eventId: this.deps.idGenerator.nextEventId(),
          kind: 'contradiction_routed',
          at: this.deps.clock.now(),
        },
      ],
    };

    await this.deps.proposalRepository.save(proposal);
    return proposal;
  }
}
