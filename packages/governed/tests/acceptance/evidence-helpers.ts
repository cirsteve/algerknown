import { afterEach } from 'vitest';
// @ts-expect-error -- plain ESM script, no .d.ts.
import { recordEvidence as recordEvidenceRaw } from '../../../../scripts/governance/evidence.mjs';

export interface SuiteHealth {
  failed: boolean;
}

/**
 * Registers a file-wide afterEach that flips `failed` the moment any test in
 * this file fails. A final "records evidence" test placed at the end of the
 * same file (vitest runs a file's tests in declaration order) can then check
 * this before calling recordSuiteEvidence, so a failing case earlier in the
 * suite prevents evidence from ever being written -- the aggregate report
 * then correctly sees the check as missing rather than falsely passing.
 */
export function trackSuiteFailures(): SuiteHealth {
  const state: SuiteHealth = { failed: false };
  afterEach((ctx) => {
    if (ctx.task.result?.state === 'fail') state.failed = true;
  });
  return state;
}

export interface RecordSuiteEvidenceInput {
  checkId: string;
  caseId?: string;
  suite: string;
  fixture?: string | null;
  backend?: string | null;
  durationMs?: number | null;
  detail?: unknown;
}

/** Throws (never records) if any earlier case in this file already failed. */
export function recordSuiteEvidence(health: SuiteHealth, input: RecordSuiteEvidenceInput): void {
  if (health.failed) {
    throw new Error(`refusing to record evidence for "${input.checkId}": an earlier case in this suite failed`);
  }
  recordEvidenceRaw({ ...input, status: 'pass' });
}
