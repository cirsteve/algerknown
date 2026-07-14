import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse } from 'yaml';
import { validate, resetValidator, init, type Summary } from '@algerknown/core';
import { extractApprovedShaFromHandoffContent, gitBlobHash, loadFixtureManifest, readApprovedFixtureShaFromHandoff, readSnapshot } from './loader.js';

describe('cohort-1 dossier compatibility fixture', () => {
  const manifest = loadFixtureManifest();

  it('records a well-formed 40-character source commit SHA', () => {
    expect(manifest.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('rejects the fixture unless the recorded commit carries explicit human approval in its handoff', () => {
    const approvedSha = readApprovedFixtureShaFromHandoff();
    expect(manifest.sourceCommit).toBe(approvedSha);
  });

  it('extracts the approved SHA from a CRLF-terminated handoff (platform-independent)', () => {
    const sha = 'a'.repeat(40);
    const crlfContent = `# heading\r\n\r\n\`\`\`\r\n${sha}\r\n\`\`\`\r\n`;
    expect(extractApprovedShaFromHandoffContent(crlfContent)).toBe(sha);
  });

  for (const dossier of manifest.dossiers) {
    it(`vendored snapshot for ${dossier.summaryId} matches its recorded blob hash`, () => {
      const content = readSnapshot(dossier);
      expect(gitBlobHash(content)).toBe(dossier.blobSha);
    });
  }

  describe('semantic validation through @algerknown/core', () => {
    const kbRoot = path.join(os.tmpdir(), 'algerknown-governed-fixture-validate-' + Date.now());

    beforeAll(() => {
      fs.mkdirSync(kbRoot, { recursive: true });
      init(kbRoot);
      resetValidator();
    });

    afterAll(() => {
      fs.rmSync(kbRoot, { recursive: true, force: true });
      resetValidator();
    });

    for (const dossier of manifest.dossiers) {
      it(`${dossier.summaryId} validates with 0 errors`, () => {
        const content = readSnapshot(dossier);
        const entry = parse(content) as Summary;
        const result = validate(entry, kbRoot);
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
      });
    }
  });
});
