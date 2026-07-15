/**
 * Shared conformance corpus runner.
 *
 * Reads content-agn/conformance/v1/manifest.json and runs every declared
 * case against this package's real validate()/matchesProhibition()/
 * canonicalNormalize()/parsePortableRegex() — the same producer code path
 * used by `agn validate`. See docs/dossier-contract.md for the corpus
 * location, versioning, and how CI pins content-agn's revision.
 *
 * The corpus directory is resolved, in order:
 *   1. CONFORMANCE_CORPUS_DIR env var (what CI sets, pointing at the
 *      revision-pinned content-agn checkout).
 *   2. A sibling checkout: ../../../content-agn/conformance/v1 (algerknown
 *      and content-agn cloned as separate sibling repos).
 *   3. A nested checkout: ../../content-agn/conformance/v1 (this monorepo-
 *      style local arrangement, where content-agn lives inside algerknown/).
 *
 * If none exist, the corpus-dependent tests are skipped with a clear
 * message rather than failing — contributors without a content-agn checkout
 * can still run the rest of the suite. CI always sets the env var (see
 * .github/workflows/ci.yml), so the corpus always runs there.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { validate, matchesProhibition, canonicalNormalize, parsePortableRegex, PortableRegexError } from '../src/index.js';
import type { ValidationError, DossierProhibition } from '../src/index.js';

function resolveCorpusDir(): string | null {
  const fromEnv = process.env.CONFORMANCE_CORPUS_DIR;
  const candidates = [
    fromEnv,
    path.join(__dirname, '..', '..', '..', 'content-agn', 'conformance', 'v1'),
    path.join(__dirname, '..', '..', 'content-agn', 'conformance', 'v1'),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'manifest.json'))) {
      return candidate;
    }
  }
  return null;
}

const CORPUS_DIR = resolveCorpusDir();

interface ManifestFixture {
  id: string;
  kind: 'index' | 'summary' | 'entry';
  file: string;
  expected: { valid: true } | { valid: false; failingStage: 'schema' | 'semantic'; rule: string };
}

interface Manifest {
  version: string;
  schemas: { index: string; summary: string };
  fixtures: ManifestFixture[];
  normalizationVectors: string;
  prohibitionVectors: string;
}

// Maps a dossier ValidationError to the manifest's stable rule identifiers.
// Schema-stage errors always carry an AJV `keyword`; semantic-stage errors
// never do (validateDossier() never sets it). This mirrors, not replaces,
// what a Python runner would do against jsonschema's own error shape: derive
// a stable rule id from (keyword, path-suffix) or (authored message prefix),
// never compare raw error prose across engines.
function classifyRule(errors: ValidationError[]): { stage: 'schema' | 'semantic'; rules: string[] } {
  const schemaErrors = errors.filter(e => e.keyword !== undefined);
  const stage: 'schema' | 'semantic' = schemaErrors.length > 0 ? 'schema' : 'semantic';
  const relevant = stage === 'schema' ? schemaErrors : errors;

  const rules = new Set<string>();
  for (const err of relevant) {
    const p = err.path;
    if (stage === 'schema') {
      if (err.keyword === 'oneOf' && /\/prohibitions\/\d+$/.test(p)) rules.add('dossier.prohibition.matcher-exclusivity');
      else if (err.keyword === 'false schema' && /\/prohibitions\/\d+\/flags$/.test(p)) rules.add('dossier.prohibition.flags-coupling');
      else if (err.keyword === 'enum' && /\/flags$/.test(p)) rules.add('dossier.prohibition.flags-enum');
      else if (err.keyword === 'type' && /\/(exact_phrase|normalized_phrase|regex)$/.test(p)) rules.add('dossier.prohibition.matcher-type');
      else if (err.keyword === 'pattern' && /\/immutable_ref$/.test(p)) rules.add('dossier.evidence.immutable-ref-pattern');
      else if (err.keyword === 'enum' && /\/facts\/\d+\/status$/.test(p)) rules.add('dossier.fact.status-enum');
      else if (err.keyword === 'additionalProperties' && p === '/dossier') rules.add('dossier.additional-properties');
      else if (err.keyword === 'pattern' && /\/canonical_url$/.test(p)) rules.add('dossier.resource.canonical-url-pattern');
    } else {
      if (err.message.includes('Duplicate dossier id')) rules.add('dossier.duplicate-id');
      else if (err.message.includes('is in the future')) rules.add('dossier.future-last-reviewed');
      else if (err.message.includes('does not reference any dossier evidence')) rules.add('dossier.broken-evidence-reference');
      else if (err.message.includes('does not reference any dossier resource') && /\/prohibitions\//.test(p)) rules.add('dossier.broken-resource-reference');
      else if (err.message.includes('does not reference any dossier fact')) rules.add('dossier.broken-gap-fact-reference');
      else if (err.message.includes('does not reference any dossier resource') && /\/known_gaps\//.test(p)) rules.add('dossier.broken-gap-resource-reference');
      else if (err.message.includes('Duplicate safe phrasing')) rules.add('dossier.duplicate-safe-phrasing');
      else if (err.message.includes('Duplicate forbidden phrasing')) rules.add('dossier.duplicate-forbidden-phrasing');
      else if (err.message.includes('Duplicate canonical URL')) rules.add('dossier.duplicate-canonical-url');
      else if (err.message.includes('Portable regex rejected')) rules.add('dossier.nonportable-regex');
    }
  }
  return { stage, rules: [...rules] };
}

function compileSchema(ajv: Ajv2020, schemaPath: string) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  return ajv.compile(schema);
}

// NOTE: describe.runIf()/skipIf() only mark the resulting suite as skipped —
// vitest still calls the describe callback synchronously during collection
// to discover its `it()`s. Since the corpus may not exist (CORPUS_DIR would
// be null), the manifest-loading body below must never run in that case, so
// this is gated with a plain `if` instead of describe.runIf.
if (CORPUS_DIR !== null) {
  const corpusDir = CORPUS_DIR;
  const manifest: Manifest = JSON.parse(fs.readFileSync(path.join(corpusDir, 'manifest.json'), 'utf-8'));

  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  addFormats(ajv);
  const validateIndex = compileSchema(ajv, path.join(corpusDir, manifest.schemas.index));

  describe('conformance corpus (content-agn/conformance/v1)', () => {
    it.each(manifest.fixtures)('fixture $id', (fixture) => {
      const filePath = path.join(corpusDir, fixture.file);
      const doc = yaml.load(fs.readFileSync(filePath, 'utf-8'));

      if (fixture.kind === 'index') {
        const valid = validateIndex(doc);
        expect(valid).toBe(fixture.expected.valid);
        return;
      }

      // summary/entry: exercise the full producer pipeline (schema + semantic)
      // against content-agn's own tracked, deployed schemas.
      const result = validate(doc as never, corpusDir.replace(/\/conformance\/v1$/, ''));
      expect(result.valid).toBe(fixture.expected.valid);

      if (!fixture.expected.valid) {
        const { stage, rules } = classifyRule(result.errors);
        expect(stage, `fixture ${fixture.id}: expected failingStage`).toBe(fixture.expected.failingStage);
        expect(rules, `fixture ${fixture.id}: expected rule ${fixture.expected.rule}, got errors: ${JSON.stringify(result.errors)}`).toContain(fixture.expected.rule);
      }
    });

    it('normalization vectors', () => {
      const vectorsPath = path.join(corpusDir, manifest.normalizationVectors);
      const data = JSON.parse(fs.readFileSync(vectorsPath, 'utf-8')) as { vectors: Array<{ id: string; input: string; expected: string }> };
      for (const v of data.vectors) {
        expect(canonicalNormalize(v.input), `vector ${v.id}`).toBe(v.expected);
      }
    });

    it('prohibition vectors: regex grammar accept/reject', () => {
      const vectorsPath = path.join(corpusDir, manifest.prohibitionVectors);
      const data = JSON.parse(fs.readFileSync(vectorsPath, 'utf-8')) as {
        regexGrammar: Array<{ id: string; pattern: string; accepted: boolean }>;
      };
      for (const v of data.regexGrammar) {
        let accepted = true;
        try {
          parsePortableRegex(v.pattern);
        } catch (err) {
          expect(err, `vector ${v.id}`).toBeInstanceOf(PortableRegexError);
          accepted = false;
        }
        expect(accepted, `vector ${v.id}`).toBe(v.accepted);
      }
    });

    it('prohibition vectors: matcher verdicts', () => {
      const vectorsPath = path.join(corpusDir, manifest.prohibitionVectors);
      const data = JSON.parse(fs.readFileSync(vectorsPath, 'utf-8')) as {
        matchVectors: Array<{
          id: string;
          matcher: { type: 'exact_phrase' | 'normalized_phrase' | 'regex'; pattern: string; flags?: string };
          subject: string;
          expected: boolean;
        }>;
      };
      for (const v of data.matchVectors) {
        const base = { id: 'proh-1', forbidden_phrasings: ['x'], evidence_ids: ['e'] };
        const proh = (
          v.matcher.type === 'exact_phrase'
            ? { ...base, exact_phrase: v.matcher.pattern }
            : v.matcher.type === 'normalized_phrase'
              ? { ...base, normalized_phrase: v.matcher.pattern }
              : { ...base, regex: v.matcher.pattern, ...(v.matcher.flags !== undefined ? { flags: v.matcher.flags } : {}) }
        ) as unknown as DossierProhibition;
        expect(matchesProhibition(proh, v.subject), `vector ${v.id}`).toBe(v.expected);
      }
    });
  });
} else {
  describe('conformance corpus (content-agn/conformance/v1)', () => {
    it.skip('skipped: no content-agn checkout found (set CONFORMANCE_CORPUS_DIR)', () => {});
  });
}
