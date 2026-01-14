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
} from './types.js';

export { isSummary, isEntry } from './types.js';

// Config
export {
  findRoot,
  init,
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
