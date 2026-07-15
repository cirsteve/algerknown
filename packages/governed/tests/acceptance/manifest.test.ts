import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM script, no .d.ts; shape asserted below.
import { REQUIRED_CHECKS } from '../../../../scripts/governance/acceptance-manifest.mjs';

interface RequiredCheck {
  id: string;
  kind: 'exit-criterion' | 'invariant';
  title: string;
  description: string;
  requiredCases?: string[];
}

const checks = REQUIRED_CHECKS as RequiredCheck[];

/**
 * Locks the shape of the Phase 2 closure manifest: exactly the eight exit
 * criteria and five structural invariants named in the closure brief, each
 * with a unique id. scripts/governance/build-acceptance-report.mjs treats
 * this list as the complete required set -- a narrower list here would
 * silently let `npm run test:phase2` pass on partial coverage.
 */
describe('phase 2 acceptance manifest', () => {
  it('declares exactly 8 exit criteria and 5 structural invariants', () => {
    const exitCriteria = checks.filter((c) => c.kind === 'exit-criterion');
    const invariants = checks.filter((c) => c.kind === 'invariant');
    expect(exitCriteria).toHaveLength(8);
    expect(invariants).toHaveLength(5);
    expect(checks).toHaveLength(13);
  });

  it('every check has a unique id', () => {
    const ids = checks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every check has a non-empty title and description', () => {
    for (const check of checks) {
      expect(check.title.length).toBeGreaterThan(0);
      expect(check.description.length).toBeGreaterThan(0);
    }
  });

  it('every requiredCases entry (when present) is non-empty and has unique case ids', () => {
    for (const check of checks) {
      if (check.requiredCases === undefined) continue;
      expect(check.requiredCases.length).toBeGreaterThan(0);
      expect(new Set(check.requiredCases).size).toBe(check.requiredCases.length);
    }
  });

  it('includes every named exit criterion from the closure brief', () => {
    const ids = checks.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'ec1-structural-rails',
        'ec2-lifecycle-attribution-reversal',
        'ec3-backend-conformance',
        'ec4-pinned-dossier-update',
        'ec5-read-model-rebuild',
        'ec6-restart-crash-recovery',
        'ec7-authenticated-boundary',
        'ec8-no-write-bypass',
        'inv1-no-side-effects-on-reject',
        'inv2-operation-sink-append-only',
        'inv3-audit-sampling-durable',
        'inv4-stale-conflict-integrity',
        'inv5-idempotent-duplicate-acceptance',
      ]),
    );
  });
});
