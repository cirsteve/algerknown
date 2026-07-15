import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_NAMESPACE_TABLE,
  NamespaceMatcher,
  asNamespaceId,
  type PreparedWrite,
  type Repository,
} from '@algerknown/governed';
import { createRoutingRepository, RepositoryEngineUnavailableError } from '../../src/server/governance/routing-repository.js';

function repositoryWithRevision(revision: number): Repository {
  return {
    getNamespaceRevision: vi.fn(async () => revision),
    getNode: vi.fn(async () => undefined),
    getEdge: vi.fn(async () => undefined),
    findByIdempotencyKey: vi.fn(async () => undefined),
    getRevision: vi.fn(async () => undefined),
    commit: vi.fn(async (_write: PreparedWrite) => undefined),
    listRevisionsSince: vi.fn(async () => []),
  };
}

describe('governance repository routing', () => {
  const matcher = new NamespaceMatcher(DEFAULT_NAMESPACE_TABLE);

  it('routes declarative SQLite memory namespaces to the shared SQLite repository', async () => {
    const sqlite = repositoryWithRevision(7);
    const git = repositoryWithRevision(11);
    const routed = createRoutingRepository(matcher, new Map([['canonical.project.demo', git]]), sqlite);

    await expect(routed.getNamespaceRevision(asNamespaceId('memory.global'))).resolves.toBe(7);
    await expect(routed.getNamespaceRevision(asNamespaceId('memory.project.demo'))).resolves.toBe(7);
    expect(sqlite.getNamespaceRevision).toHaveBeenCalledTimes(2);
    expect(git.getNamespaceRevision).not.toHaveBeenCalled();
  });

  it('routes a bound Algerknown namespace to its dossier repository', async () => {
    const sqlite = repositoryWithRevision(7);
    const git = repositoryWithRevision(11);
    const routed = createRoutingRepository(matcher, new Map([['canonical.project.demo', git]]), sqlite);

    await expect(routed.getNamespaceRevision(asNamespaceId('canonical.project.demo'))).resolves.toBe(11);
    expect(git.getNamespaceRevision).toHaveBeenCalledOnce();
    expect(sqlite.getNamespaceRevision).not.toHaveBeenCalled();
  });

  it('fails closed when an Algerknown namespace has no configured binding', () => {
    const routed = createRoutingRepository(matcher, new Map(), repositoryWithRevision(7));

    expect(() => routed.getNamespaceRevision(asNamespaceId('canonical.project.unbound'))).toThrow(RepositoryEngineUnavailableError);
  });
});
