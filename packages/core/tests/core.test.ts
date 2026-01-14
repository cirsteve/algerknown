/**
 * Core Library Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  findRoot,
  init,
  isInsideKnowledgeBase,
  getIndex,
  readEntry,
  writeEntry,
  deleteEntry,
  listEntries,
  validate,
  search,
  filterByTag,
  getLinks,
  addLink,
  removeLink,
  type Summary,
  type Entry,
} from '../src/index.js';

// Use system temp directory for isolated tests
const TEMP_TEST_PATH = path.join(os.tmpdir(), 'algerknown-test-' + Date.now());
const EMPTY_DIR_PATH = path.join(os.tmpdir(), 'algerknown-empty-' + Date.now());

describe('Config Module', () => {
  beforeAll(() => {
    // Create an empty directory that has no .algerknown anywhere in its path
    fs.mkdirSync(EMPTY_DIR_PATH, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(EMPTY_DIR_PATH)) {
      fs.rmSync(EMPTY_DIR_PATH, { recursive: true });
    }
  });

  it('should throw when not inside knowledge base', () => {
    expect(() => findRoot(EMPTY_DIR_PATH)).toThrow(/Not inside an Algerknown knowledge base/);
  });

  it('should detect when not inside knowledge base', () => {
    expect(isInsideKnowledgeBase(EMPTY_DIR_PATH)).toBe(false);
  });

  describe('init', () => {
    beforeAll(() => {
      // Clean up any existing test directory
      if (fs.existsSync(TEMP_TEST_PATH)) {
        fs.rmSync(TEMP_TEST_PATH, { recursive: true });
      }
      fs.mkdirSync(TEMP_TEST_PATH, { recursive: true });
    });

    afterAll(() => {
      // Clean up
      if (fs.existsSync(TEMP_TEST_PATH)) {
        fs.rmSync(TEMP_TEST_PATH, { recursive: true });
      }
    });

    it('should initialize a new knowledge base', () => {
      init(TEMP_TEST_PATH);

      expect(fs.existsSync(path.join(TEMP_TEST_PATH, 'index.yaml'))).toBe(true);  // index.yaml at root
      expect(fs.existsSync(path.join(TEMP_TEST_PATH, '.algerknown'))).toBe(true);
      expect(fs.existsSync(path.join(TEMP_TEST_PATH, '.algerknown', 'schemas'))).toBe(true);
      expect(fs.existsSync(path.join(TEMP_TEST_PATH, 'summaries'))).toBe(true);
      expect(fs.existsSync(path.join(TEMP_TEST_PATH, 'entries'))).toBe(true);
    });

    it('should find root after init', () => {
      const root = findRoot(TEMP_TEST_PATH);
      expect(root).toBe(TEMP_TEST_PATH);
    });

    it('should update schemas when called on existing repo', () => {
      // Delete schemas to simulate cloning a repo without them
      const schemasPath = path.join(TEMP_TEST_PATH, '.algerknown', 'schemas');
      if (fs.existsSync(schemasPath)) {
        fs.rmSync(schemasPath, { recursive: true });
      }
      expect(fs.existsSync(schemasPath)).toBe(false);

      // Re-run init - should restore schemas without error
      init(TEMP_TEST_PATH);

      expect(fs.existsSync(schemasPath)).toBe(true);
      expect(fs.existsSync(path.join(schemasPath, 'summary.schema.json'))).toBe(true);
      expect(fs.existsSync(path.join(schemasPath, 'entry.schema.json'))).toBe(true);
      expect(fs.existsSync(path.join(schemasPath, 'index.schema.json'))).toBe(true);
    });
  });
});

describe('Store Module', () => {
  beforeAll(() => {
    // Ensure test KB exists
    if (!fs.existsSync(path.join(TEMP_TEST_PATH, '.algerknown'))) {
      fs.mkdirSync(TEMP_TEST_PATH, { recursive: true });
      init(TEMP_TEST_PATH);
    }
  });

  afterAll(() => {
    if (fs.existsSync(TEMP_TEST_PATH)) {
      fs.rmSync(TEMP_TEST_PATH, { recursive: true });
    }
  });

  it('should read empty index', () => {
    const index = getIndex(TEMP_TEST_PATH);
    expect(index.version).toBe('1.0.0');
    expect(Object.keys(index.entries)).toHaveLength(0);
  });

  it('should write and read a summary', () => {
    const summary: Summary = {
      id: 'test-summary',
      type: 'summary',
      topic: 'Test Summary',
      status: 'active',
      summary: 'This is a test summary for unit testing.',
      tags: ['test', 'unit-test'],
    };

    writeEntry(summary, TEMP_TEST_PATH);

    const read = readEntry('test-summary', TEMP_TEST_PATH);
    expect(read).not.toBeNull();
    expect(read?.id).toBe('test-summary');
    expect(read?.topic).toBe('Test Summary');
    expect((read as Summary).summary).toBe('This is a test summary for unit testing.');
  });

  it('should write and read an entry', () => {
    const entry: Entry = {
      id: '2026-01-13-test-entry',
      type: 'entry',
      date: '2026-01-13',
      topic: 'Test Entry',
      status: 'active',
      context: 'Testing the store module',
      approach: 'Write unit tests',
      outcome: {
        worked: ['Basic CRUD operations'],
        failed: [],
      },
    };

    writeEntry(entry, TEMP_TEST_PATH);

    const read = readEntry('2026-01-13-test-entry', TEMP_TEST_PATH);
    expect(read).not.toBeNull();
    expect(read?.type).toBe('entry');
    expect((read as Entry).date).toBe('2026-01-13');
  });

  it('should list entries', () => {
    const entries = listEntries(TEMP_TEST_PATH);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.some(e => e.id === 'test-summary')).toBe(true);
    expect(entries.some(e => e.id === '2026-01-13-test-entry')).toBe(true);
  });

  it('should delete an entry', () => {
    const result = deleteEntry('test-summary', TEMP_TEST_PATH);
    expect(result).toBe(true);

    const read = readEntry('test-summary', TEMP_TEST_PATH);
    expect(read).toBeNull();
  });
});

describe('Validator Module', () => {
  beforeAll(() => {
    if (!fs.existsSync(path.join(TEMP_TEST_PATH, '.algerknown'))) {
      fs.mkdirSync(TEMP_TEST_PATH, { recursive: true });
      init(TEMP_TEST_PATH);
    }
  });

  afterAll(() => {
    if (fs.existsSync(TEMP_TEST_PATH)) {
      fs.rmSync(TEMP_TEST_PATH, { recursive: true });
    }
  });

  it('should validate a valid summary', () => {
    const summary: Summary = {
      id: 'valid-summary',
      type: 'summary',
      topic: 'Valid Summary',
      status: 'active',
      summary: 'A valid summary.',
    };

    const result = validate(summary, TEMP_TEST_PATH);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject invalid summary', () => {
    const invalid = {
      id: 'INVALID_ID', // Invalid: uppercase and underscore
      type: 'summary',
      // Missing required fields: topic, status, summary
    };

    const result = validate(invalid as any, TEMP_TEST_PATH);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('Search Module', () => {
  beforeAll(() => {
    if (!fs.existsSync(path.join(TEMP_TEST_PATH, '.algerknown'))) {
      fs.mkdirSync(TEMP_TEST_PATH, { recursive: true });
      init(TEMP_TEST_PATH);
    }

    // Add some entries to search
    const entries: Summary[] = [
      {
        id: 'semaphore-test',
        type: 'summary',
        topic: 'Semaphore Protocol Testing',
        status: 'active',
        summary: 'Testing Semaphore ZK proofs for anonymous surveys.',
        tags: ['zk', 'semaphore', 'privacy'],
      },
      {
        id: 'noir-circuits',
        type: 'summary',
        topic: 'Noir Circuit Development',
        status: 'active',
        summary: 'Building circuits with Noir language.',
        tags: ['noir', 'zk', 'circuits'],
      },
    ];

    for (const entry of entries) {
      writeEntry(entry, TEMP_TEST_PATH);
    }
  });

  afterAll(() => {
    if (fs.existsSync(TEMP_TEST_PATH)) {
      fs.rmSync(TEMP_TEST_PATH, { recursive: true });
    }
  });

  it('should find entries by keyword', () => {
    const results = search('semaphore', TEMP_TEST_PATH);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('semaphore-test');
  });

  it('should find entries by topic', () => {
    const results = search('noir', TEMP_TEST_PATH);
    expect(results.some(r => r.id === 'noir-circuits')).toBe(true);
  });

  it('should filter by tag', () => {
    const results = filterByTag('zk', TEMP_TEST_PATH);
    expect(results.length).toBe(2);
  });

  it('should return empty for no matches', () => {
    const results = search('nonexistent-query-xyz', TEMP_TEST_PATH);
    expect(results).toHaveLength(0);
  });
});

describe('Linker Module', () => {
  beforeAll(() => {
    if (fs.existsSync(TEMP_TEST_PATH)) {
      fs.rmSync(TEMP_TEST_PATH, { recursive: true });
    }
    fs.mkdirSync(TEMP_TEST_PATH, { recursive: true });
    init(TEMP_TEST_PATH);

    // Create entries to link
    writeEntry({
      id: 'source-entry',
      type: 'summary',
      topic: 'Source Entry',
      status: 'active',
      summary: 'The source of links.',
    }, TEMP_TEST_PATH);

    writeEntry({
      id: 'target-entry',
      type: 'summary',
      topic: 'Target Entry',
      status: 'active',
      summary: 'The target of links.',
    }, TEMP_TEST_PATH);
  });

  afterAll(() => {
    if (fs.existsSync(TEMP_TEST_PATH)) {
      fs.rmSync(TEMP_TEST_PATH, { recursive: true });
    }
  });

  it('should add a link', () => {
    const result = addLink('source-entry', 'target-entry', 'references', 'Test link', TEMP_TEST_PATH);
    expect(result).toBe(true);

    const links = getLinks('source-entry', TEMP_TEST_PATH);
    expect(links.length).toBe(1);
    expect(links[0].id).toBe('target-entry');
    expect(links[0].relationship).toBe('references');
  });

  it('should not add duplicate link', () => {
    const result = addLink('source-entry', 'target-entry', 'references', undefined, TEMP_TEST_PATH);
    expect(result).toBe(false);
  });

  it('should remove a link', () => {
    const removed = removeLink('source-entry', 'target-entry', 'references', TEMP_TEST_PATH);
    expect(removed).toBe(1);

    const links = getLinks('source-entry', TEMP_TEST_PATH);
    expect(links.length).toBe(0);
  });
});
