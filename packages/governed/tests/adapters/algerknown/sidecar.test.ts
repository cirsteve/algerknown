import { describe, expect, it } from 'vitest';
import { asNamespaceId } from '../../../src/index.js';
import { ADAPTER_MAPPING_VERSION } from '../../../src/adapters/algerknown/config.js';
import {
  emptySidecar,
  encodeNamespaceForPath,
  parseSidecar,
  serializeSidecar,
  sidecarRelativePath,
  type NamespaceSidecar,
} from '../../../src/adapters/algerknown/sidecar.js';

describe('namespace sidecar', () => {
  it('encodes a dotted namespace into a filesystem-safe basename', () => {
    expect(encodeNamespaceForPath(asNamespaceId('canonical.project.agent-evals'))).toBe('canonical.project.agent-evals');
    expect(encodeNamespaceForPath(asNamespaceId('canonical.project.a/b'))).toBe('canonical.project.a_b');
  });

  it('places the sidecar under .algerknown/governed/namespaces/', () => {
    expect(sidecarRelativePath(asNamespaceId('canonical.project.agent-evals'))).toBe(
      '.algerknown/governed/namespaces/canonical.project.agent-evals.yaml',
    );
  });

  it('starts empty with the current mapping version and no revisions', () => {
    const sidecar = emptySidecar();
    expect(sidecar.mappingVersion).toBe(ADAPTER_MAPPING_VERSION);
    expect(sidecar.revisions).toEqual([]);
    expect(sidecar.edges).toEqual([]);
    expect(sidecar.nodeProvenance).toEqual({});
  });

  it('round-trips through serialize/parse', () => {
    const sidecar: NamespaceSidecar = {
      mappingVersion: 1,
      nodeProvenance: { 'fact-1': { provenance: { sources: [], railId: 'human-gated', evaluatorVerdicts: [] }, revision: { revisionId: 'git:abc', namespaceRevision: 1, createdAt: '2026-01-01T00:00:00.000Z', actorId: 'a', actorClass: 'human' } } },
      edges: [{ id: 'derived_from:a:b', kind: 'derived_from', sourceId: 'a', targetId: 'b', provenance: {}, revision: {} }],
      revisions: [],
    };

    const content = serializeSidecar(sidecar);
    expect(content).toContain('Do not hand-edit');
    expect(parseSidecar(content)).toEqual(sidecar);
  });

  it('parses missing fields as empty defaults (tolerant of a hand-truncated file)', () => {
    const parsed = parseSidecar('mappingVersion: 1\n');
    expect(parsed).toEqual({ mappingVersion: 1, nodeProvenance: {}, edges: [], revisions: [] });
  });
});
