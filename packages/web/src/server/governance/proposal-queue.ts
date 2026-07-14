import type { DatabaseType, DurableProposalStatus } from '@algerknown/governed';

/**
 * DurableProposalService exposes propose/inspect/amend/accept/reject/expire/
 * delete/revert but no list-with-filters query -- there is no queue-reading
 * port to extend without modifying @algerknown/governed, which is out of
 * scope for this cohort. The `proposals` table it maintains is otherwise
 * fully described by its own DurableProposal shape, so the web composition
 * root reads it directly here rather than duplicating a second proposal
 * store; this is the one place outside that package that depends on its
 * table layout, and only for read-only listing.
 */
export interface ProposalQueueFilters {
  status?: DurableProposalStatus;
  namespace?: string;
  subject?: string;
  cursor?: string;
  limit: number;
}

export interface ProposalQueueRow {
  id: string;
  targetNamespace: string;
  targetSubject: string;
  status: DurableProposalStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  resultingRevision: number | null;
  reverted: boolean;
}

export interface ProposalQueuePage {
  items: ProposalQueueRow[];
  nextCursor: string | null;
}

interface Cursor {
  createdAt: string;
  proposalId: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf-8').toString('base64url');
}

export class InvalidCursorError extends Error {
  constructor() {
    super('invalid cursor');
    this.name = 'InvalidCursorError';
  }
}

function decodeCursor(value: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf-8')) as Partial<Cursor>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.proposalId !== 'string') {
      throw new InvalidCursorError();
    }
    return { createdAt: parsed.createdAt, proposalId: parsed.proposalId };
  } catch {
    throw new InvalidCursorError();
  }
}

export function listProposalQueue(db: DatabaseType, filters: ProposalQueueFilters): ProposalQueuePage {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters.status) {
    clauses.push('status = @status');
    params.status = filters.status;
  }
  if (filters.namespace) {
    clauses.push('target_namespace = @namespace');
    params.namespace = filters.namespace;
  }
  if (filters.subject) {
    clauses.push('target_subject = @subject');
    params.subject = filters.subject;
  }
  if (filters.cursor) {
    const cursor = decodeCursor(filters.cursor);
    clauses.push('(created_at > @cursorCreatedAt OR (created_at = @cursorCreatedAt AND proposal_id > @cursorProposalId))');
    params.cursorCreatedAt = cursor.createdAt;
    params.cursorProposalId = cursor.proposalId;
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filters.limit;
  const rows = db
    .prepare(
      `SELECT proposal_id, target_namespace, target_subject, status, version, created_at, updated_at, resulting_revision, reverted
       FROM proposals ${where}
       ORDER BY created_at ASC, proposal_id ASC
       LIMIT @limitPlusOne`,
    )
    .all({ ...params, limitPlusOne: limit + 1 }) as {
    proposal_id: string;
    target_namespace: string;
    target_subject: string;
    status: DurableProposalStatus;
    version: number;
    created_at: string;
    updated_at: string;
    resulting_revision: number | null;
    reverted: number;
  }[];

  const page = rows.slice(0, limit);
  const items: ProposalQueueRow[] = page.map((row) => ({
    id: row.proposal_id,
    targetNamespace: row.target_namespace,
    targetSubject: row.target_subject,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resultingRevision: row.resulting_revision,
    reverted: row.reverted === 1,
  }));

  const nextCursor =
    rows.length > limit && items.length > 0 ? encodeCursor({ createdAt: items[items.length - 1]!.createdAt, proposalId: items[items.length - 1]!.id }) : null;

  return { items, nextCursor };
}

export interface ReversalRow {
  reversalId: string;
  proposalId: string;
  originalRevision: number;
  newRevision: number;
  actorId: string;
  channel: string | null;
  reason: string;
  createdAt: string;
}

export function getReversal(db: DatabaseType, proposalId: string): ReversalRow | undefined {
  const row = db.prepare(`SELECT * FROM reversals WHERE proposal_id = ? ORDER BY created_at DESC LIMIT 1`).get(proposalId) as
    | {
        reversal_id: string;
        proposal_id: string;
        original_revision: number;
        new_revision: number;
        actor_id: string;
        channel: string | null;
        reason: string;
        created_at: string;
      }
    | undefined;
  if (!row) return undefined;
  return {
    reversalId: row.reversal_id,
    proposalId: row.proposal_id,
    originalRevision: row.original_revision,
    newRevision: row.new_revision,
    actorId: row.actor_id,
    channel: row.channel,
    reason: row.reason,
    createdAt: row.created_at,
  };
}
