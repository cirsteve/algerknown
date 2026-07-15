import { classifyWriteTarget, findRoot, resolveEntryPath } from '@algerknown/core';

export interface GovernedTargetCheck {
  governed: boolean;
  namespace?: string;
}

/**
 * The same structural check the web routes run before mutating a legacy
 * entry, applied here so CLI add/edit/delete/link commands never bypass the
 * governed boundary by never routing through the web server at all.
 */
export function checkGovernedTarget(entryId: string, root?: string): GovernedTargetCheck {
  const kbRoot = root ?? findRoot();
  const existingPath = resolveEntryPath(entryId, kbRoot);
  if (!existingPath) return { governed: false };
  const result = classifyWriteTarget(kbRoot, existingPath);
  return { governed: result.classification === 'governed', namespace: result.namespace };
}
