/**
 * Single source of truth for what "Phase 2 closed" means: the eight exit
 * criteria from the closure brief plus the five structural invariants they
 * depend on. scripts/governance/build-acceptance-report.mjs treats this list
 * as the complete required set -- a check with no evidence, or with a case
 * missing from `requiredCases`, fails the aggregate report, and therefore
 * fails `npm run test:phase2` / CI.
 *
 * packages/governed/tests/acceptance/manifest.test.ts asserts this list's
 * shape (exactly 8 exit-criterion + 5 invariant entries, unique ids) so a
 * drive-by edit here can't silently narrow what closure requires.
 */

/** @typedef {{ id: string, kind: 'exit-criterion' | 'invariant', title: string, description: string, requiredCases?: string[] }} RequiredCheck */

/** @type {RequiredCheck[]} */
export const REQUIRED_CHECKS = [
  {
    id: 'ec1-structural-rails',
    kind: 'exit-criterion',
    title: 'Structural rails',
    description:
      'The generic synthetic rail fixture table, run through the public WriteOrchestrator, declares exactly one of rejected/routed_to_proposal for every type x namespace x mutation-variant case, with full category coverage.',
  },
  {
    id: 'ec2-lifecycle-attribution-reversal',
    kind: 'exit-criterion',
    title: 'Lifecycle transitions, attribution & reversal',
    description:
      'The shared proposal lifecycle scenario (propose/inspect/amend/accept-with-attestation/reject-with-reason/expire-with-note/tombstone-delete-with-reason/revert-with-reason) preserves immutable versions/events, reviewer/processor separation, mutation hash, node-level diff, idempotent replay, stale conflict, and correction attribution.',
  },
  {
    id: 'ec3-backend-conformance',
    kind: 'exit-criterion',
    title: 'SQLite & Algerknown conformance',
    description:
      'The reusable, backend-neutral repository conformance harness runs unchanged against a file-backed SQLite database and a temporary git repository seeded from the pinned cohort-1 fixture, with identical expected results.',
    requiredCases: ['sqlite', 'algerknown'],
  },
  {
    id: 'ec4-pinned-dossier-update',
    kind: 'exit-criterion',
    title: 'Pinned dossier update & reversal',
    description:
      'A real fact update (derive, propose, amend, accept through the human-gated rail) and its attributable reversal are demonstrated in a temporary copy of the pinned dossier, visible via API/CLI/git history, without mutating the committed compatibility fixture.',
  },
  {
    id: 'ec5-read-model-rebuild',
    kind: 'exit-criterion',
    title: 'Read-model rebuild',
    description:
      'The reference read model, built incrementally from governed repositories, is dropped and rebuilt solely from governed revision enumeration and matches the original rows and digest byte-for-byte, for both SQLite- and Algerknown-backed data.',
    requiredCases: ['sqlite', 'algerknown'],
  },
  {
    id: 'ec6-restart-crash-recovery',
    kind: 'exit-criterion',
    title: 'Restart & crash recovery',
    description:
      'Durable proposal state survives a real process restart against real temporary files, and deterministic failpoint injection at each git-coordination stage recovers to exactly one commit / one accepted transition / one attestation / the original idempotent response, or blocks cleanly on a hash mismatch.',
  },
  {
    id: 'ec7-authenticated-boundary',
    kind: 'exit-criterion',
    title: 'Authenticated browser/CLI boundary',
    description:
      'Cookie/CSRF, reviewer bearer, and processor propose-only trust properties hold through the full web and CLI composition, not only in auth unit tests.',
    requiredCases: ['web', 'cli'],
  },
  {
    id: 'ec8-no-write-bypass',
    kind: 'exit-criterion',
    title: 'Absence of governed write bypasses',
    description:
      'The maintained write-site inventory audit fails closed on any unlisted, wildcard-bypassing, or legacy-apply writer, and runtime boundary tests prove every known web/RAG/CLI/core write path denies or legacy-classifies a forbidden mutation with unchanged state.',
    requiredCases: ['static-audit', 'runtime-boundary'],
  },
  {
    id: 'inv1-no-side-effects-on-reject',
    kind: 'invariant',
    title: 'No side effects on rejected/blocked writes',
    description: 'No rejected rail-matrix case changes revision, usage, audit state, nodes, edges, or operation events.',
  },
  {
    id: 'inv2-operation-sink-append-only',
    kind: 'invariant',
    title: 'Append-only, idempotent, attributable operation sink',
    description:
      'operation.<trace> writes carry only generic kind/payload/source/actor/time/idempotency data; exact replay returns the original sequence, changed-content key reuse fails, ordering survives reopen, and UPDATE/DELETE attempts fail at the database layer.',
  },
  {
    id: 'inv3-audit-sampling-durable',
    kind: 'invariant',
    title: 'Durable deterministic audit sampling across reopen',
    description:
      'Deterministic every-N audit sampling selects the exact expected revisions, and sampled/pending state and reviewer attribution survive a real database close and reopen, including after the sampled node is corrected or reverted.',
  },
  {
    id: 'inv4-stale-conflict-integrity',
    kind: 'invariant',
    title: 'Stale conflict never silently applies',
    description:
      'Two proposals against one revision, one accepted and one refreshed via amendment, never let the stale mutation apply before new human review.',
  },
  {
    id: 'inv5-idempotent-duplicate-acceptance',
    kind: 'invariant',
    title: 'Idempotent duplicate acceptance under concurrency',
    description:
      'Concurrent and sequential-after-lost-response duplicate acceptance with the same idempotency key produce byte-identical responses, one backend revision, one attestation, one proposal event transition, and no duplicate audit/usage accounting.',
  },
];

export function findCheck(id) {
  return REQUIRED_CHECKS.find((c) => c.id === id);
}
