import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  ProposalAttestationError,
  ProposalIdempotencyMismatchError,
  ProposalInvalidTransitionError,
  ProposalNotFoundError,
  ProposalValidationError,
  ProposalVersionConflictError,
  asActorId,
  asEdgeId,
  asIdempotencyKey,
  asNamespaceId,
  asNodeId,
  asProcessorId,
  asProposalId,
  asSubjectId,
  type DurableProposalStatus,
  type WriteCommand,
} from '@algerknown/governed';
import type { GovernanceRuntime } from '../auth/governance-runtime.js';
import { requireReviewerAuth } from '../auth/reviewer-auth.js';
import { requireProcessorAuth } from '../auth/processor-auth.js';
import { rejectClientSuppliedIdentityFields } from '../auth/reject-identity-fields.js';
import type { GovernanceComposition } from '../governance/compose.js';
import { buildCandidateProposeInput, CandidateMappingError } from '../governance/candidate-mapping.js';
import { acceptProposal, amendProposal, deleteProposal, expireProposal, rejectProposal, revertProposal, ActiveGitOperationError } from '../governance/review-actions.js';
import { listProposalQueue, getReversal, InvalidCursorError } from '../governance/proposal-queue.js';
import { applyJsonPatch, isJsonPatchOpArray, JsonPatchError } from '../governance/json-patch.js';
import {
  assertOnlyKeys,
  assertPlainObject,
  optionalArray,
  optionalString,
  optionalStringArray,
  requireNullableNumber,
  requireNumber,
  requireString,
  RequestValidationError,
} from '../governance/request-validation.js';

function sendError(res: Response, status: number, code: string, extra?: Record<string, unknown>): void {
  res.status(status).json({ error: code, ...extra });
}

function withValidation(res: Response, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (err instanceof RequestValidationError) {
      sendError(res, 400, 'invalid_request', { message: err.message });
      return;
    }
    throw err;
  }
}

async function handleReviewActionError(res: Response, err: unknown): Promise<void> {
  if (err instanceof ProposalNotFoundError) {
    sendError(res, 404, 'not_found');
    return;
  }
  if (err instanceof ActiveGitOperationError) {
    sendError(res, 409, 'operation_in_progress');
    return;
  }
  if (err instanceof ProposalVersionConflictError || err instanceof ProposalInvalidTransitionError) {
    sendError(res, 409, 'conflict', { message: err.message });
    return;
  }
  if (err instanceof ProposalIdempotencyMismatchError) {
    sendError(res, 409, 'idempotency_key_reused', { message: err.message });
    return;
  }
  if (err instanceof ProposalValidationError || err instanceof ProposalAttestationError) {
    sendError(res, 422, 'rejected', { message: err.message });
    return;
  }
  throw err;
}

const REVIEW_ACTION_BODY_FIELDS = ['expectedVersion', 'expectedTargetRevision', 'reviewNote', 'reviewBatchId', 'idempotencyKey'] as const;

export function createGovernanceRouter(runtime: GovernanceRuntime, composition: GovernanceComposition): Router {
  const { config } = runtime;
  if (!config.enabled) {
    throw new Error('createGovernanceRouter requires an enabled GovernanceConfig');
  }

  const router = Router();
  const reviewerAuth = requireReviewerAuth(config, runtime.sessionRegistry);
  const processorAuth = requireProcessorAuth(config);
  const { proposalService, reviewActionsDeps, repository } = composition;
  const db = reviewActionsDeps.db;

  // ---------------------------------------------------------------------
  // Processor ingest: durable persistence only, never review authority.
  // ---------------------------------------------------------------------
  router.post('/processor/proposals', processorAuth, rejectClientSuppliedIdentityFields, (req: Request, res: Response, next: NextFunction) => {
    let parsed:
      | {
          sourceEntryId: string;
          targetSummaryId: string;
          confidence: number;
          processorVersion: string;
          idempotencyKey: string;
          newLearnings?: { insight: string; context?: string; relevance?: string[] }[];
          newDecisions?: { decision: string; rationale?: string; date?: string }[];
          newOpenQuestions?: string[];
          newLinks?: { id: string; relationship: string; notes?: string }[];
        }
      | undefined;

    withValidation(res, () => {
      const body = assertPlainObject(req.body);
      assertOnlyKeys(body, [
        'sourceEntryId',
        'targetSummaryId',
        'confidence',
        'processorVersion',
        'newLearnings',
        'newDecisions',
        'newOpenQuestions',
        'newLinks',
        'idempotencyKey',
      ]);
      parsed = {
        sourceEntryId: requireString(body, 'sourceEntryId'),
        targetSummaryId: requireString(body, 'targetSummaryId'),
        confidence: requireNumber(body, 'confidence'),
        processorVersion: requireString(body, 'processorVersion'),
        idempotencyKey: requireString(body, 'idempotencyKey'),
        newLearnings: optionalArray(body, 'newLearnings', (item) => {
          const learning = assertPlainObject(item);
          assertOnlyKeys(learning, ['insight', 'context', 'relevance']);
          return { insight: requireString(learning, 'insight'), context: optionalString(learning, 'context'), relevance: optionalStringArray(learning, 'relevance') };
        }),
        newDecisions: optionalArray(body, 'newDecisions', (item) => {
          const decision = assertPlainObject(item);
          assertOnlyKeys(decision, ['decision', 'rationale', 'date']);
          return { decision: requireString(decision, 'decision'), rationale: optionalString(decision, 'rationale'), date: optionalString(decision, 'date') };
        }),
        newOpenQuestions: optionalStringArray(body, 'newOpenQuestions'),
        newLinks: optionalArray(body, 'newLinks', (item) => {
          const link = assertPlainObject(item);
          assertOnlyKeys(link, ['id', 'relationship', 'notes']);
          return { id: requireString(link, 'id'), relationship: requireString(link, 'relationship'), notes: optionalString(link, 'notes') };
        }),
      };
    });
    if (res.headersSent || !parsed) return;

    void (async () => {
      try {
        const proposeInput = await buildCandidateProposeInput(
          {
            algerknownRoot: composition.config.algerknownRoot,
            idGenerator: reviewActionsDeps.idGenerator,
            repository,
            processorId: composition.config.processorId,
            processorVersion: parsed!.processorVersion,
          },
          parsed!,
          parsed!.idempotencyKey,
        );
        const outcome = await proposalService.propose(proposeInput);
        if (outcome.outcome === 'created') {
          res.status(201).json({ proposalId: outcome.proposal.id, status: 'created' });
        } else {
          res.status(200).json({ proposalId: outcome.priorProposalId, status: 'suppressed', reason: outcome.reason ?? null });
        }
      } catch (err) {
        if (err instanceof CandidateMappingError) {
          sendError(res, 404, err.code);
          return;
        }
        next(err);
      }
    })();
  });

  // Generic append-only operation.<trace> event: a processor telemetry
  // record (e.g. "this entry was ingested") that carries no application
  // schema of its own -- unlike /processor/proposals, this never becomes
  // reviewable content, only an attributable, idempotent, ordered entry in
  // the operation sink (see WriteOrchestrator's automatic operationSink
  // append for any appendOnly namespace). Used so ingest completion is
  // recorded as governed telemetry instead of an ungoverned YAML edit.
  router.post('/processor/operations', processorAuth, rejectClientSuppliedIdentityFields, (req: Request, res: Response, next: NextFunction) => {
    let parsed: { subject: string; description: string; idempotencyKey: string } | undefined;

    withValidation(res, () => {
      const body = assertPlainObject(req.body);
      assertOnlyKeys(body, ['subject', 'description', 'idempotencyKey']);
      parsed = {
        subject: requireString(body, 'subject'),
        description: requireString(body, 'description'),
        idempotencyKey: requireString(body, 'idempotencyKey'),
      };
    });
    if (res.headersSent || !parsed) return;

    void (async () => {
      try {
        const command: WriteCommand = {
          namespace: asNamespaceId('operation.ingest'),
          subject: asSubjectId(parsed!.subject),
          nodeMutations: [
            {
              op: 'create',
              nodeId: reviewActionsDeps.idGenerator.nextNodeId(),
              nodeType: 'observation',
              payload: { description: parsed!.description, context: { subject: parsed!.subject } },
              confidence: 1,
            },
          ],
          edgeMutations: [],
          expectedNamespaceRevision: null,
          idempotencyKey: asIdempotencyKey(parsed!.idempotencyKey),
          actorId: asActorId(composition.config.processorId),
          actorClass: 'processor',
          provenanceInput: { sources: [{ kind: 'external', id: parsed!.subject }], processorId: asProcessorId(composition.config.processorId) },
        };
        const result = await composition.orchestrator.write(command);
        if (result.outcome === 'applied') {
          res.status(201).json({ status: 'recorded', resultingRevision: result.resultingRevision });
        } else if (result.outcome === 'idempotent_replay' && result.original.outcome === 'applied') {
          res.status(200).json({ status: 'recorded', resultingRevision: result.original.resultingRevision });
        } else {
          const reasonCodes = result.outcome === 'rejected' || result.outcome === 'routed_to_proposal' ? result.reasonCodes : [];
          sendError(res, 422, 'rejected', { reasonCodes });
        }
      } catch (err) {
        next(err);
      }
    })();
  });

  // ---------------------------------------------------------------------
  // Reviewer queue/detail/history
  // ---------------------------------------------------------------------
  router.get('/proposals', reviewerAuth, (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const limitRaw = req.query.limit;
        const limit = Math.min(Math.max(Number(limitRaw ?? 50) || 50, 1), 200);
        const status = typeof req.query.status === 'string' ? (req.query.status as DurableProposalStatus) : undefined;
        const namespace = typeof req.query.namespace === 'string' ? req.query.namespace : undefined;
        const subject = typeof req.query.subject === 'string' ? req.query.subject : undefined;
        const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
        const page = listProposalQueue(db, { status, namespace, subject, cursor, limit });
        res.status(200).json(page);
      } catch (err) {
        if (err instanceof InvalidCursorError) {
          sendError(res, 400, 'invalid_request', { message: err.message });
          return;
        }
        next(err);
      }
    })();
  });

  router.get('/proposals/:id', reviewerAuth, (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const proposalId = asProposalId(req.params.id!);
        const inspection = await proposalService.inspect(proposalId);
        const currentRevision = await repository.getNamespaceRevision(inspection.proposal.targetNamespace);
        const reversal = getReversal(db, String(proposalId));
        res.status(200).json({
          id: inspection.proposal.id,
          status: inspection.proposal.status,
          version: inspection.proposal.version,
          targetNamespace: inspection.proposal.targetNamespace,
          targetSubject: inspection.proposal.targetSubject,
          currentTargetRevision: currentRevision,
          expectedTargetRevision: inspection.proposal.expectedTargetRevision,
          canonicalMutation: inspection.currentVersion.canonicalMutation,
          mutationHash: inspection.proposal.mutationHash,
          fingerprint: inspection.proposal.fingerprint,
          supportingObservationIds: inspection.currentVersion.supportingObservationIds,
          provenance: inspection.currentVersion.provenance,
          conflict: {
            stale: inspection.proposal.expectedTargetRevision !== null && inspection.proposal.expectedTargetRevision !== currentRevision,
          },
          resultingRevision: inspection.proposal.resultingRevision,
          reverted: inspection.proposal.reverted,
          reversal: reversal ?? null,
          events: inspection.events,
          createdAt: inspection.proposal.createdAt,
          updatedAt: inspection.proposal.updatedAt,
        });
      } catch (err) {
        if (err instanceof ProposalNotFoundError) {
          sendError(res, 404, 'not_found');
          return;
        }
        next(err);
      }
    })();
  });

  router.get('/proposals/:id/history', reviewerAuth, (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const proposalId = asProposalId(req.params.id!);
        const inspection = await proposalService.inspect(proposalId);
        res.status(200).json({ events: inspection.events });
      } catch (err) {
        if (err instanceof ProposalNotFoundError) {
          sendError(res, 404, 'not_found');
          return;
        }
        next(err);
      }
    })();
  });

  router.get('/nodes/:id/history', reviewerAuth, (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const namespaceParam = req.query.namespace;
        if (typeof namespaceParam !== 'string' || namespaceParam.length === 0) {
          sendError(res, 400, 'invalid_request', { message: '"namespace" query parameter is required' });
          return;
        }
        const namespace = asNamespaceId(namespaceParam);
        const nodeId = asNodeId(req.params.id!);
        const edgeId = asEdgeId(req.params.id!);
        const revisions = await repository.listRevisionsSince(namespace, 0);
        const matching = revisions.filter((rev) => rev.diff.some((d) => String(d.entityId) === String(nodeId) || String(d.entityId) === String(edgeId)));
        res.status(200).json({ revisions: matching });
      } catch (err) {
        next(err);
      }
    })();
  });

  // ---------------------------------------------------------------------
  // Review actions
  // ---------------------------------------------------------------------
  router.post('/proposals/:id/amend', reviewerAuth, rejectClientSuppliedIdentityFields, (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const proposalId = asProposalId(req.params.id!);
        withValidation(res, () => {
          const body = assertPlainObject(req.body);
          assertOnlyKeys(body, ['expectedVersion', 'expectedTargetRevision', 'patch', 'note', 'idempotencyKey']);
          requireNumber(body, 'expectedVersion');
          requireNullableNumber(body, 'expectedTargetRevision');
          requireString(body, 'note');
          requireString(body, 'idempotencyKey');
          if (!(body.note as string).trim()) throw new RequestValidationError('"note" must be non-empty');
          if (!isJsonPatchOpArray(body.patch)) throw new RequestValidationError('"patch" must be an array of RFC 6902 operations');
        });
        if (res.headersSent) return;

        const body = req.body as {
          expectedVersion: number;
          expectedTargetRevision: number | null;
          patch: unknown;
          note: string;
          idempotencyKey: string;
        };
        const inspection = await proposalService.inspect(proposalId, body.expectedVersion).catch(() => proposalService.inspect(proposalId));
        const currentTargetRevision = await repository.getNamespaceRevision(inspection.proposal.targetNamespace);
        if (body.expectedTargetRevision !== currentTargetRevision) {
          sendError(res, 409, 'target_revision_conflict', {
            expectedRevision: body.expectedTargetRevision,
            actualRevision: currentTargetRevision,
          });
          return;
        }
        const current = inspection.currentVersion.canonicalMutation as WriteCommand;
        const editableView = { nodeMutations: current.nodeMutations, edgeMutations: current.edgeMutations };
        let patched: typeof editableView;
        try {
          patched = applyJsonPatch(editableView, body.patch as never);
        } catch (err) {
          if (err instanceof JsonPatchError) {
            sendError(res, 422, 'invalid_patch', { message: err.message });
            return;
          }
          throw err;
        }

        const mutation: WriteCommand = {
          ...current,
          nodeMutations: patched.nodeMutations,
          edgeMutations: patched.edgeMutations,
          expectedNamespaceRevision: body.expectedTargetRevision,
        };
        const updated = await amendProposal(reviewActionsDeps, proposalId, {
          reviewContext: res.locals.reviewContext!,
          input: {
            expectedVersion: body.expectedVersion,
            mutation,
            supportingObservationIds: inspection.currentVersion.supportingObservationIds,
            actorId: res.locals.reviewContext!.reviewerId,
            channel: res.locals.reviewContext!.channel,
            note: body.note.trim(),
            idempotencyKey: body.idempotencyKey,
          },
        });
        res.status(200).json({ id: updated.id, version: updated.version, status: updated.status });
      } catch (err) {
        await handleReviewActionError(res, err);
      }
    })().catch(next);
  });

  router.post('/proposals/:id/accept', reviewerAuth, rejectClientSuppliedIdentityFields, (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const proposalId = asProposalId(req.params.id!);
        withValidation(res, () => {
          const body = assertPlainObject(req.body);
          assertOnlyKeys(body, [...REVIEW_ACTION_BODY_FIELDS]);
          requireNumber(body, 'expectedVersion');
          requireNullableNumber(body, 'expectedTargetRevision');
          requireString(body, 'idempotencyKey');
          optionalString(body, 'reviewNote');
          optionalString(body, 'reviewBatchId');
        });
        if (res.headersSent) return;

        const body = req.body as {
          expectedVersion: number;
          expectedTargetRevision: number | null;
          reviewNote?: string;
          reviewBatchId?: string;
          idempotencyKey: string;
        };
        const outcome = await acceptProposal(reviewActionsDeps, proposalId, { reviewContext: res.locals.reviewContext!, ...body });
        if (outcome.outcome === 'accepted') {
          res.status(200).json({ status: 'accepted', resultingRevision: outcome.resultingRevision });
        } else if (outcome.outcome === 'version_conflict') {
          sendError(res, 409, 'version_conflict', { expectedVersion: outcome.expectedVersion, actualVersion: outcome.actualVersion });
        } else {
          sendError(res, 409, 'target_revision_conflict', { expectedRevision: outcome.expectedRevision, actualRevision: outcome.actualRevision });
        }
      } catch (err) {
        await handleReviewActionError(res, err);
      }
    })().catch(next);
  });

  router.post('/proposals/:id/reject', reviewerAuth, rejectClientSuppliedIdentityFields, (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const proposalId = asProposalId(req.params.id!);
        withValidation(res, () => {
          const body = assertPlainObject(req.body);
          assertOnlyKeys(body, ['expectedVersion', 'reason', 'idempotencyKey']);
          requireNumber(body, 'expectedVersion');
          requireString(body, 'reason');
          requireString(body, 'idempotencyKey');
        });
        if (res.headersSent) return;
        const body = req.body as { expectedVersion: number; reason: string; idempotencyKey: string };
        const updated = await rejectProposal(reviewActionsDeps, proposalId, {
          expectedVersion: body.expectedVersion,
          actorId: res.locals.reviewContext!.reviewerId,
          reason: body.reason,
          idempotencyKey: body.idempotencyKey,
        });
        res.status(200).json({ id: updated.id, version: updated.version, status: updated.status });
      } catch (err) {
        await handleReviewActionError(res, err);
      }
    })().catch(next);
  });

  router.post('/proposals/:id/expire', reviewerAuth, rejectClientSuppliedIdentityFields, (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const proposalId = asProposalId(req.params.id!);
        withValidation(res, () => {
          const body = assertPlainObject(req.body);
          assertOnlyKeys(body, ['expectedVersion', 'note', 'idempotencyKey']);
          requireNumber(body, 'expectedVersion');
          requireString(body, 'note');
          requireString(body, 'idempotencyKey');
        });
        if (res.headersSent) return;
        const body = req.body as { expectedVersion: number; note: string; idempotencyKey: string };
        const updated = await expireProposal(reviewActionsDeps, proposalId, {
          expectedVersion: body.expectedVersion,
          note: body.note,
          actorId: res.locals.reviewContext!.reviewerId,
          idempotencyKey: body.idempotencyKey,
        });
        res.status(200).json({ id: updated.id, version: updated.version, status: updated.status });
      } catch (err) {
        await handleReviewActionError(res, err);
      }
    })().catch(next);
  });

  router.post('/proposals/:id/delete', reviewerAuth, rejectClientSuppliedIdentityFields, (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const proposalId = asProposalId(req.params.id!);
        withValidation(res, () => {
          const body = assertPlainObject(req.body);
          assertOnlyKeys(body, ['expectedVersion', 'reason', 'idempotencyKey']);
          requireNumber(body, 'expectedVersion');
          requireString(body, 'reason');
          requireString(body, 'idempotencyKey');
        });
        if (res.headersSent) return;
        const body = req.body as { expectedVersion: number; reason: string; idempotencyKey: string };
        const updated = await deleteProposal(reviewActionsDeps, proposalId, {
          expectedVersion: body.expectedVersion,
          actorId: res.locals.reviewContext!.reviewerId,
          reason: body.reason,
          idempotencyKey: body.idempotencyKey,
        });
        res.status(200).json({ id: updated.id, version: updated.version, status: updated.status });
      } catch (err) {
        await handleReviewActionError(res, err);
      }
    })().catch(next);
  });

  router.post('/proposals/:id/revert', reviewerAuth, rejectClientSuppliedIdentityFields, (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const proposalId = asProposalId(req.params.id!);
        withValidation(res, () => {
          const body = assertPlainObject(req.body);
          assertOnlyKeys(body, ['reason', 'idempotencyKey']);
          requireString(body, 'reason');
          requireString(body, 'idempotencyKey');
        });
        if (res.headersSent) return;
        const body = req.body as { reason: string; idempotencyKey: string };
        const outcome = await revertProposal(reviewActionsDeps, proposalId, { reviewContext: res.locals.reviewContext!, ...body });
        if (outcome.outcome === 'reverted') {
          res.status(200).json({ status: 'reverted', newRevision: outcome.newRevision });
        } else {
          sendError(res, 409, 'target_revision_conflict', { expectedRevision: outcome.expectedRevision, actualRevision: outcome.actualRevision });
        }
      } catch (err) {
        await handleReviewActionError(res, err);
      }
    })().catch(next);
  });

  return router;
}
