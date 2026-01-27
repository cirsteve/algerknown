/**
 * Utilities for handling knowledge base path validation
 */

import { Request } from 'express';
import * as core from '@algerknown/core';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Validate that a path is a valid knowledge base directory.
 * Checks that:
 * - Path exists and is a directory
 * - Path contains an index.yaml file (indicating a valid knowledge base)
 * - Path is an absolute path (prevents relative path traversal)
 * 
 * @throws Error if path is invalid
 */
export const validateZkbPath = (zkbPath: string): void => {
  // Require absolute path to prevent directory traversal
  if (!path.isAbsolute(zkbPath)) {
    throw new Error('Knowledge base path must be an absolute path');
  }

  // Check path exists
  if (!fs.existsSync(zkbPath)) {
    throw new Error(`Knowledge base path does not exist: ${zkbPath}`);
  }

  // Check it's a directory
  const stats = fs.statSync(zkbPath);
  if (!stats.isDirectory()) {
    throw new Error(`Knowledge base path is not a directory: ${zkbPath}`);
  }

  // Check for index.yaml to ensure it's a valid knowledge base
  const indexPath = path.join(zkbPath, 'index.yaml');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Not a valid knowledge base (missing index.yaml): ${zkbPath}`);
  }
};

/**
 * Get the knowledge base root path from request.
 * First checks x-zkb-path header (with validation), then falls back to core.findRoot()
 * which checks ALGERKNOWN_KB_ROOT env var and walks up from cwd.
 */
export const getZkbPath = (req: Request): string => {
  const headerPath = req.headers['x-zkb-path'] as string;
  if (headerPath) {
    validateZkbPath(headerPath);
    return headerPath;
  }
  return core.findRoot();
};
