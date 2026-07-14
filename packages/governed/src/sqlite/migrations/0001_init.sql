-- Governed SQLite schema: namespaces/current projections, immutable revision
-- history, idempotency, durable proposals, attestations, verdicts,
-- reversals, audit samples, processor usage, and the generic operation sink.

-- ---------------------------------------------------------------------------
-- Namespaces and current projections
-- ---------------------------------------------------------------------------

CREATE TABLE namespaces (
  namespace TEXT PRIMARY KEY,
  current_revision INTEGER NOT NULL DEFAULT 0,
  next_sequence INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE current_nodes (
  namespace TEXT NOT NULL,
  node_id TEXT NOT NULL,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  provenance_json TEXT NOT NULL,
  revision_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  namespace_revision INTEGER NOT NULL,
  PRIMARY KEY (namespace, node_id)
);

CREATE INDEX idx_current_nodes_subject ON current_nodes (namespace, subject);

CREATE TABLE current_edges (
  namespace TEXT NOT NULL,
  edge_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  revision_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  namespace_revision INTEGER NOT NULL,
  PRIMARY KEY (namespace, edge_id)
);

CREATE INDEX idx_current_edges_source ON current_edges (namespace, source_id);
CREATE INDEX idx_current_edges_target ON current_edges (namespace, target_id);

-- ---------------------------------------------------------------------------
-- Immutable namespace revision ledger (the Repository port's RevisionRecord)
-- ---------------------------------------------------------------------------

CREATE TABLE namespace_revisions (
  namespace TEXT NOT NULL,
  namespace_revision INTEGER NOT NULL,
  revision_id TEXT NOT NULL,
  previous_revision INTEGER,
  created_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_class TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  audit_directive_json TEXT,
  PRIMARY KEY (namespace, namespace_revision)
);

CREATE UNIQUE INDEX idx_namespace_revisions_revision_id ON namespace_revisions (revision_id);
CREATE UNIQUE INDEX idx_namespace_revisions_idempotency ON namespace_revisions (namespace, idempotency_key);
CREATE INDEX idx_namespace_revisions_time ON namespace_revisions (namespace, created_at);

CREATE TRIGGER trg_namespace_revisions_no_update
BEFORE UPDATE ON namespace_revisions
BEGIN
  SELECT RAISE(ABORT, 'namespace_revisions is immutable');
END;

CREATE TRIGGER trg_namespace_revisions_no_delete
BEFORE DELETE ON namespace_revisions
BEGIN
  SELECT RAISE(ABORT, 'namespace_revisions is immutable');
END;

-- Per-entity immutable history, indexed for subject/time reconstruction and
-- revert-target lookup independent of the namespace-scoped ledger above.

CREATE TABLE node_revisions (
  namespace TEXT NOT NULL,
  node_id TEXT NOT NULL,
  namespace_revision INTEGER NOT NULL,
  revision_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  change_kind TEXT NOT NULL,
  node_json TEXT,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  PRIMARY KEY (namespace, node_id, namespace_revision)
);

CREATE INDEX idx_node_revisions_subject ON node_revisions (namespace, subject);
CREATE INDEX idx_node_revisions_time ON node_revisions (namespace, created_at);

CREATE TRIGGER trg_node_revisions_no_update
BEFORE UPDATE ON node_revisions
BEGIN
  SELECT RAISE(ABORT, 'node_revisions is immutable');
END;

CREATE TRIGGER trg_node_revisions_no_delete
BEFORE DELETE ON node_revisions
BEGIN
  SELECT RAISE(ABORT, 'node_revisions is immutable');
END;

CREATE TABLE edge_revisions (
  namespace TEXT NOT NULL,
  edge_id TEXT NOT NULL,
  namespace_revision INTEGER NOT NULL,
  revision_id TEXT NOT NULL,
  change_kind TEXT NOT NULL,
  edge_json TEXT,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  PRIMARY KEY (namespace, edge_id, namespace_revision)
);

CREATE INDEX idx_edge_revisions_time ON edge_revisions (namespace, created_at);

CREATE TRIGGER trg_edge_revisions_no_update
BEFORE UPDATE ON edge_revisions
BEGIN
  SELECT RAISE(ABORT, 'edge_revisions is immutable');
END;

CREATE TRIGGER trg_edge_revisions_no_delete
BEFORE DELETE ON edge_revisions
BEGIN
  SELECT RAISE(ABORT, 'edge_revisions is immutable');
END;

-- ---------------------------------------------------------------------------
-- Generic scope+key idempotency records (used by proposal lifecycle actions;
-- namespace-write idempotency is served directly off namespace_revisions).
-- ---------------------------------------------------------------------------

CREATE TABLE idempotency_records (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);

-- ---------------------------------------------------------------------------
-- Processor usage (rolling-window write accounting)
-- ---------------------------------------------------------------------------

CREATE TABLE processor_usage (
  processor_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX idx_processor_usage_processor ON processor_usage (processor_id, recorded_at);

-- ---------------------------------------------------------------------------
-- Durable proposals: current projection + immutable versions/events
-- ---------------------------------------------------------------------------

CREATE TABLE proposals (
  proposal_id TEXT PRIMARY KEY,
  target_namespace TEXT NOT NULL,
  target_subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'deleted')),
  version INTEGER NOT NULL,
  mutation_hash TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  expected_target_revision INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resulting_revision INTEGER,
  reverted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_proposals_namespace ON proposals (target_namespace);
CREATE INDEX idx_proposals_subject ON proposals (target_namespace, target_subject);
CREATE INDEX idx_proposals_status ON proposals (target_namespace, status);
CREATE INDEX idx_proposals_fingerprint ON proposals (target_namespace, fingerprint);
CREATE INDEX idx_proposals_mutation_hash ON proposals (target_namespace, mutation_hash, status);

CREATE TRIGGER trg_proposals_no_delete
BEFORE DELETE ON proposals
BEGIN
  SELECT RAISE(ABORT, 'proposals rows are tombstoned, never deleted');
END;

CREATE TABLE proposal_versions (
  version_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals (proposal_id),
  version INTEGER NOT NULL,
  canonical_mutation_json TEXT NOT NULL,
  mutation_hash TEXT NOT NULL,
  expected_target_revision INTEGER,
  supporting_observation_ids_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (proposal_id, version)
);

CREATE TRIGGER trg_proposal_versions_no_update
BEFORE UPDATE ON proposal_versions
BEGIN
  SELECT RAISE(ABORT, 'proposal_versions is immutable');
END;

CREATE TRIGGER trg_proposal_versions_no_delete
BEFORE DELETE ON proposal_versions
BEGIN
  SELECT RAISE(ABORT, 'proposal_versions is immutable');
END;

CREATE TABLE proposal_events (
  event_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals (proposal_id),
  kind TEXT NOT NULL,
  at TEXT NOT NULL,
  actor_id TEXT,
  proposal_version INTEGER,
  reason TEXT,
  note TEXT,
  channel TEXT,
  review_batch_id TEXT,
  detail_json TEXT
);

CREATE INDEX idx_proposal_events_proposal ON proposal_events (proposal_id, at);
CREATE INDEX idx_proposal_events_reviewer ON proposal_events (actor_id, at);
CREATE INDEX idx_proposal_events_time ON proposal_events (at);
CREATE INDEX idx_proposal_events_batch ON proposal_events (review_batch_id);

CREATE TRIGGER trg_proposal_events_no_update
BEFORE UPDATE ON proposal_events
BEGIN
  SELECT RAISE(ABORT, 'proposal_events is immutable');
END;

CREATE TRIGGER trg_proposal_events_no_delete
BEFORE DELETE ON proposal_events
BEGIN
  SELECT RAISE(ABORT, 'proposal_events is immutable');
END;

CREATE TABLE attestations (
  attestation_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals (proposal_id),
  proposal_version INTEGER NOT NULL,
  reviewer_id TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  target_revision INTEGER,
  mutation_hash TEXT NOT NULL,
  review_note TEXT,
  channel TEXT NOT NULL,
  verifier_meta_json TEXT NOT NULL
);

CREATE INDEX idx_attestations_proposal ON attestations (proposal_id, proposal_version);
CREATE INDEX idx_attestations_reviewer ON attestations (reviewer_id, approved_at);

CREATE TRIGGER trg_attestations_no_update
BEFORE UPDATE ON attestations
BEGIN
  SELECT RAISE(ABORT, 'attestations is immutable');
END;

CREATE TRIGGER trg_attestations_no_delete
BEFORE DELETE ON attestations
BEGIN
  SELECT RAISE(ABORT, 'attestations is immutable');
END;

CREATE TABLE evaluator_verdicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id TEXT REFERENCES proposals (proposal_id),
  namespace TEXT,
  revision_id TEXT,
  evaluator TEXT NOT NULL,
  passed INTEGER NOT NULL,
  reason_codes_json TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_evaluator_verdicts_proposal ON evaluator_verdicts (proposal_id);
CREATE INDEX idx_evaluator_verdicts_revision ON evaluator_verdicts (namespace, revision_id);

CREATE TRIGGER trg_evaluator_verdicts_no_update
BEFORE UPDATE ON evaluator_verdicts
BEGIN
  SELECT RAISE(ABORT, 'evaluator_verdicts is immutable');
END;

CREATE TRIGGER trg_evaluator_verdicts_no_delete
BEFORE DELETE ON evaluator_verdicts
BEGIN
  SELECT RAISE(ABORT, 'evaluator_verdicts is immutable');
END;

CREATE TABLE reversals (
  reversal_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals (proposal_id),
  original_revision INTEGER NOT NULL,
  new_revision INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  channel TEXT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_reversals_proposal ON reversals (proposal_id);

CREATE TRIGGER trg_reversals_no_update
BEFORE UPDATE ON reversals
BEGIN
  SELECT RAISE(ABORT, 'reversals is immutable');
END;

CREATE TRIGGER trg_reversals_no_delete
BEFORE DELETE ON reversals
BEGIN
  SELECT RAISE(ABORT, 'reversals is immutable');
END;

-- ---------------------------------------------------------------------------
-- Deterministic every-N audit samples; only review attribution columns may
-- ever be updated, and only from unreviewed to reviewed.
-- ---------------------------------------------------------------------------

CREATE TABLE audit_samples (
  sample_id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  namespace_revision INTEGER NOT NULL,
  processor_id TEXT,
  sampled_at TEXT NOT NULL,
  reviewed INTEGER NOT NULL DEFAULT 0,
  reviewer_id TEXT,
  verdict TEXT,
  note TEXT,
  reviewed_at TEXT,
  UNIQUE (namespace, namespace_revision)
);

CREATE INDEX idx_audit_samples_pending ON audit_samples (namespace, reviewed, sampled_at);

CREATE TRIGGER trg_audit_samples_no_delete
BEFORE DELETE ON audit_samples
BEGIN
  SELECT RAISE(ABORT, 'audit_samples is immutable');
END;

CREATE TRIGGER trg_audit_samples_no_resample
BEFORE UPDATE OF namespace, namespace_revision, processor_id, sampled_at ON audit_samples
BEGIN
  SELECT RAISE(ABORT, 'audit_samples selection fields cannot change');
END;

CREATE TRIGGER trg_audit_samples_no_rereview
BEFORE UPDATE OF reviewed, reviewer_id, verdict, note, reviewed_at ON audit_samples
WHEN OLD.reviewed = 1
BEGIN
  SELECT RAISE(ABORT, 'audit_samples review is write-once');
END;

-- ---------------------------------------------------------------------------
-- Generic append-only operation sink (operation.<trace>): idempotent append
-- keyed on the caller-supplied operation id, ordered read by sequence.
-- ---------------------------------------------------------------------------

CREATE TABLE operation_events (
  event_id TEXT PRIMARY KEY,
  operation_namespace TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  operation_kind TEXT,
  actor_id TEXT NOT NULL,
  source_refs_json TEXT,
  recorded_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  idempotency_key TEXT,
  UNIQUE (operation_namespace, sequence)
);

CREATE INDEX idx_operation_events_namespace ON operation_events (operation_namespace, sequence);
CREATE INDEX idx_operation_events_time ON operation_events (operation_namespace, recorded_at);

CREATE TRIGGER trg_operation_events_no_update
BEFORE UPDATE ON operation_events
BEGIN
  SELECT RAISE(ABORT, 'operation_events is append-only');
END;

CREATE TRIGGER trg_operation_events_no_delete
BEFORE DELETE ON operation_events
BEGIN
  SELECT RAISE(ABORT, 'operation_events is append-only');
END;
