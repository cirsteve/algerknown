/**
 * Shared resolution logic for the content-agn dossier-contract gate, used by
 * both conformance.test.ts and schema-parity.test.ts.
 *
 * Three runner modes, selected via CONFORMANCE_SOURCE_MODE:
 *   - "pinned": the expected content-agn revision comes only from the
 *     checked-in packages/core/tests/conformance-corpus-revision.json pin.
 *     CI checks out that exact SHA into a sibling directory and points
 *     CONFORMANCE_CORPUS_DIR at its conformance/v1 subdirectory; this module
 *     independently re-verifies the checkout's HEAD against the pin.
 *   - "candidate": content-agn's own CI validates its proposed (not-yet-
 *     merged) tree. CONTENT_AGN_CANDIDATE_CHECKOUT/_SHA are supplied by that
 *     caller and are never derived from the pin.
 *   - unset (auto): local developer convenience — look for a sibling or
 *     nested content-agn checkout without verifying its revision, so
 *     contributors without a pinned checkout can still run the rest of the
 *     suite. CI always sets an explicit mode, so this path never runs there.
 *
 * When CONFORMANCE_REQUIRED=1, any resolution failure throws
 * ConformanceResolutionError instead of returning null, so the calling test
 * file fails the build rather than silently skipping. See
 * docs/dossier-contract.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface CorpusPin {
  repository: string;
  revision: string;
  corpus_path: string;
  summary_schema_path: string;
  index_schema_path: string;
}

export interface ConformanceSource {
  mode: 'pinned' | 'candidate' | 'auto';
  contentAgnRoot: string;
  corpusDir: string;
  summarySchemaPath: string;
  indexSchemaPath: string;
}

export class ConformanceResolutionError extends Error {}

const PIN_PATH = path.join(__dirname, '..', 'conformance-corpus-revision.json');

export function loadPin(): CorpusPin {
  return JSON.parse(fs.readFileSync(PIN_PATH, 'utf-8')) as CorpusPin;
}

export function isRequired(): boolean {
  return process.env.CONFORMANCE_REQUIRED === '1';
}

function fail(message: string): never {
  throw new ConformanceResolutionError(`[dossier-contract] ${message}`);
}

function gitHead(dir: string): string | null {
  if (!fs.existsSync(path.join(dir, '.git'))) return null;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).trim().toLowerCase();
  } catch {
    return null;
  }
}

// A checkout root plus a relative corpus_path (e.g. "conformance/v1") ->
// the resolved ConformanceSource, or a fail() throw for the given reasons.
function buildSource(
  mode: ConformanceSource['mode'],
  root: string,
  pin: CorpusPin,
  corpusDir: string
): ConformanceSource {
  if (!fs.existsSync(path.join(corpusDir, 'manifest.json'))) {
    fail(`manifest.json not found at ${corpusDir}`);
  }
  const summarySchemaPath = path.join(root, pin.summary_schema_path);
  const indexSchemaPath = path.join(root, pin.index_schema_path);
  if (!fs.existsSync(summarySchemaPath)) {
    fail(`pinned summary_schema_path not found: ${summarySchemaPath}`);
  }
  if (!fs.existsSync(indexSchemaPath)) {
    fail(`pinned index_schema_path not found: ${indexSchemaPath}`);
  }
  return { mode, contentAgnRoot: root, corpusDir, summarySchemaPath, indexSchemaPath };
}

function resolvePinned(pin: CorpusPin, required: boolean): ConformanceSource | null {
  const corpusDir = process.env.CONFORMANCE_CORPUS_DIR;
  if (!corpusDir || !fs.existsSync(corpusDir)) {
    if (required) fail('CONFORMANCE_SOURCE_MODE=pinned requires CONFORMANCE_CORPUS_DIR to point at an existing directory');
    return null;
  }

  const segments = pin.corpus_path.split('/').filter(Boolean).length;
  let root = corpusDir;
  for (let i = 0; i < segments; i++) root = path.dirname(root);

  const head = gitHead(root);
  if (head === null) {
    if (required) fail(`pinned checkout at ${root} is not a git checkout (no resolvable HEAD)`);
    return null;
  }
  if (head !== pin.revision.toLowerCase()) {
    if (required) fail(`pinned checkout HEAD ${head} does not match conformance-corpus-revision.json revision ${pin.revision}`);
    return null;
  }

  return buildSource('pinned', root, pin, corpusDir);
}

function resolveCandidate(pin: CorpusPin): ConformanceSource {
  const root = process.env.CONTENT_AGN_CANDIDATE_CHECKOUT;
  const candidateSha = process.env.CONTENT_AGN_CANDIDATE_SHA;
  if (!root || !candidateSha) {
    fail('CONFORMANCE_SOURCE_MODE=candidate requires both CONTENT_AGN_CANDIDATE_CHECKOUT and CONTENT_AGN_CANDIDATE_SHA');
  }
  if (!fs.existsSync(root)) {
    fail(`candidate checkout directory does not exist: ${root}`);
  }
  const head = gitHead(root);
  if (head === null) {
    fail(`candidate checkout at ${root} is not a git checkout (no resolvable HEAD)`);
  }
  if (head !== candidateSha.toLowerCase()) {
    fail(`candidate checkout HEAD ${head} does not match CONTENT_AGN_CANDIDATE_SHA ${candidateSha}`);
  }

  const corpusDir = path.join(root, pin.corpus_path);
  return buildSource('candidate', root, pin, corpusDir);
}

function resolveAuto(pin: CorpusPin, required: boolean): ConformanceSource | null {
  const fromEnv = process.env.CONFORMANCE_CORPUS_DIR;
  const candidates = [
    fromEnv,
    path.join(__dirname, '..', '..', '..', '..', 'content-agn', pin.corpus_path),
    path.join(__dirname, '..', '..', '..', 'content-agn', pin.corpus_path),
  ].filter((p): p is string => Boolean(p));

  const segments = pin.corpus_path.split('/').filter(Boolean).length;
  for (const corpusDir of candidates) {
    if (fs.existsSync(path.join(corpusDir, 'manifest.json'))) {
      let root = corpusDir;
      for (let i = 0; i < segments; i++) root = path.dirname(root);
      return buildSource('auto', root, pin, corpusDir);
    }
  }

  if (required) fail('CONFORMANCE_REQUIRED=1 but no CONFORMANCE_SOURCE_MODE was set and no content-agn checkout was auto-discovered');
  return null;
}

export function resolveConformanceSource(): ConformanceSource | null {
  const pin = loadPin();
  const required = isRequired();
  const rawMode = process.env.CONFORMANCE_SOURCE_MODE;

  if (rawMode === 'pinned') return resolvePinned(pin, required);
  if (rawMode === 'candidate') return resolveCandidate(pin); // explicit selection: always fatal on failure
  if (rawMode !== undefined) {
    fail(`unrecognized CONFORMANCE_SOURCE_MODE ${JSON.stringify(rawMode)}; expected "pinned" or "candidate"`);
  }
  return resolveAuto(pin, required);
}
