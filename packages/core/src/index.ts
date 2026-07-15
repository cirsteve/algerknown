/**
 * @algerknown/core
 * Core library for Algerknown knowledge base management
 */

// Types
export type {
  Status,
  Relationship,
  Link,
  Resource,
  DateRange,
  Learning,
  Decision,
  Artifact,
  Outcome,
  Summary,
  Entry,
  AnyEntry,
  IndexEntry,
  Index,
  ValidationError,
  ValidationResult,
  SearchResult,
  DossierFactStatus,
  DossierReviewer,
  DossierEvidence,
  DossierFact,
  DossierResource,
  DossierProhibitionBase,
  DossierProhibitionExact,
  DossierProhibitionNormalized,
  DossierProhibitionRegex,
  DossierProhibition,
  DossierKnownGap,
  Dossier,
  DossierRegexFlags,
} from './types.js';

export { isSummary, isEntry } from './types.js';

// Config
export {
  findRoot,
  init,
  updateSchemas,
  isInsideKnowledgeBase,
  getAlgerknownDir,
  getIndexPath,
  getSchemasDir,
  getSchemaPath,
  getSummariesDir,
  getEntriesDir,
} from './config.js';

// Store
export {
  getIndex,
  saveIndex,
  readEntry,
  writeEntry,
  deleteEntry,
  listEntries,
  readAllEntries,
  entryExists,
  resolveEntryPath,
} from './store.js';

// Index Manager
export {
  addToIndex,
  removeFromIndex,
  getIndexEntry,
  updateIndexPath,
  countByType,
} from './index-manager.js';

// Validator
export {
  validate,
  validateAll,
  isValid,
  formatErrors,
  resetValidator,
} from './validator.js';

// Linker
export {
  addLink,
  removeLink,
  getLinks,
  getBacklinks,
  getRelatedEntries,
  hasLink,
  getInverseRelationship,
} from './linker.js';

// Search
export {
  search,
  filterByTag,
  filterByStatus,
  filterByType,
  getAllTags,
} from './search.js';

// Unicode normalization
export {
  canonicalNormalize,
  fullCaseFold,
  isUnicodeWhiteSpace,
  normalizeSubjectForRegex,
  NORMALIZATION_UNICODE_VERSION,
} from './unicode/normalize.js';

// Portable regex
export {
  parsePortableRegex,
  PortableRegexError,
} from './regex/portable-regex.js';
export {
  compilePortableRegex,
  asciiFold,
} from './regex/compile.js';
export type { PortableRegexFlags, CompiledPortableRegex } from './regex/compile.js';

// Prohibition matching
export { matchesProhibition } from './prohibition.js';

// Governed write boundary
export {
  GOVERNED_BOUNDARY_MANIFEST_RELATIVE_PATH,
  GovernedWriteBoundaryError,
  loadGovernedBoundaryManifest,
  classifyWriteTarget,
  assertWriteAllowed,
} from './governed-boundary.js';
export type {
  WriteBoundaryClassification,
  GovernedBoundaryManifest,
  WriteBoundaryClassificationResult,
} from './governed-boundary.js';
