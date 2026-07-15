# Phase 2 scope

Phase 2 closes the governed substrate: the write orchestrator, rails,
proposal lifecycle, SQLite and Algerknown adapters, the single-operator
trust profile, and the boundary that keeps every legacy write path from
bypassing it. `docs/phase-2-governance-acceptance.md` maps each exit
criterion to its automated evidence; this document states what is
deliberately **not** covered by that acceptance matrix, so a reviewer can
tell "not yet built" apart from "out of scope."

## Explicitly excluded from Phase 2 acceptance

- **Scout adapters.** No governed adapter reads from or writes to Scout's
  own data model. Only the Algerknown git/YAML adapter and the SQLite
  engine are in scope.
- **Scout trace ingestion.** `@algerknown/governed`'s package-boundary test
  (`packages/governed/tests/boundary/package-boundary.test.ts`) explicitly
  forbids importing Scout or application trace schemas from governed source;
  no Scout trace format is a dependency of any Phase 2 deliverable.
- **Engagement Scout conversion work.** Any pipeline that turns governed
  content into an engagement/outreach artifact is out of scope.
- **Provider bake-offs.** Model/provider selection for the RAG backend's
  query or ingest LLM clients is unrelated to governance and untouched here.
- **Corpus or production review metrics.** `DurableProposalService.reviewMeasurements`
  exists as a port-level capability from an earlier cohort; Phase 2 does not
  add dashboards, alerting, or production metrics collection on top of it.
- **Policy-dial changes.** Namespace policy modes, confidence floors, volume
  caps, and audit-sampling rates keep the defaults delivered by cohort 2.
  Phase 2 fixtures may supply their own deterministic values through test
  configuration (e.g. an every-2 audit policy in
  `audit-sampling-durability.test.ts`), but production defaults are
  unchanged -- evidence-based policy tuning is explicitly Phase 3 work.
- **Production semantic contradiction discovery.** The governed orchestrator
  and synthetic rail suite enforce contradiction-to-proposal when a
  `ContradictionDetector` returns a higher-confidence match. The web
  composition's detector is intentionally a no-op; provider selection,
  corpus validation, and production recall/precision measurement are
  deferred to Phase 3. Phase 2 therefore closes the structural route, not
  semantic discovery quality.
- **ContextPacket.** No Phase 2 deliverable assembles, consumes, or depends
  on a ContextPacket.
- **Posture/thread/judge work.** Any agent posture, conversation-thread
  modeling, or LLM-judge evaluation work is unrelated to the governed
  substrate and out of scope.
- **Daily-work integration.** Phase 2 does not wire governed content into
  any daily-operator workflow beyond the review console and CLI already
  delivered by cohort 4 (`f21a44e`, `#44`).

## What Phase 2 *does* close (see the acceptance doc for evidence)

- The default engine table stores `canonical.*` namespaces through explicit
  Algerknown dossier bindings and stores every `memory.*` namespace in the
  governed SQLite database. Repository routing consumes that declaration and
  fails closed when an Algerknown namespace has no binding; it no longer
  silently substitutes SQLite for a configured git/YAML engine.
- Every structural rail (type x namespace matrix, attestation, provenance,
  schema, confidence/volume, append-only, reversible diffs), including the
  contradiction-to-proposal route under an injected deterministic detector.
- The full proposal lifecycle (propose/inspect/amend/accept/reject/
  expire/tombstone/revert) with attribution and reversal guarantees.
- SQLite and Algerknown conformance through one shared, backend-neutral
  harness.
- A real update and attributable reversal against the pinned cohort-1
  dossier fixture.
- Read-model rebuild, byte-identical, for both backends.
- Restart and crash recovery, including real subprocess durability and
  git-coordination failpoint recovery.
- The authenticated browser/CLI boundary (cookie/CSRF, reviewer bearer,
  processor propose-only) and the absence of governed write bypasses
  (a maintained write-site inventory plus runtime boundary tests).

## A note on the RAG governance client surface

Phase 2 adds one new capability to the RAG backend's governance surface
(`GovernanceClient.submit_operation`, `POST /api/governance/processor/operations`)
to close a gap the ingest flow's own code comment had claimed was already
handled: recording ingest completion as a generic governed operation event
rather than an ungoverned `last_ingested` YAML edit. This is the only
production code added to `rag-backend/` in Phase 2 beyond what cohort 3
already delivered -- provider selection, embeddings, and the query/ingest
LLM pipelines themselves are unchanged.
