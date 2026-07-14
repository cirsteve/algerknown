import type { AcceptInput, DatabaseType, ProposalId, RevertInput } from '@algerknown/governed';

/**
 * Recoverable coordination for review actions (accept/revert) that mutate a
 * git-backed target. @algerknown/governed's DurableProposalService already
 * finalizes SQLite proposal bookkeeping atomically via SqliteUnitOfWork, but
 * that finalize is a *separate* transaction from the governed write itself
 * (WriteOrchestrator.write -> Repository.commit). For a git target, a crash
 * between "the git commit landed" and "the proposal was marked accepted"
 * would otherwise leave the proposal pending forever while the dossier has
 * already changed. This table records the operation's intent durably in the
 * same SQLite database *before* the write is attempted, so a startup scan
 * can detect and resolve any operation that never reached its finalize step.
 *
 * This table is owned entirely by the web composition root -- it is not part
 * of @algerknown/governed's own schema/migrations, since that package is out
 * of scope for this cohort to modify.
 */
export type GitOperationIntentAction = 'accept' | 'revert';
export type GitOperationIntentStatus = 'started' | 'completed' | 'blocked';

export interface GitOperationIntentRow {
  operationId: string;
  proposalId: ProposalId;
  action: GitOperationIntentAction;
  namespace: string;
  commandIdempotencyKey: string;
  expectedMutationHash: string;
  reviewInputJson: string;
  status: GitOperationIntentStatus;
  createdAt: string;
  completedAt: string | null;
  resultingRevision: number | null;
  note: string | null;
}

export function ensureGitOperationIntentsTable(db: DatabaseType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_git_operation_intents (
      operation_id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      action TEXT NOT NULL,
      namespace TEXT NOT NULL,
      command_idempotency_key TEXT NOT NULL,
      expected_mutation_hash TEXT NOT NULL,
      review_input_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      resulting_revision INTEGER,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_web_git_operation_intents_proposal ON web_git_operation_intents (proposal_id, status);
  `);
}

function rowToIntent(row: Record<string, unknown>): GitOperationIntentRow {
  return {
    operationId: row.operation_id as string,
    proposalId: row.proposal_id as ProposalId,
    action: row.action as GitOperationIntentAction,
    namespace: row.namespace as string,
    commandIdempotencyKey: row.command_idempotency_key as string,
    expectedMutationHash: row.expected_mutation_hash as string,
    reviewInputJson: row.review_input_json as string,
    status: row.status as GitOperationIntentStatus,
    createdAt: row.created_at as string,
    completedAt: (row.completed_at as string | null) ?? null,
    resultingRevision: (row.resulting_revision as number | null) ?? null,
    note: (row.note as string | null) ?? null,
  };
}

export function findActiveIntent(db: DatabaseType, proposalId: ProposalId): GitOperationIntentRow | undefined {
  const row = db
    .prepare(`SELECT * FROM web_git_operation_intents WHERE proposal_id = ? AND status = 'started' LIMIT 1`)
    .get(proposalId) as Record<string, unknown> | undefined;
  return row ? rowToIntent(row) : undefined;
}

export function listIncompleteIntents(db: DatabaseType): GitOperationIntentRow[] {
  const rows = db.prepare(`SELECT * FROM web_git_operation_intents WHERE status = 'started' ORDER BY created_at ASC`).all() as Record<
    string,
    unknown
  >[];
  return rows.map(rowToIntent);
}

export interface CreateIntentInput {
  operationId: string;
  proposalId: ProposalId;
  action: GitOperationIntentAction;
  namespace: string;
  commandIdempotencyKey: string;
  expectedMutationHash: string;
  reviewInput: AcceptInput | RevertInput;
  createdAt: string;
}

export function createIntent(db: DatabaseType, input: CreateIntentInput): void {
  db.prepare(
    `INSERT INTO web_git_operation_intents
       (operation_id, proposal_id, action, namespace, command_idempotency_key, expected_mutation_hash, review_input_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'started', ?)`,
  ).run(
    input.operationId,
    input.proposalId,
    input.action,
    input.namespace,
    input.commandIdempotencyKey,
    input.expectedMutationHash,
    JSON.stringify(input.reviewInput),
    input.createdAt,
  );
}

export function completeIntent(db: DatabaseType, operationId: string, resultingRevision: number | null, completedAt: string): void {
  db.prepare(`UPDATE web_git_operation_intents SET status = 'completed', resulting_revision = ?, completed_at = ? WHERE operation_id = ?`).run(
    resultingRevision,
    completedAt,
    operationId,
  );
}

export function blockIntent(db: DatabaseType, operationId: string, note: string, completedAt: string): void {
  db.prepare(`UPDATE web_git_operation_intents SET status = 'blocked', note = ?, completed_at = ? WHERE operation_id = ?`).run(
    note,
    completedAt,
    operationId,
  );
}
