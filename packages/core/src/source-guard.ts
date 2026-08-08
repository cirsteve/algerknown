/**
 * Source Guard Module
 * Centralizes authorization of primer source.path values against
 * ALGERKNOWN_CONTENT_ROOTS. This is the single place that decides whether
 * a source file may be written or read as a primer's source.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Thrown whenever a candidate source path fails authorization.
 */
export class SourcePathError extends Error {}

/**
 * Parse ALGERKNOWN_CONTENT_ROOTS into a list of canonical absolute
 * directories. There is no fallback to the KB root or process cwd -
 * the env var must be set explicitly.
 */
function getContentRoots(): string[] {
  const raw = process.env.ALGERKNOWN_CONTENT_ROOTS;
  if (!raw || raw.trim() === '') {
    throw new SourcePathError(
      `ALGERKNOWN_CONTENT_ROOTS must be set to a ${JSON.stringify(path.delimiter)}-separated list of absolute directories`
    );
  }

  const parts = raw.split(path.delimiter).map(p => p.trim()).filter(p => p.length > 0);
  if (parts.length === 0) {
    throw new SourcePathError(
      'ALGERKNOWN_CONTENT_ROOTS must contain at least one absolute directory'
    );
  }

  return parts.map(part => {
    if (!path.isAbsolute(part)) {
      throw new SourcePathError(`ALGERKNOWN_CONTENT_ROOTS entry is not an absolute path: ${part}`);
    }
    let real: string;
    try {
      real = fs.realpathSync(part);
    } catch {
      throw new SourcePathError(`ALGERKNOWN_CONTENT_ROOTS directory does not exist: ${part}`);
    }
    if (!fs.statSync(real).isDirectory()) {
      throw new SourcePathError(`ALGERKNOWN_CONTENT_ROOTS entry is not a directory: ${part}`);
    }
    return real;
  });
}

/**
 * Separator-safe containment check: a root only contains a candidate if
 * the candidate equals the root or starts with root + path separator.
 * This rejects similarly-prefixed sibling directories (e.g. /allowed vs
 * /allowed-other) that a naive startsWith(root) check would admit.
 */
function isContainedIn(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

/**
 * Authorize a primer source.path for write or read.
 *
 * - sourcePath must be an absolute path (no normalization is performed here;
 *   callers are responsible for persisting canonical absolute paths).
 * - Resolves symlinks via realpath for both the configured roots and the
 *   candidate, so an in-root symlink that escapes to an outside file is
 *   rejected.
 * - Requires the resolved candidate to exist and be a regular file.
 *
 * @returns the canonical (realpath'd) absolute path on success
 * @throws SourcePathError if the path is not authorized
 */
export function assertAllowedSourcePath(sourcePath: string): string {
  if (!path.isAbsolute(sourcePath)) {
    throw new SourcePathError(`source.path must be an absolute path: ${sourcePath}`);
  }

  const roots = getContentRoots();

  let real: string;
  try {
    real = fs.realpathSync(sourcePath);
  } catch {
    throw new SourcePathError(`source.path does not exist: ${sourcePath}`);
  }

  if (!fs.statSync(real).isFile()) {
    throw new SourcePathError(`source.path is not a regular file: ${sourcePath}`);
  }

  const allowed = roots.some(root => isContainedIn(root, real));
  if (!allowed) {
    throw new SourcePathError(
      `source.path is not within an allowed ALGERKNOWN_CONTENT_ROOTS directory: ${sourcePath}`
    );
  }

  return real;
}
