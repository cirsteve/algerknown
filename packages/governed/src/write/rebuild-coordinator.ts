import type { Repository } from '../ports/repository.js';
import type { ReadModel } from '../ports/read-model.js';
import type { RebuildCheckpoint, RebuildCoordinator, RebuildResult } from '../ports/rebuild-coordinator.js';
import { applyDiffEntry, createEmptyReplayState, digestReplayState } from './replay.js';

/**
 * Reference RebuildCoordinator: enumerates immutable revisions since the
 * checkpoint, replays their diffs deterministically into a scratch
 * projection, and compares its content digest against the live ReadModel.
 */
export class InMemoryRebuildCoordinator implements RebuildCoordinator {
  constructor(
    private readonly repository: Repository,
    private readonly readModel: ReadModel,
  ) {}

  async rebuild(checkpoint: RebuildCheckpoint): Promise<RebuildResult> {
    const revisions = await this.repository.listRevisionsSince(checkpoint.namespace, checkpoint.sinceRevision);
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
