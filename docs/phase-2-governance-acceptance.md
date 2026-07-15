# Phase 2 governance acceptance

`npm run test:phase2` is the single deterministic entry point for Phase 2
closure: it runs `test:phase2:rails`, `test:phase2:conformance`,
`test:phase2:boundary`, and `test:phase2:recovery` in sequence, then
`scripts/governance/build-acceptance-report.mjs`, which aggregates every
`build/phase2-acceptance/evidence/<checkId>.json` file left by those suites
into `build/phase2-acceptance/report.json` and `report.md`, and exits
non-zero unless **all thirteen** required checks -- the eight exit criteria
plus the five structural invariants -- show `status: "pass"`. A check with
no evidence, a failed case, or a missing required case (e.g. `ec3-backend-
conformance` needs both a `sqlite` and an `algerknown` case) is reported as
`missing` or `failed`, never silently skipped.

The manifest itself lives in `scripts/governance/acceptance-manifest.mjs`
and is shape-locked by `packages/governed/tests/acceptance/manifest.test.ts`
(exactly 8 exit-criterion + 5 invariant entries, unique ids) so it cannot be
quietly narrowed.

## Exit criteria

| # | Exit criterion | Check id | Required case(s) | Primary evidence source |
|---|---|---|---|---|
| 1 | Structural rails | `ec1-structural-rails` | `default` | `packages/governed/tests/write/rail-matrix.test.ts` |
| 2 | Lifecycle transitions, attribution & reversal | `ec2-lifecycle-attribution-reversal` | `default` | `packages/governed/tests/proposals/lifecycle-scenario.test.ts` |
| 3 | SQLite & Algerknown conformance | `ec3-backend-conformance` | `sqlite`, `algerknown` | `packages/governed/tests/conformance/sqlite.conformance.test.ts`, `algerknown-git.conformance.test.ts` |
| 4 | Pinned dossier update & reversal | `ec4-pinned-dossier-update` | `default` | `packages/web/tests/governance/pinned-dossier-update.test.ts` |
| 5 | Read-model rebuild | `ec5-read-model-rebuild` | `sqlite`, `algerknown` | `packages/governed/tests/write/read-model-rebuild-dual-backend.test.ts` |
| 6 | Restart & crash recovery | `ec6-restart-crash-recovery` | `default` | `packages/web/tests/recovery/subprocess-restart.test.ts` + `packages/web/tests/governance/e2e-invariants.test.ts` (dangling-intent, hash-mismatch) |
| 7 | Authenticated browser/CLI boundary | `ec7-authenticated-boundary` | `web`, `cli` | `packages/web/tests/governance/browser-trust-boundary.test.ts`, `packages/cli/tests/governance/review-command.test.ts` |
| 8 | Absence of governed write bypasses | `ec8-no-write-bypass` | `static-audit`, `runtime-boundary` | `packages/web/tests/governance/write-site-audit.test.ts`, `legacy-boundary.test.ts` (+ `packages/cli/tests/governance/command-boundary.test.ts` as a supplementary `runtime-boundary-cli` case) |

## Structural invariants

| # | Invariant | Check id | Primary evidence source |
|---|---|---|---|
| 1 | No side effects on rejected/blocked writes | `inv1-no-side-effects-on-reject` | `packages/governed/tests/write/no-side-effects-on-reject.test.ts` |
| 2 | Append-only, idempotent, attributable operation sink | `inv2-operation-sink-append-only` | `packages/governed/tests/sqlite/operation-sink.test.ts` |
| 3 | Durable deterministic audit sampling across reopen | `inv3-audit-sampling-durable` | `packages/governed/tests/sqlite/audit-sampling-durability.test.ts` |
| 4 | Stale conflict never silently applies | `inv4-stale-conflict-integrity` | `packages/governed/tests/proposals/stale-conflict-refresh.test.ts` |
| 5 | Idempotent duplicate acceptance under concurrency | `inv5-idempotent-duplicate-acceptance` | `packages/web/tests/governance/idempotent-duplicate-acceptance.test.ts` |

## How a suite becomes evidence

Every evidence-emitting test file follows the same pattern (see
`packages/{governed,web,cli}/tests/*/evidence-helpers.ts`):

1. `trackSuiteFailures()` registers a file-wide `afterEach` that flips a
   `failed` flag the moment any test in the file fails.
2. A final test in the file calls `recordSuiteEvidence(health, {...})`,
   which throws instead of recording if `failed` is already true.

Because the evidence-recording test runs last (vitest executes a file's
tests in declaration order) and immediately checks the accumulated health
flag, a genuine failure anywhere earlier in the suite means no evidence
file is ever written for that check -- `build-acceptance-report.mjs` then
correctly reports it `missing`, not `pass`. There is no path by which a
failing suite can produce passing evidence.

## Reading the report

```
$ npm run test:phase2
...
phase2 acceptance report: pass (13/13 required checks passing)
report written to build/phase2-acceptance/report.json and report.md
```

`report.md` is a human-readable table (check id, kind, status, suite,
backend/channel, duration, evidence file path); `report.json` is the same
data structured for tooling. Neither is committed to source control
(`build/` is gitignored) -- they are reproducible from a clean checkout by
running `test:phase2`, and CI uploads them as build artifacts (see the
`phase2-e2e` job in `.github/workflows/ci.yml`).

## CI job mapping

| Job | Produces evidence for |
|---|---|
| `governed-unit` | EC1, EC2, EC3, EC5, INV1, INV2, INV3, INV4 |
| `python-rag` | (no acceptance-manifest check directly; RAG's own `test_governance_integration.py` proves the RAG-specific parts of EC8's `runtime-boundary` case and is exercised as part of the same closure, without emitting a `build/phase2-acceptance` record of its own -- Python doesn't share the Node evidence-recorder module) |
| `web-cli` | EC4, EC7 (`web` + `cli`), EC8 (`static-audit`, `runtime-boundary`, `runtime-boundary-cli`), INV5 |
| `boundary-recovery` | EC6 |
| `phase2-e2e` | Downloads every job's `phase2-evidence-*` artifact into one `build/phase2-acceptance/evidence/` directory, runs the Playwright demo (`npm run demo:phase2`), then `build-acceptance-report.mjs` to produce and validate the final report. |

`phase2-e2e` is the only job where the aggregate report can legitimately
reach 13/13 -- each earlier job only ever produces a subset, by design (see
"Split CI into governed-unit, python-rag, web-cli, boundary-recovery, and
phase2-e2e jobs" in the closure brief).
