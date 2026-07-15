/**
 * Validator regression + contract tests.
 *
 * Covers the A-002 schema-distribution gap (init() must emit the package's
 * real tracked schemas, byte-for-byte, from both source and built dist), the
 * dossier prohibition oneOf/flags/reference-grammar contract, and the
 * portable-regex + Unicode-normalization + prohibition-matching modules.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  init,
  validate,
  resetValidator,
  matchesProhibition,
  parsePortableRegex,
  PortableRegexError,
  canonicalNormalize,
  type Summary,
  type Dossier,
  type DossierProhibition,
} from '../src/index.js';

const PACKAGE_SCHEMAS_DIR = path.join(__dirname, '..', 'schemas');

function makeTempDir(prefix: string): string {
  const dir = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// The exact fixture and finding reused verbatim from the A-002 verification
// cohort's debrief: dossier.prohibitions[0].exact_phrase is the number 12345
// instead of a string; every other field is valid.
const A002_FIXTURE: Summary = {
  id: 'test-summary-a002',
  type: 'summary',
  topic: 'A-002 repro fixture',
  status: 'active',
  summary: 'Minimal valid summary used to test dossier schema drift (A-002).',
  dossier: {
    project_key: 'test-project',
    last_reviewed: '2026-01-01',
    reviewer: { id: 'reviewer-1', display_name: 'Test Reviewer' },
    evidence: [
      {
        id: 'evidence-1',
        kind: 'git-commit',
        locator: 'some commit',
        immutable_ref: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    ],
    facts: [
      {
        id: 'fact-1',
        claim: 'Example claim',
        status: 'shipped',
        safe_phrasings: ['Example claim'],
        evidence_ids: ['evidence-1'],
      },
    ],
    resources: [],
    prohibitions: [
      {
        id: 'proh-1',
        // @ts-expect-error — intentionally malformed: number instead of string
        exact_phrase: 12345,
        forbidden_phrasings: ['forbidden text'],
        evidence_ids: ['evidence-1'],
      },
    ],
    known_gaps: [],
  },
};

describe('A-002 regression: schema distribution', () => {
  it('rejects the A-002 fixture through a freshly-initialized clean directory, without throwing', () => {
    const dir = makeTempDir('algerknown-a002');
    resetValidator();
    try {
      init(dir);
      let result;
      expect(() => {
        result = validate(A002_FIXTURE, dir);
      }).not.toThrow();
      expect(result!.valid).toBe(false);
      expect(
        result!.errors.some(
          e => e.path === '/dossier/prohibitions/0/exact_phrase' && e.keyword === 'type'
        )
      ).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true });
      resetValidator();
    }
  });

  it('emits summary.schema.json bytes identical to packages/core/schemas/summary.schema.json (source)', () => {
    const dir = makeTempDir('algerknown-a002-bytes');
    try {
      init(dir);
      const emitted = fs.readFileSync(path.join(dir, '.algerknown', 'schemas', 'summary.schema.json'));
      const tracked = fs.readFileSync(path.join(PACKAGE_SCHEMAS_DIR, 'summary.schema.json'));
      expect(emitted.equals(tracked)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('emits index.schema.json and entry.schema.json bytes identical to packages/core/schemas', () => {
    const dir = makeTempDir('algerknown-a002-bytes2');
    try {
      init(dir);
      for (const filename of ['index.schema.json', 'entry.schema.json']) {
        const emitted = fs.readFileSync(path.join(dir, '.algerknown', 'schemas', filename));
        const tracked = fs.readFileSync(path.join(PACKAGE_SCHEMAS_DIR, filename));
        expect(emitted.equals(tracked)).toBe(true);
      }
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('emits identical schema bytes from the built dist package (run `npm run build` first)', () => {
    const distConfigPath = path.join(__dirname, '..', 'dist', 'config.js');
    if (!fs.existsSync(distConfigPath)) {
      throw new Error(
        `${distConfigPath} does not exist — run "npm run build" in packages/core before testing (see package.json "pretest")`
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const distConfig = require(distConfigPath) as { init: (dir: string) => void };
    const dir = makeTempDir('algerknown-a002-dist');
    try {
      distConfig.init(dir);
      const emitted = fs.readFileSync(path.join(dir, '.algerknown', 'schemas', 'summary.schema.json'));
      const tracked = fs.readFileSync(path.join(PACKAGE_SCHEMAS_DIR, 'summary.schema.json'));
      expect(emitted.equals(tracked)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Prohibition matcher structural contract (schema oneOf + flags enum)
// ---------------------------------------------------------------------------

const BASE_DOSSIER: Dossier = {
  project_key: 'test-project',
  last_reviewed: '2026-01-01',
  reviewer: { id: 'reviewer-1', display_name: 'Test Reviewer' },
  evidence: [
    { id: 'evidence-1', kind: 'git-commit', locator: 'x', immutable_ref: 'a'.repeat(40) },
  ],
  facts: [],
  resources: [],
  prohibitions: [],
  known_gaps: [],
};

function summaryWithProhibition(id: string, prohibition: DossierProhibition): Summary {
  return {
    id,
    type: 'summary',
    topic: 'Matcher contract test',
    status: 'active',
    summary: 'Testing matcher contract.',
    dossier: { ...BASE_DOSSIER, prohibitions: [prohibition] },
  };
}

describe('Dossier prohibition matcher contract', () => {
  const KB_DIR = makeTempDir('algerknown-matcher-contract');
  init(KB_DIR);

  afterAll(() => {
    fs.rmSync(KB_DIR, { recursive: true });
    resetValidator();
  });

  it('rejects a prohibition with no matcher present', () => {
    const result = validate(
      summaryWithProhibition('no-matcher', {
        id: 'proh-1',
        forbidden_phrasings: ['x'],
        evidence_ids: ['evidence-1'],
      } as unknown as DossierProhibition),
      KB_DIR
    );
    expect(result.valid).toBe(false);
  });

  it('rejects a prohibition with two matchers present', () => {
    const result = validate(
      summaryWithProhibition('two-matchers', {
        id: 'proh-1',
        exact_phrase: 'x',
        normalized_phrase: 'x',
        forbidden_phrasings: ['x'],
        evidence_ids: ['evidence-1'],
      } as unknown as DossierProhibition),
      KB_DIR
    );
    expect(result.valid).toBe(false);
  });

  it('rejects flags present on a non-regex branch', () => {
    const result = validate(
      summaryWithProhibition('flags-on-exact', {
        id: 'proh-1',
        exact_phrase: 'x',
        flags: 'i',
        forbidden_phrasings: ['x'],
        evidence_ids: ['evidence-1'],
      } as unknown as DossierProhibition),
      KB_DIR
    );
    expect(result.valid).toBe(false);
  });

  it('rejects a wrong-typed regex matcher (not merely presence-checked)', () => {
    const result = validate(
      summaryWithProhibition('wrong-type-regex', {
        id: 'proh-1',
        regex: 12345,
        forbidden_phrasings: ['x'],
        evidence_ids: ['evidence-1'],
      } as unknown as DossierProhibition),
      KB_DIR
    );
    expect(result.valid).toBe(false);
  });

  it('accepts each of the 16 valid flag permutations on the regex branch', () => {
    const flagValues = ['', 'i', 'm', 's', 'im', 'is', 'mi', 'ms', 'si', 'sm', 'ims', 'ism', 'mis', 'msi', 'sim', 'smi'];
    for (const flags of flagValues) {
      const result = validate(
        summaryWithProhibition(`flags-${flags || 'none'}`, {
          id: 'proh-1',
          regex: 'abc',
          ...(flags ? { flags } : {}),
          forbidden_phrasings: ['x'],
          evidence_ids: ['evidence-1'],
        } as unknown as DossierProhibition),
        KB_DIR
      );
      expect(result.valid, `flags=${JSON.stringify(flags)}`).toBe(true);
    }
  });

  it('rejects a flags value with a repeated letter', () => {
    const result = validate(
      summaryWithProhibition('dup-flag', {
        id: 'proh-1',
        regex: 'abc',
        flags: 'ii',
        forbidden_phrasings: ['x'],
        evidence_ids: ['evidence-1'],
      } as unknown as DossierProhibition),
      KB_DIR
    );
    expect(result.valid).toBe(false);
  });

  it('rejects an unsupported flag letter', () => {
    const result = validate(
      summaryWithProhibition('bad-flag', {
        id: 'proh-1',
        regex: 'abc',
        flags: 'g',
        forbidden_phrasings: ['x'],
        evidence_ids: ['evidence-1'],
      } as unknown as DossierProhibition),
      KB_DIR
    );
    expect(result.valid).toBe(false);
  });

  it('rejects a non-portable regex construct at the semantic layer', () => {
    const result = validate(
      summaryWithProhibition('shorthand-class', {
        id: 'proh-1',
        regex: '\\d+',
        forbidden_phrasings: ['x'],
        evidence_ids: ['evidence-1'],
      } as unknown as DossierProhibition),
      KB_DIR
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Portable regex rejected'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Prohibition matching engine
// ---------------------------------------------------------------------------

describe('matchesProhibition', () => {
  it('exact_phrase is a case-sensitive literal substring match', () => {
    const proh = { id: 'proh-1', exact_phrase: 'Foo Bar', forbidden_phrasings: ['x'], evidence_ids: ['e'] } as DossierProhibition;
    expect(matchesProhibition(proh, 'xxFoo Barxx')).toBe(true);
    expect(matchesProhibition(proh, 'xxfoo barxx')).toBe(false);
  });

  it('normalized_phrase matches after canonical normalization of both sides', () => {
    const proh = { id: 'proh-1', normalized_phrase: 'Guaranteed   Uptime', forbidden_phrasings: ['x'], evidence_ids: ['e'] } as DossierProhibition;
    expect(matchesProhibition(proh, 'we offer GUARANTEED uptime here')).toBe(true);
    expect(matchesProhibition(proh, 'no such claim')).toBe(false);
  });

  it('regex matcher searches (not full-matches) the line-normalized subject', () => {
    const proh = { id: 'proh-1', regex: 'foo(bar|baz)', forbidden_phrasings: ['x'], evidence_ids: ['e'] } as DossierProhibition;
    expect(matchesProhibition(proh, 'xxfoobaryy')).toBe(true);
    expect(matchesProhibition(proh, 'xxfoobazyy')).toBe(true);
    expect(matchesProhibition(proh, 'xxfooquxyy')).toBe(false);
  });

  it('regex i flag is ASCII-only case folding, not native Unicode ignoreCase', () => {
    const proh = { id: 'proh-1', regex: 'HELLO', flags: 'i', forbidden_phrasings: ['x'], evidence_ids: ['e'] } as DossierProhibition;
    expect(matchesProhibition(proh, 'say hello world')).toBe(true);
    expect(matchesProhibition(proh, 'say HELLO world')).toBe(true);
  });

  it('regex m flag anchors ^/$ per line after CRLF/CR/U+2028/U+2029 normalization', () => {
    const proh = { id: 'proh-1', regex: '^bar', flags: 'm', forbidden_phrasings: ['x'], evidence_ids: ['e'] } as DossierProhibition;
    expect(matchesProhibition(proh, 'foo\r\nbar')).toBe(true);
    expect(matchesProhibition(proh, 'foobar')).toBe(false);
  });

  it('regex s flag makes dot match line terminators', () => {
    const proh = { id: 'proh-1', regex: 'foo.bar', forbidden_phrasings: ['x'], evidence_ids: ['e'] } as DossierProhibition;
    expect(matchesProhibition(proh, 'foo\nbar')).toBe(false);
    const prohS = { ...proh, flags: 's' } as DossierProhibition;
    expect(matchesProhibition(prohS, 'foo\nbar')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Portable regex grammar
// ---------------------------------------------------------------------------

describe('portable regex grammar', () => {
  it.each([
    ['(?=lookahead)'],
    ['(?!neglookahead)'],
    ['(?<=lookbehind)'],
    ['(?<!neglookbehind)'],
    ['(a)\\1'],
    ['(?<name>a)'],
    ['(?P<name>a)'],
    ['(?i)abc'],
    ['(?i:abc)'],
    ['(?#comment)'],
    ['(?>atomic)'],
    ['a*+'],
    ['a++'],
    ['a?+'],
    ['a{1,2}+'],
    ['\\d+'],
    ['\\D+'],
    ['\\s+'],
    ['\\S+'],
    ['\\w+'],
    ['\\W+'],
    ['\\p{L}'],
    ['\\P{L}'],
    ['\\b'],
    ['\\n'],
    ['\\xFF'],
    ['\\uFFFF'],
    ['\\cA'],
    ['(?(1)yes|no)'],
    ['a\\-b'], // "-" is only a valid escape inside a character class
  ])('rejects %s', (pattern) => {
    expect(() => parsePortableRegex(pattern)).toThrow(PortableRegexError);
  });

  it.each([
    ['literal'],
    ['a.b'],
    ['[a-z]+'],
    ['[^a-z]+'],
    ['(a|b)+'],
    ['(?:a|b)+'],
    ['a{2}'],
    ['a{2,}'],
    ['a{2,4}'],
    ['a*?'],
    ['a+?'],
    ['^anchored$'],
    ['\\.escaped\\*punct'],
    ['[a\\-z]+'], // "-" escaped inside a class is a literal, not a range operator
  ])('accepts %s', (pattern) => {
    expect(() => parsePortableRegex(pattern)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Unicode canonical normalization
// ---------------------------------------------------------------------------

describe('canonicalNormalize', () => {
  it('applies fixed order: line endings, NFKC, full casefold, whitespace collapse, trim', () => {
    expect(canonicalNormalize('  Hello   World  ')).toBe('hello world');
    expect(canonicalNormalize('CRLF\r\nCR\ronly')).toBe('crlf cr only');
    expect(canonicalNormalize('ß')).toBe('ss'); // sharp s full casefold
    expect(canonicalNormalize('ﬁ')).toBe('fi'); // ﬁ ligature: NFKC decomposes, casefold lowercases
    expect(canonicalNormalize('A\u00A0B')).toBe('a b'); // non-ASCII NBSP is Unicode White_Space
  });

  it('is idempotent', () => {
    const once = canonicalNormalize('MiXeD   Case\r\nText');
    expect(canonicalNormalize(once)).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// Versioned $id cross-schema $ref resolution
//
// content-agn's published/deployed schemas carry a versioned $id
// (.../summary.v1.schema.json) distinct from Algerknown's package $id, but
// entry.schema.json (byte-identical to Algerknown's own asset, unversioned)
// still references it via the relative `"summary.schema.json#/$defs/status"`
// $ref. loadSchemas() must resolve this regardless of the deployed summary
// schema's own declared $id.
// ---------------------------------------------------------------------------

describe('cross-schema $ref resolution with a versioned deployed $id', () => {
  it('resolves entry.schema.json -> summary.schema.json#/$defs/status even when summary.schema.json declares a versioned $id', () => {
    const dir = makeTempDir('algerknown-versioned-id');
    try {
      init(dir);
      resetValidator();

      const summarySchemaPath = path.join(dir, '.algerknown', 'schemas', 'summary.schema.json');
      const summarySchema = JSON.parse(fs.readFileSync(summarySchemaPath, 'utf-8'));
      expect(summarySchema.$id).toBe('https://algerknown.dev/schemas/summary.schema.json');
      summarySchema.$id = 'https://algerknown.dev/schemas/summary.v1.schema.json';
      fs.writeFileSync(summarySchemaPath, JSON.stringify(summarySchema, null, 2), 'utf-8');

      const validEntry = {
        id: '2026-01-01-test-entry',
        type: 'entry' as const,
        date: '2026-01-01',
        topic: 'Versioned $id test',
        status: 'active' as const,
      };
      const validResult = validate(validEntry, dir);
      expect(validResult.valid).toBe(true);

      const invalidEntry = { ...validEntry, status: 'not-a-real-status' as unknown as 'active' };
      const invalidResult = validate(invalidEntry, dir);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors.some(e => e.path.includes('status'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true });
      resetValidator();
    }
  });
});
