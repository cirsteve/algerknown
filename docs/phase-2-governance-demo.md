# Phase 2 governance demo runbook

`npm run demo:phase2` reproduces, entirely locally and without any external
service, the recorded Algerknown review session CI produces: a scripted
Chromium browser drives the real built governance console through unlock,
provenance/verdict inspection, amend-then-accept, reject-with-reason, a
seeded evidence contradiction, a stale-conflict refresh, proposal history,
and a revert -- while machine-readable evidence is captured alongside the
video.

## Prerequisites

- Node 22, `npm ci` already run at the repo root.
- `@algerknown/web` built (`npm run build --workspace=@algerknown/web`) --
  the demo runs the real `dist/server/index.js` and `dist/client` bundle,
  not a dev server, so the recording matches what CI (and a real deploy)
  actually serves. `run-demo.mjs` builds it automatically if `dist/` is
  missing, but a change to `packages/web/src` since the last build will not
  be picked up until you rebuild.
- The Playwright Chromium browser, downloaded once with
  `npx playwright install chromium` (run from `packages/web/`, or
  `--with-deps` if you also want the OS-level dependencies it can normally
  install; sandboxes without passwordless sudo should omit `--with-deps` --
  plain `chromium` launches fine without it). `demo:phase2` does **not**
  install this for you; CI installs it explicitly as its own step.
- Nothing else. No `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`, no Scout corpus, no
  network access, no production content repository. The demo seeds its own
  temporary local knowledge base (no git remote) and sqlite database under
  `build/phase2-demo/`.

## Environment

The demo script generates its own test-only credentials (a random 48-hex-
character reviewer secret and processor secret, well over the 32-byte
minimum-entropy floor `governance-config.ts` enforces) and writes them to
`build/phase2-demo/.env.local` for inspection -- never to the repo's real
`.env`, and never a value you should reuse anywhere else.

## Seed and reset

```
# Seed a fresh temporary KB + governed database under build/phase2-demo/,
# print the generated credentials and proposal ids, and stop (no server,
# no Playwright).
npm run demo:phase2 -- --seed-only

# Wipe and reseed from scratch.
rm -rf build/phase2-demo && npm run demo:phase2 -- --seed-only
```

Both commands are limited to paths under `build/` -- neither touches your
real content repository or `.env`.

## Start / stop

`npm run demo:phase2` with no flags does everything: seeds, starts the real
built server (`packages/web/dist/server/index.js`) on a locally-allocated
free port, runs the scripted Playwright session against it, stops the
server, and writes every artifact listed below.

To drive the same server manually instead of running the scripted session:

```
npm run demo:phase2 -- --seed-only
# Note the reviewer secret and manifest path it prints, then:
node -e "
  const m = require('./build/phase2-demo/seed-manifest.json');
  const { spawn } = require('child_process');
  spawn('node', ['packages/web/dist/server/index.js'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: '4173', WEB_HOST: '127.0.0.1',
      GOVERNANCE_PUBLIC_ORIGIN: 'http://127.0.0.1:4173',
      GOVERNANCE_REVIEWER_ID: m.reviewerId, GOVERNANCE_REVIEWER_DISPLAY_NAME: m.reviewerDisplayName,
      GOVERNANCE_REVIEWER_SECRET: m.reviewerSecret, GOVERNANCE_PROCESSOR_ID: m.processorId,
      GOVERNANCE_PROCESSOR_SECRET: m.processorSecret, ALGERKNOWN_ROOT: m.algerknownRoot,
      GOVERNANCE_DB_PATH: m.dbPath },
  });
"
# in a browser: open http://127.0.0.1:4173/ingest and unlock with the
# printed reviewer secret.
```

(This is exactly what `startServer()` in `scripts/governance/run-demo.mjs`
does with a fixed port instead of an allocated one -- read that function if
you want the precise env var list.) Stop the manually-started server with
Ctrl-C.

## Scripted browser flow

`packages/web/tests/e2e/review-session.spec.ts` (Playwright, against
`packages/web/tests/e2e/demo-fixtures.ts`'s seed) drives, in order:

1. **Unlock** with the generated reviewer secret.
2. **Browse the pending queue.**
3. **Inspect provenance and rail verdicts** on the proposal that will be
   amended.
4. **Amend** its decision rationale (editing a draft, saving as a new
   version), then **accept** it -- expect status `accepted`, a new
   revision, and the acceptance attributed to the browser session.
5. **Reject** a second proposal with a required reason -- expect status
   `rejected` and the reason recorded in its history.
6. **Surface a contradiction.** The composition's contradiction detector is
   a deliberate server-side no-op (`contradiction-detector.ts`), so no
   genuinely *auto-detected* contradiction verdict can come from a real
   write. This step instead opens a proposal seeded with a real, storable
   `contradicts` edge to an earlier node, and shows it rendered as a red
   badge in the Provenance tab's "Evidence relationships" -- the governed
   relationship a caller can legitimately declare, not a fabricated
   detector verdict.
7. **Stale conflict.** Two proposals are seeded against the same fresh
   namespace, both expecting revision 0. Accepting the first advances the
   namespace to revision 1; opening the second now shows the conflict
   banner ("target revision is stale"). The reviewer persists a refresh
   amendment acknowledging it. The server verifies the supplied current
   target revision, persists it into the new proposal version, and reloads
   the authoritative diff. The proposal is no longer stale, but acceptance
   still requires a separate explicit review action.
8. **History.** Accept a third (unrelated) proposal and follow its event
   history, confirming the acceptance event and its note are recorded.
9. **Revert.** Revert that same accepted proposal with a required reason --
   expect a new attributed revision.

## Manual verification (optional, mirrors the scripted flow)

If you'd rather drive the browser yourself: start the server as described
above, open the printed URL, unlock with the printed reviewer secret, and
walk through steps 2-9 by hand against the proposal ids in
`build/phase2-demo/seed-manifest.json`.

## Artifacts

All under `build/phase2-demo/` (gitignored; never commit these):

| File | Contents |
|---|---|
| `playwright-output/**/video.webm` | The recorded Chromium session (Playwright video; also a `trace.zip` and screenshot on failure). |
| `review-transcript.json` / `.md` | Every scripted step, the proposal id it acted on, and a timestamp. |
| `backend-conformance.txt` | Cases from the `ec3-backend-conformance` evidence file, if `npm run test:phase2:conformance` has been run beforehand -- otherwise a note that it wasn't. |
| `rail-matrix.json` | Copy of the `ec1-structural-rails` evidence file (or an explanatory placeholder if absent). |
| `read-model-rebuild.json` | Copy of the `ec5-read-model-rebuild` evidence file (or a placeholder). |
| `recovery-report.json` | Copy of the `ec6-restart-crash-recovery` evidence file (or a placeholder). |
| `boundary-audit.json` | Copy of the `ec8-no-write-bypass` and `ec7-authenticated-boundary` evidence files (or placeholders). |
| `seed-manifest.json` | Generated credentials and the proposal id seeded for each demo role. |
| `.env.local` | The generated test-only credentials (never committed; never real secrets). |
| `governed.sqlite*`, `kb/` | Runtime state -- gitignored, safe to delete any time. |

The `rail-matrix.json` / `read-model-rebuild.json` / `recovery-report.json`
/ `boundary-audit.json` / `backend-conformance.txt` files are copies of
whatever is already in `build/phase2-acceptance/evidence/` at the moment
`demo:phase2` runs its collection step -- for a fully populated bundle, run
`npm run test:phase2` first (or let CI's `phase2-e2e` job do it, which
downloads every other job's partial evidence before running the demo).

CI uploads the entire `build/phase2-demo/` directory as the
`phase2-governance-demo` artifact (30-day retention) but never commits the
video, the runtime databases, or the temporary KB to source control.

## Troubleshooting

- **"browserType.launch: Executable doesn't exist"**: run
  `npx playwright install chromium` once from `packages/web/`.
- **Port already in use**: the demo allocates a free port itself
  (`net.createServer().listen(0)`), so this should not happen from
  `demo:phase2` directly; it can happen if you're driving a manually
  started server on a fixed port you chose yourself -- pick a different
  port.
- **"reviewer secret must be at least 32 bytes"**: you edited `.env.local`
  by hand. Delete `build/phase2-demo` and re-run `--seed-only` to
  regenerate.
- **Stale KB state from a previous run**: `rm -rf build/phase2-demo` and
  re-run; `demo-fixtures.ts` also wipes and recreates this directory itself
  at the start of every seed, so this is rarely needed.
- **"unknown (403)" on the queue after unlocking**: this was a real
  production bug (Origin was required on GET, but browsers never send
  Origin on a same-origin GET) fixed in `reviewer-auth.ts`; if you see it
  again, check you rebuilt `@algerknown/web` after any auth-layer change.

## Cleanup

```
rm -rf build/phase2-demo
```

Safe at any time -- nothing under `build/` is real content, a real secret,
or referenced by source control.
