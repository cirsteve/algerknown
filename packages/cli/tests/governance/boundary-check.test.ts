import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { init, writeEntry, type Summary } from '@algerknown/core';
import { checkGovernedTarget } from '../../src/governance/boundary-check.js';

const ROOT = path.join(os.tmpdir(), `agn-cli-boundary-${Date.now()}`);

function makeSummary(id: string): Summary {
  return { id, type: 'summary', topic: 'T', status: 'active', summary: 'S' };
}

describe('checkGovernedTarget', () => {
  beforeEach(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    init(ROOT);
  });

  afterEach(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
  });

  it('reports legacy_ungoverned for an entry with no manifest', () => {
    writeEntry(makeSummary('legacy-1'), ROOT);
    expect(checkGovernedTarget('legacy-1', ROOT)).toEqual({ governed: false });
  });

  it('reports not-governed for an entry that does not exist yet', () => {
    expect(checkGovernedTarget('does-not-exist', ROOT)).toEqual({ governed: false });
  });

  it('reports governed with namespace when the manifest lists the entry', () => {
    writeEntry(makeSummary('governed-1'), ROOT);
    const manifestPath = path.join(ROOT, '.algerknown', 'governed-boundary.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        version: 1,
        generatedAt: new Date(0).toISOString(),
        managedPaths: ['summaries/governed-1.yaml'],
        namespaces: { 'summaries/governed-1.yaml': 'canonical.project.demo' },
      }),
    );
    expect(checkGovernedTarget('governed-1', ROOT)).toEqual({ governed: true, namespace: 'canonical.project.demo' });
  });
});
