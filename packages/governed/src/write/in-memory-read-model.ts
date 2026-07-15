import type { NamespaceId } from '../domain/ids.js';
import type { ReadModel } from '../ports/read-model.js';
import type { RevisionRecord } from '../ports/repository.js';
import { applyDiffEntry, createEmptyReplayState, digestReplayState, type ReplayState } from './replay.js';

/**
 * Reference in-memory projection: the core cohort's stand-in for whatever
 * live, queryable projection a real backend maintains. Callers feed it
 * committed revisions as they land; RebuildCoordinator compares its own
 * replayed digest against this projection's digest.
 */
export class InMemoryReadModel implements ReadModel {
  private readonly states = new Map<NamespaceId, ReplayState>();

  ingestRevision(record: RevisionRecord): void {
    let state = this.states.get(record.namespace);
    if (!state) {
      state = createEmptyReplayState();
      this.states.set(record.namespace, state);
    }
    for (const entry of record.diff) {
      applyDiffEntry(state, entry);
    }
  }

  async digest(namespace: NamespaceId): Promise<string> {
    return digestReplayState(this.states.get(namespace) ?? createEmptyReplayState());
  }
}
