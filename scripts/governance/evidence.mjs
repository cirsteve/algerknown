import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// Fixed relative to this file's own location (scripts/governance/evidence.mjs),
// not to whoever imports it, so callers at any nesting depth resolve the same
// shared directory.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EVIDENCE_DIR = path.join(REPO_ROOT, 'build', 'phase2-acceptance', 'evidence');

/**
 * @typedef {{
 *   checkId: string,
 *   caseId?: string,
 *   status?: 'pass' | 'fail',
 *   suite: string,
 *   fixture?: string | null,
 *   backend?: string | null,
 *   durationMs?: number | null,
 *   detail?: unknown,
 * }} EvidenceInput
 */

function readExisting(checkId) {
  const file = path.join(EVIDENCE_DIR, `${checkId}.json`);
  if (!fs.existsSync(file)) return { checkId, cases: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!Array.isArray(parsed.cases)) return { checkId, cases: [] };
    return parsed;
  } catch {
    return { checkId, cases: [] };
  }
}

/**
 * Records one case of evidence for a required acceptance check. Call this
 * only after every assertion for that case has already passed -- if it
 * throws first, no evidence is written and the aggregate report correctly
 * treats the check as missing rather than passing.
 *
 * Multiple cases (e.g. one per backend) accumulate under the same
 * `<checkId>.json` file, keyed by `caseId` (default: "default"); recording
 * the same caseId again replaces the prior case rather than duplicating it,
 * so a suite can be re-run locally without stale evidence piling up.
 *
 * @param {EvidenceInput} input
 */
export function recordEvidence(input) {
  const { checkId, caseId = 'default', status = 'pass', suite, fixture = null, backend = null, durationMs = null } = input;
  if (!checkId) throw new Error('recordEvidence requires a checkId');
  if (!suite) throw new Error('recordEvidence requires a suite');

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const existing = readExisting(checkId);
  const newCase = {
    caseId,
    status,
    suite,
    fixture,
    backend,
    durationMs,
    recordedAt: new Date().toISOString(),
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
  };
  existing.cases = [...existing.cases.filter((c) => c.caseId !== caseId), newCase];
  fs.writeFileSync(path.join(EVIDENCE_DIR, `${checkId}.json`), JSON.stringify(existing, null, 2) + '\n');
  return newCase;
}

/**
 * Times `fn`, then records evidence with the measured duration. `fn` throwing
 * propagates without recording evidence -- the point of the wrapper is that a
 * failed scenario leaves the check's evidence file untouched (or still
 * missing), which is exactly what should fail the aggregate report.
 *
 * @param {string} checkId
 * @param {Omit<EvidenceInput, 'checkId' | 'durationMs'>} caseMeta
 * @param {() => unknown | Promise<unknown>} fn
 */
export async function withEvidence(checkId, caseMeta, fn) {
  const start = Date.now();
  const result = await fn();
  recordEvidence({ checkId, durationMs: Date.now() - start, ...caseMeta });
  return result;
}

export function evidenceDir() {
  return EVIDENCE_DIR;
}

export function repoRoot() {
  return REPO_ROOT;
}
