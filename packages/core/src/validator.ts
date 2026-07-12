/**
 * Validator Module
 * JSON Schema validation using AJV with cross-schema reference support,
 * plus a semantic validation pass for dossier cross-record constraints.
 */

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AnyEntry, ValidationResult, ValidationError, Summary, Dossier, DossierEvidence, DossierFact, DossierResource, DossierProhibition, DossierKnownGap } from './types.js';
import { findRoot, getSchemasDir } from './config.js';

// Singleton AJV instance (lazy-loaded per root)
let ajvInstance: Ajv2020 | null = null;
let loadedRoot: string | null = null;

// Patterns for recognising genuinely immutable references.
// Accepts: 40-char hex git SHA, sha256:hex digest, DOI, versioned arXiv id, or Wayback Machine snapshot URL.
const IMMUTABLE_REF_PATTERN =
  /^(?:[0-9a-f]{40}|sha256:[0-9a-f]{64}|10\.\d{4,}\/\S+|[0-9]{4}\.\d{4,5}v\d+|https:\/\/web\.archive\.org\/web\/\d{14}\/)/i;

// Permitted regex flags
const PERMITTED_FLAGS = new Set(['i', 'm', 's']);

/**
 * Load all schemas from the .algerknown/schemas directory
 */
function loadSchemas(root: string): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: true,
  });
  addFormats(ajv);

  const schemasDir = getSchemasDir(root);

  if (!fs.existsSync(schemasDir)) {
    throw new Error(`Schemas directory not found: ${schemasDir}`);
  }

  // Load all schema files
  const schemaFiles = fs.readdirSync(schemasDir).filter(f => f.endsWith('.schema.json'));

  for (const file of schemaFiles) {
    const schemaPath = path.join(schemasDir, file);
    const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
    const schema = JSON.parse(schemaContent);

    // Add schema with its filename as the key for $ref resolution
    ajv.addSchema(schema, file);
  }

  return ajv;
}

/**
 * Get or create AJV instance for the given root
 */
function getAjv(root: string): Ajv2020 {
  if (ajvInstance && loadedRoot === root) {
    return ajvInstance;
  }

  ajvInstance = loadSchemas(root);
  loadedRoot = root;
  return ajvInstance;
}

/**
 * Reset the cached AJV instance (useful for testing)
 */
export function resetValidator(): void {
  ajvInstance = null;
  loadedRoot = null;
}

// ---------------------------------------------------------------------------
// Dossier semantic validation
// ---------------------------------------------------------------------------

function normPhrase(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return raw;
  }
}

function validateDossier(dossier: Dossier, basePath: string): ValidationError[] {
  const errors: ValidationError[] = [];

  // Collect all ids for global duplicate check
  const allIds = new Map<string, string>(); // id -> path

  // Future-date check
  const today = new Date().toISOString().slice(0, 10);
  if (dossier.last_reviewed > today) {
    errors.push({
      path: `${basePath}/last_reviewed`,
      message: `last_reviewed (${dossier.last_reviewed}) is in the future`,
    });
  }

  // --- Evidence ---
  const evidenceIds = new Set<string>();
  for (let i = 0; i < dossier.evidence.length; i++) {
    const ev: DossierEvidence = dossier.evidence[i];
    const p = `${basePath}/evidence/${i}`;

    if (allIds.has(ev.id)) {
      errors.push({ path: `${p}/id`, message: `Duplicate dossier id: ${ev.id} (also at ${allIds.get(ev.id)})` });
    } else {
      allIds.set(ev.id, `${p}/id`);
    }
    evidenceIds.add(ev.id);

    if (!IMMUTABLE_REF_PATTERN.test(ev.immutable_ref)) {
      errors.push({
        path: `${p}/immutable_ref`,
        message: `immutable_ref "${ev.immutable_ref}" does not satisfy immutability requirements (must be a 40-char git SHA, sha256: digest, DOI, versioned arXiv id, or Wayback Machine snapshot URL)`,
      });
    }
  }

  // --- Facts ---
  const factIds = new Set<string>();
  const seenSafePhrasings = new Set<string>();
  for (let i = 0; i < dossier.facts.length; i++) {
    const fact: DossierFact = dossier.facts[i];
    const p = `${basePath}/facts/${i}`;

    if (allIds.has(fact.id)) {
      errors.push({ path: `${p}/id`, message: `Duplicate dossier id: ${fact.id} (also at ${allIds.get(fact.id)})` });
    } else {
      allIds.set(fact.id, `${p}/id`);
    }
    factIds.add(fact.id);

    for (let j = 0; j < fact.safe_phrasings.length; j++) {
      const norm = normPhrase(fact.safe_phrasings[j]);
      if (seenSafePhrasings.has(norm)) {
        errors.push({
          path: `${p}/safe_phrasings/${j}`,
          message: `Duplicate safe phrasing after normalization: "${norm}"`,
        });
      }
      seenSafePhrasings.add(norm);
    }

    for (let j = 0; j < fact.evidence_ids.length; j++) {
      if (!evidenceIds.has(fact.evidence_ids[j])) {
        errors.push({
          path: `${p}/evidence_ids/${j}`,
          message: `evidence_id "${fact.evidence_ids[j]}" does not reference any dossier evidence record`,
        });
      }
    }
  }

  // --- Resources ---
  const resourceIds = new Set<string>();
  const seenCanonicalUrls = new Map<string, string>();
  for (let i = 0; i < dossier.resources.length; i++) {
    const res: DossierResource = dossier.resources[i];
    const p = `${basePath}/resources/${i}`;

    if (allIds.has(res.id)) {
      errors.push({ path: `${p}/id`, message: `Duplicate dossier id: ${res.id} (also at ${allIds.get(res.id)})` });
    } else {
      allIds.set(res.id, `${p}/id`);
    }
    resourceIds.add(res.id);

    const cUrl = canonicalUrl(res.canonical_url);
    if (seenCanonicalUrls.has(cUrl)) {
      errors.push({
        path: `${p}/canonical_url`,
        message: `Duplicate canonical URL after normalization: "${cUrl}" (also at ${seenCanonicalUrls.get(cUrl)})`,
      });
    }
    seenCanonicalUrls.set(cUrl, `${p}/canonical_url`);

    for (let j = 0; j < res.evidence_ids.length; j++) {
      if (!evidenceIds.has(res.evidence_ids[j])) {
        errors.push({
          path: `${p}/evidence_ids/${j}`,
          message: `evidence_id "${res.evidence_ids[j]}" does not reference any dossier evidence record`,
        });
      }
    }
  }

  // --- Prohibitions ---
  const seenForbiddenPhrasings = new Set<string>();
  for (let i = 0; i < dossier.prohibitions.length; i++) {
    const proh: DossierProhibition = dossier.prohibitions[i];
    const p = `${basePath}/prohibitions/${i}`;

    if (allIds.has(proh.id)) {
      errors.push({ path: `${p}/id`, message: `Duplicate dossier id: ${proh.id} (also at ${allIds.get(proh.id)})` });
    } else {
      allIds.set(proh.id, `${p}/id`);
    }

    // Exactly one matcher must be present
    const matchers = ['exact_phrase', 'normalized_phrase', 'regex'] as const;
    const prohObj = proh as unknown as Record<string, unknown>;
    const presentMatchers = matchers.filter(m => prohObj[m] !== undefined);
    if (presentMatchers.length !== 1) {
      errors.push({
        path: p,
        message: `Prohibition must have exactly one matcher (exact_phrase, normalized_phrase, or regex); found: ${presentMatchers.length === 0 ? 'none' : presentMatchers.join(', ')}`,
      });
    }

    // Regex-specific checks
    if ('regex' in proh && proh.regex !== undefined) {
      const flags = (proh as { flags?: string }).flags ?? '';
      for (const ch of flags) {
        if (!PERMITTED_FLAGS.has(ch)) {
          errors.push({
            path: `${p}/flags`,
            message: `Unsupported regex flag "${ch}"; only i, m, s are permitted`,
          });
        }
      }
      try {
        new RegExp(proh.regex, flags);
      } catch (err) {
        errors.push({
          path: `${p}/regex`,
          message: `Regex compilation failed: ${(err as Error).message}`,
        });
      }
    }

    for (let j = 0; j < proh.forbidden_phrasings.length; j++) {
      const norm = normPhrase(proh.forbidden_phrasings[j]);
      if (seenForbiddenPhrasings.has(norm)) {
        errors.push({
          path: `${p}/forbidden_phrasings/${j}`,
          message: `Duplicate forbidden phrasing after normalization: "${norm}"`,
        });
      }
      seenForbiddenPhrasings.add(norm);
    }

    for (let j = 0; j < proh.evidence_ids.length; j++) {
      if (!evidenceIds.has(proh.evidence_ids[j])) {
        errors.push({
          path: `${p}/evidence_ids/${j}`,
          message: `evidence_id "${proh.evidence_ids[j]}" does not reference any dossier evidence record`,
        });
      }
    }

    const prohWithResourceIds = proh as { resource_ids?: string[] };
    if (prohWithResourceIds.resource_ids) {
      for (let j = 0; j < prohWithResourceIds.resource_ids.length; j++) {
        if (!resourceIds.has(prohWithResourceIds.resource_ids[j])) {
          errors.push({
            path: `${p}/resource_ids/${j}`,
            message: `resource_id "${prohWithResourceIds.resource_ids[j]}" does not reference any dossier resource`,
          });
        }
      }
    }
  }

  // --- Known Gaps ---
  for (let i = 0; i < dossier.known_gaps.length; i++) {
    const gap: DossierKnownGap = dossier.known_gaps[i];
    const p = `${basePath}/known_gaps/${i}`;

    if (allIds.has(gap.id)) {
      errors.push({ path: `${p}/id`, message: `Duplicate dossier id: ${gap.id} (also at ${allIds.get(gap.id)})` });
    } else {
      allIds.set(gap.id, `${p}/id`);
    }

    if (gap.related_fact_ids) {
      for (let j = 0; j < gap.related_fact_ids.length; j++) {
        if (!factIds.has(gap.related_fact_ids[j])) {
          errors.push({
            path: `${p}/related_fact_ids/${j}`,
            message: `related_fact_id "${gap.related_fact_ids[j]}" does not reference any dossier fact`,
          });
        }
      }
    }

    if (gap.related_resource_ids) {
      for (let j = 0; j < gap.related_resource_ids.length; j++) {
        if (!resourceIds.has(gap.related_resource_ids[j])) {
          errors.push({
            path: `${p}/related_resource_ids/${j}`,
            message: `related_resource_id "${gap.related_resource_ids[j]}" does not reference any dossier resource`,
          });
        }
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate an entry against its schema
 *
 * @param entry - Entry to validate
 * @param root - Knowledge base root (optional)
 * @returns Validation result with errors if any
 */
export function validate(entry: AnyEntry, root?: string): ValidationResult {
  const kbRoot = root ?? findRoot();
  const ajv = getAjv(kbRoot);

  // Determine which schema to use
  const schemaFile = entry.type === 'summary'
    ? 'summary.schema.json'
    : 'entry.schema.json';

  const validateFn = ajv.getSchema(schemaFile);

  if (!validateFn) {
    return {
      valid: false,
      errors: [{
        path: '/',
        message: `Schema not found: ${schemaFile}`,
      }],
    };
  }

  const valid = validateFn(entry);

  if (!valid) {
    const errors: ValidationError[] = (validateFn.errors ?? []).map(err => ({
      path: err.instancePath || '/',
      message: err.message ?? 'Unknown validation error',
      keyword: err.keyword,
    }));
    return { valid: false, errors };
  }

  // Semantic validation pass for dossiers
  if (entry.type === 'summary' && (entry as Summary).dossier) {
    const semanticErrors = validateDossier((entry as Summary).dossier!, '/dossier');
    if (semanticErrors.length > 0) {
      return { valid: false, errors: semanticErrors };
    }
  }

  return { valid: true, errors: [] };
}

/**
 * Validate all entries in the knowledge base
 *
 * @param root - Knowledge base root (optional)
 * @returns Map of entry ID to validation result
 */
export function validateAll(root?: string): Map<string, ValidationResult> {
  const kbRoot = root ?? findRoot();

  // Import here to avoid circular dependency
  const { readAllEntries } = require('./store.js');
  const entries = readAllEntries(kbRoot) as AnyEntry[];

  const results = new Map<string, ValidationResult>();

  for (const entry of entries) {
    results.set(entry.id, validate(entry, kbRoot));
  }

  return results;
}

/**
 * Check if an entry is valid (convenience function)
 */
export function isValid(entry: AnyEntry, root?: string): boolean {
  return validate(entry, root).valid;
}

/**
 * Format validation errors for display
 */
export function formatErrors(result: ValidationResult): string[] {
  return result.errors.map(err => {
    const location = err.path || 'root';
    return `${location}: ${err.message}`;
  });
}
