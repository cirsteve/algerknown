import type { Request, Response, NextFunction } from 'express';

/**
 * Fields that must never be trusted from a client body: authoritative
 * reviewer identity, timing, channel, and mutation attribution come only
 * from AuthenticatedReviewContext, the server Clock, and the stored
 * proposal - never from request JSON.
 */
export const FORBIDDEN_CLIENT_IDENTITY_FIELDS = [
  'reviewer',
  'reviewer_id',
  'reviewer_name',
  'timestamp',
  'approved_at',
  'channel',
  'mutation',
  'mutation_hash',
  'attestation',
  'evaluator_verdict',
] as const;

/** Recursively searches objects and arrays so a forbidden key nested at any depth is still caught. */
export function findForbiddenIdentityField(body: unknown): string | undefined {
  if (Array.isArray(body)) {
    for (const item of body) {
      const hit = findForbiddenIdentityField(item);
      if (hit) return hit;
    }
    return undefined;
  }
  if (typeof body !== 'object' || body === null) return undefined;

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  const directHit = FORBIDDEN_CLIENT_IDENTITY_FIELDS.find((field) => keys.includes(field));
  if (directHit) return directHit;

  for (const key of keys) {
    const hit = findForbiddenIdentityField(record[key]);
    if (hit) return hit;
  }
  return undefined;
}

/** Rejects (400), rather than silently dropping, any client-supplied identity/attribution field. */
export function rejectClientSuppliedIdentityFields(req: Request, res: Response, next: NextFunction) {
  const hit = findForbiddenIdentityField(req.body);
  if (hit) {
    res.status(400).json({ error: 'field_not_allowed', field: hit });
    return;
  }
  next();
}
