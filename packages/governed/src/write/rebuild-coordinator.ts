import type { Repository } from '../ports/repository.js';
import type { ReadModel } from '../ports/read-model.js';
import type { RebuildCheckpoint, RebuildCoordinator, RebuildResult } from '../ports/rebuild-coordinator.js';
import { applyDiffEntry, createEmptyReplayState, digestReplayState } from './replay.js';

/**
 * Reference RebuildCoordinator: enumerates immutable revisions and replays
 * their diffs deterministically into a scratch projection, then compares its
 * content digest against the live ReadModel.
 *
 * This in-memory reference has no snapshot/checkpoint state to seed from, so
 * it always replays the full history from revision 0 regardless of
 * `checkpoint.sinceRevision` -- a partial replay's digest can never be
 * validly compared against the live projection's full-history digest. A
 * persistent-backend coordinator in a later cohort can seed from a stored
 * snapshot as of the checkpoint instead.
 */
export class InMemoryRebuildCoordinator implements RebuildCoordinator {
  constructor(
    private readonly repository: Repository,
    private readonly readModel: ReadModel,
  ) {}

  async rebuild(checkpoint: RebuildCheckpoint): Promise<RebuildResult> {
    const revisions = await this.repository.listRevisionsSince(checkpoint.namespace, 0);
    const state = createEmptyReplayState();
    let finalRevision = checkpoint.sinceRevision;

    for (const record of revisions) {
      for (const entry of record.diff) {
        applyDiffEntry(state, entry);
      }
      finalRevision = record.namespaceRevision;
    }

    const digest = digestReplayState(state);
    const liveDigest = await this.readModel.digest(checkpoint.namespace);

    return {
      namespace: checkpoint.namespace,
      finalRevision,
      digest,
      matchesLiveProjection: digest === liveDigest,
    };
  }
}
