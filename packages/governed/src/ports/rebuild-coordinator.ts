import type { NamespaceId } from '../domain/ids.js';

export interface RebuildCheckpoint {
  namespace: NamespaceId;
  sinceRevision: number;
}

export interface RebuildResult {
  namespace: NamespaceId;
  finalRevision: number;
  digest: string;
  matchesLiveProjection: boolean;
}

/**
 * Enumerates immutable governed revisions from a checkpoint, applies them
 * deterministically, emits a content digest, and compares it with the live
 * ReadModel projection.
 */
export interface RebuildCoordinator {
  rebuild(checkpoint: RebuildCheckpoint): Promise<RebuildResult>;
}
