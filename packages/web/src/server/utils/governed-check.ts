import type { Response } from 'express';
import * as core from '@algerknown/core';

/**
 * Legacy entry/link routes may still mutate only legacy_ungoverned targets
 * (Phase 2 has not migrated every historical Algerknown artifact). If the
 * resolved target is already governed, respond 409 with a stable code and a
 * link to the review path instead of calling into @algerknown/core's mutator
 * -- core itself also rejects the write as a structural backstop, but this
 * proactive check gives callers a useful, on-brand error instead of a bare
 * 500 from an uncaught GovernedWriteBoundaryError.
 *
 * Returns true (and has already written the response) if the target is
 * governed; false if the caller should proceed with the legacy mutation.
 */
export function respondIfGoverned(zkbPath: string, entryId: string, res: Response): boolean {
  const existingPath = core.resolveEntryPath(entryId, zkbPath);
  if (!existingPath) return false;

  const result = core.classifyWriteTarget(zkbPath, existingPath);
  if (result.classification !== 'governed') return false;

  const namespace = result.namespace ?? '';
  res.status(409).json({
    error: 'governed_write_required',
    namespace,
    reviewPath: `/api/governance/proposals?namespace=${encodeURIComponent(namespace)}`,
  });
  return true;
}
