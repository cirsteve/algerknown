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

export function findForbiddenIdentityField(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const keys = Object.keys(body as Record<string, unknown>);
  return FORBIDDEN_CLIENT_IDENTITY_FIELDS.find((field) => keys.includes(field));
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
