/**
 * Both governed subject conventions the Algerknown adapters use --
 * `algerknown.summary:<id>:dossier` (git-backed canonical.*, see
 * subjectForBinding in packages/governed/src/adapters/algerknown/config.ts)
 * and `algerknown.summary:<id>:memory` (candidate-mapping.ts) -- carry the
 * same Algerknown Summary id in the same position, so EntryDetail links can
 * be built from it without a dedicated lookup endpoint.
 */
const SUBJECT_PATTERN = /^algerknown\.summary:(.+):(memory|dossier)$/;

export function entryIdFromSubject(subject: string): string | undefined {
  return SUBJECT_PATTERN.exec(subject)?.[1];
}

export function nodeHistoryHref(entryId: string | undefined, namespace: string, entityId: string): string | undefined {
  if (!entryId) return undefined;
  const params = new URLSearchParams({ node: entityId, namespace, history: '1' });
  return `/entries/${encodeURIComponent(entryId)}?${params.toString()}`;
}
