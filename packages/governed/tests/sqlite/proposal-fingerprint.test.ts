import { describe, expect, it } from 'vitest';
import { computeProposalFingerprint } from '../../src/sqlite/proposal-fingerprint.js';
import { asNamespaceId, asSubjectId } from '../../src/index.js';

describe('computeProposalFingerprint', () => {
  it('is independent of input order even when sources share kind and id but differ only by locator', () => {
    const base = {
      targetNamespace: asNamespaceId('memory.community.topic-1'),
      targetSubject: asSubjectId('subject-1'),
      nodeMutations: [],
      edgeMutations: [],
      supportingObservationIds: [],
    };

    const forward = computeProposalFingerprint({
      ...base,
      sourceReferences: [
        { kind: 'external', id: 'src-1', locator: 'A' },
        { kind: 'external', id: 'src-1', locator: 'B' },
      ],
    });
    const reversed = computeProposalFingerprint({
      ...base,
      sourceReferences: [
        { kind: 'external', id: 'src-1', locator: 'B' },
        { kind: 'external', id: 'src-1', locator: 'A' },
      ],
    });

    expect(forward).toBe(reversed);
  });

  it('still distinguishes sources that differ only by locator', () => {
    const base = {
      targetNamespace: asNamespaceId('memory.community.topic-1'),
      targetSubject: asSubjectId('subject-1'),
      nodeMutations: [],
      edgeMutations: [],
      supportingObservationIds: [],
    };

    const withA = computeProposalFingerprint({ ...base, sourceReferences: [{ kind: 'external', id: 'src-1', locator: 'A' }] });
    const withB = computeProposalFingerprint({ ...base, sourceReferences: [{ kind: 'external', id: 'src-1', locator: 'B' }] });

    expect(withA).not.toBe(withB);
  });
});
