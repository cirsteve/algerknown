import type { AcceptInput, Clock, DatabaseType, DurableProposalService, RevertInput } from '@algerknown/governed';
import { asProposalId } from '@algerknown/governed';
import { blockIntent, completeIntent, listIncompleteIntents } from './git-operation-intents.js';

export interface RecoverIncompleteGitOperationsDeps {
  db: DatabaseType;
  proposalService: DurableProposalService;
  clock: Clock;
  log?: (message: string) => void;
}

/**
 * Resolves every git-target accept/revert operation whose intent was
 * recorded but never reached its completed/blocked finalize step -- i.e. the
 * process crashed somewhere between recording the intent and marking it
 * done. Both branches described in the brief collapse into one safe replay
 * here: DurableProposalService.accept/revert are themselves idempotent (the
 * underlying orchestrator write short-circuits via Repository.findByIdempotencyKey,
 * and the service's own idempotency_records short-circuit the SQLite
 * finalize), so replaying the exact stored input is safe whether or not the
 * git commit already landed -- it can never produce a second mutation.
 * The one case this refuses to replay is a proposal whose current mutation
 * hash no longer matches what was recorded when the intent was created,
 * which would mean the proposal changed after the operation started; that is
 * marked blocked for operator inspection instead of being reapplied.
 */
export async function recoverIncompleteGitOperations(deps: RecoverIncompleteGitOperationsDeps): Promise<void> {
  const { db, proposalService, clock } = deps;
  const log = deps.log ?? (() => {});
  const incomplete = listIncompleteIntents(db);

  for (const intent of incomplete) {
    const proposalId = asProposalId(intent.proposalId);
    const proposal = await proposalService.getProposal(proposalId);

    if (!proposal) {
      blockIntent(db, intent.operationId, 'proposal no longer exists', clock.now());
      log(`governance recovery: blocked orphaned operation intent ${intent.operationId} (proposal ${proposalId} missing)`);
      continue;
    }

    if (proposal.status !== 'pending') {
      // The write and the SQLite finalize both already happened; only our
      // own intent-completion update was left dangling.
      completeIntent(db, intent.operationId, proposal.resultingRevision, clock.now());
      log(`governance recovery: intent ${intent.operationId} already finalized (proposal ${proposalId} status=${proposal.status})`);
      continue;
    }

    const inspection = await proposalService.inspect(proposalId);
    if (inspection.currentVersion.mutationHash !== intent.expectedMutationHash) {
      blockIntent(db, intent.operationId, 'proposal mutation hash changed since operation intent was recorded', clock.now());
      log(`governance recovery: blocked intent ${intent.operationId} on proposal ${proposalId} (mutation hash mismatch)`);
      continue;
    }

    try {
      if (intent.action === 'accept') {
        const input = JSON.parse(intent.reviewInputJson) as AcceptInput;
        const outcome = await proposalService.accept(proposalId, input);
        if (outcome.outcome === 'accepted') {
          completeIntent(db, intent.operationId, outcome.resultingRevision, clock.now());
          log(`governance recovery: replayed accept for proposal ${proposalId} (revision ${outcome.resultingRevision})`);
        } else {
          blockIntent(db, intent.operationId, `recovery replay of accept returned "${outcome.outcome}"`, clock.now());
        }
      } else {
        const input = JSON.parse(intent.reviewInputJson) as RevertInput;
        const outcome = await proposalService.revert(proposalId, input);
        if (outcome.outcome === 'reverted') {
          completeIntent(db, intent.operationId, outcome.newRevision, clock.now());
          log(`governance recovery: replayed revert for proposal ${proposalId} (revision ${outcome.newRevision})`);
        } else {
          blockIntent(db, intent.operationId, `recovery replay of revert returned "${outcome.outcome}"`, clock.now());
        }
      }
    } catch (err) {
      blockIntent(db, intent.operationId, `recovery replay threw: ${(err as Error).message}`, clock.now());
      log(`governance recovery: blocked intent ${intent.operationId} on proposal ${proposalId} (${(err as Error).message})`);
    }
  }
}
