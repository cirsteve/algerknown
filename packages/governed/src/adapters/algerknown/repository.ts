import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseDocument } from 'yaml';
import { formatErrors, validate, type Dossier, type Summary } from '@algerknown/core';
import type { EdgeId, IdempotencyKey, NamespaceId, NodeId, RevisionId } from '../../domain/ids.js';
import { asActorId, asEdgeId, asNodeId, asRevisionId } from '../../domain/ids.js';
import type { EdgeKind, GovernedEdge } from '../../domain/edge.js';
import type { GovernedNode } from '../../domain/node.js';
import type { Provenance } from '../../domain/provenance.js';
import type { RevisionMeta } from '../../domain/revision.js';
import type { PreparedWrite, Repository, RevisionRecord } from '../../ports/repository.js';
import { ADAPTER_MAPPING_VERSION, type DossierBinding, namespaceForBinding, subjectForBinding } from './config.js';
import { isNativeEdgeKind } from './edge-ids.js';
import {
  applyGovernedDeltaToDossier,
  mapDossierToGoverned,
  type AttributionResolver,
  type RecordAttribution,
  type ResolvedEdgeDeletion,
} from './mapping.js';
import {
  emptySidecar,
  encodeNamespaceForPath,
  parseSidecar,
  serializeSidecar,
  sidecarRelativePath,
  type NamespaceSidecar,
  type SidecarEdgeRecord,
} from './sidecar.js';
import {
  commitManagedFiles,
  gitAdd,
  gitCommitDate,
  gitCurrentBranch,
  gitLastCommitTouching,
  gitRevParse,
  gitShow,
  isWorkingTreeDirty,
  writeFileAtomic,
  type CommitTrailer,
} from './git.js';

export interface GitAlgerknownRepositoryOptions {
  /** Root of the git-tracked Algerknown knowledge base checkout this dossier lives in. */
  repoRoot: string;
  /** Explicit dossier binding: project key, Summary id, and its existing indexed file path. */
  binding: DossierBinding;
  /** Root containing .algerknown/schemas for @algerknown/core validation; defaults to repoRoot. */
  kbRoot?: string;
  /** Branch to commit onto; defaults to the repository's current branch at construction time. */
  branch?: string;
}

interface RecoveryMarker {
  parentSha: string | null;
  paths: string[];
  previousContent: (string | null)[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serves one existing dossier-capable Algerknown Summary as canonical.project.<key>
 * governed nodes, backed entirely by git commits against the dossier file it
 * already lives in plus a namespace metadata sidecar. See mapping.ts for the
 * content translation and git.ts for the underlying commit/materialization
 * mechanics; this class wires them into the governed Repository port.
 */
export class GitAlgerknownRepository implements Repository {
  private readonly repoRoot: string;
  private readonly binding: DossierBinding;
  private readonly kbRoot: string;
  private readonly branch: string;
  private readonly namespace: NamespaceId;
  private readonly subject;
  private readonly dossierRelPath: string;
  private readonly sidecarRelPath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: GitAlgerknownRepositoryOptions) {
    this.repoRoot = options.repoRoot;
    this.binding = options.binding;
    this.kbRoot = options.kbRoot ?? options.repoRoot;
    this.namespace = namespaceForBinding(options.binding);
    this.subject = subjectForBinding(options.binding);
    this.dossierRelPath = options.binding.path;
    this.sidecarRelPath = sidecarRelativePath(this.namespace);
    this.branch = options.branch ?? gitCurrentBranch(options.repoRoot);
  }

  private assertNamespace(namespace: NamespaceId): void {
    if (namespace !== this.namespace) {
      throw new Error(`this GitAlgerknownRepository instance is bound to namespace "${this.namespace}", not "${namespace}"`);
    }
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async getNamespaceRevision(namespace: NamespaceId): Promise<number | null> {
    this.assertNamespace(namespace);
    this.recoverIfNeeded();
    const sidecar = this.readSidecarOrUndefined();
    if (!sidecar || sidecar.revisions.length === 0) return null;
    return sidecar.revisions[sidecar.revisions.length - 1]!.namespaceRevision;
  }

  async getNode(namespace: NamespaceId, nodeId: NodeId): Promise<GovernedNode | undefined> {
    this.assertNamespace(namespace);
    this.recoverIfNeeded();
    const { nodes } = this.mapCurrent();
    return nodes.find((n) => n.id === nodeId);
  }

  async getEdge(namespace: NamespaceId, edgeId: EdgeId): Promise<GovernedEdge | undefined> {
    this.assertNamespace(namespace);
    this.recoverIfNeeded();
    const { edges } = this.mapCurrent();
    const native = edges.find((e) => e.id === edgeId);
    if (native) return native;

    const sidecar = this.readSidecar();
    const stored = sidecar.edges.find((e) => e.id === String(edgeId));
    if (!stored) return undefined;
    return {
      id: asEdgeId(stored.id),
      kind: stored.kind as EdgeKind,
      namespace: this.namespace,
      sourceId: asNodeId(stored.sourceId),
      targetId: asNodeId(stored.targetId),
      provenance: stored.provenance as Provenance,
      revision: stored.revision as RevisionMeta,
    };
  }

  /** Also doubles as the recovery-seam lookup: an external coordinator (e.g. a durable proposal service) can call this directly to check whether an idempotency key already landed, without going through the write orchestrator. */
  async findByIdempotencyKey(namespace: NamespaceId, key: IdempotencyKey): Promise<RevisionRecord | undefined> {
    this.assertNamespace(namespace);
    this.recoverIfNeeded();
    const sidecar = this.readSidecar();
    return sidecar.revisions.find((r) => r.idempotencyKey === key);
  }

  async getRevision(namespace: NamespaceId, revisionId: RevisionId): Promise<RevisionRecord | undefined> {
    this.assertNamespace(namespace);
    this.recoverIfNeeded();
    const sidecar = this.readSidecar();
    return sidecar.revisions.find((r) => r.revisionId === revisionId);
  }

  async listRevisionsSince(namespace: NamespaceId, sinceRevision: number): Promise<RevisionRecord[]> {
    this.assertNamespace(namespace);
    this.recoverIfNeeded();
    const sidecar = this.readSidecar();
    return sidecar.revisions.filter((r) => r.namespaceRevision > sinceRevision).sort((a, b) => a.namespaceRevision - b.namespaceRevision);
  }

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  async commit(write: PreparedWrite): Promise<void> {
    this.assertNamespace(write.namespace);
    await this.withLock(async () => {
      const release = await this.acquireFileLock();
      try {
        await this.commitLocked(write);
      } finally {
        release();
      }
    });
  }

  private withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(() => fn());
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private lockPath(): string {
    return path.join(this.repoRoot, '.algerknown/governed/.locks', `${encodeNamespaceForPath(this.namespace)}.lock`);
  }

  private async acquireFileLock(): Promise<() => void> {
    const lockPath = this.lockPath();
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const deadline = Date.now() + 5000;
    for (;;) {
      try {
        const fd = fs.openSync(lockPath, 'wx');
        fs.writeSync(fd, String(process.pid));
        fs.closeSync(fd);
        return () => {
          fs.rmSync(lockPath, { force: true });
        };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for namespace lock at ${lockPath}`);
        }
        await sleep(20);
      }
    }
  }

  private async commitLocked(write: PreparedWrite): Promise<void> {
    this.recoverIfNeeded();

    if (isWorkingTreeDirty(this.repoRoot, [this.dossierRelPath, this.sidecarRelPath])) {
      throw new Error(
        `refusing to write: "${this.dossierRelPath}" or its namespace sidecar has unmanaged, uncommitted changes`,
      );
    }

    const parentSha = gitRevParse(this.repoRoot, this.branch);
    const { doc, summary } = this.readCurrentSummaryDoc();
    const currentDossier = summary.dossier;
    if (!currentDossier) {
      throw new Error(`Summary "${this.binding.summaryId}" at ${this.binding.path} has no dossier to govern`);
    }

    const sidecar = this.readSidecar();
    const currentNamespaceRevision = sidecar.revisions.length > 0 ? sidecar.revisions[sidecar.revisions.length - 1]!.namespaceRevision : null;
    if (write.previousRevision !== currentNamespaceRevision) {
      throw new Error(
        `stale write: expected previous namespace revision ${write.previousRevision}, but the namespace is currently at ${currentNamespaceRevision}`,
      );
    }

    const resolvedDeletions = this.resolveEdgeDeletions(write.edgesDeleted, sidecar, currentDossier);

    const nextDossier = applyGovernedDeltaToDossier(
      currentDossier,
      write.nodesUpserted,
      write.nodesDeleted,
      write.edgesUpserted,
      resolvedDeletions,
    );

    const nextSummary: Summary = { ...summary, dossier: nextDossier };
    const validation = validate(nextSummary, this.kbRoot);
    if (!validation.valid) {
      throw new Error(
        `refusing to commit: resulting dossier fails @algerknown/core validation (${formatErrors(validation).join('; ')})`,
      );
    }

    doc.set('dossier', nextDossier);
    const nextDossierContent = doc.toString();
    const nextSidecar = this.applySidecarDelta(sidecar, write, resolvedDeletions);
    const nextSidecarContent = serializeSidecar(nextSidecar);

    const files = [
      { path: this.dossierRelPath, content: nextDossierContent },
      { path: this.sidecarRelPath, content: nextSidecarContent },
    ];

    this.writeRecoveryMarker(parentSha, files.map((f) => f.path));

    const trailers = this.buildTrailers(write, currentNamespaceRevision);
    const subject = `governed(${this.namespace}): write ${write.revisionRecord.idempotencyKey}`;

    try {
      commitManagedFiles(this.repoRoot, { branch: this.branch, parentSha, files, subject, trailers });
    } catch (err) {
      this.clearRecoveryMarker();
      throw err;
    }

    for (const file of files) {
      writeFileAtomic(path.join(this.repoRoot, file.path), file.content);
    }
    gitAdd(this.repoRoot, files.map((f) => f.path));
    this.clearRecoveryMarker();
  }

  /**
   * The governed Repository port carries only bare EdgeIds for deletions, so
   * this resolves each one's kind/endpoints by lookup against whatever state
   * it belonged to just before the delete: the sidecar (for derived_from/
   * contradicts/supersedes) or the dossier's current native edges (for
   * evidence_for/about). Never assumes a particular edge id scheme.
   */
  private resolveEdgeDeletions(edgeIds: EdgeId[], sidecar: NamespaceSidecar, currentDossier: Dossier): ResolvedEdgeDeletion[] {
    if (edgeIds.length === 0) return [];

    const unusedAttribution: RecordAttribution = {
      provenance: { sources: [], railId: 'unused', evaluatorVerdicts: [] },
      revision: {
        revisionId: asRevisionId('unused'),
        namespaceRevision: 0,
        createdAt: '1970-01-01T00:00:00.000Z',
        actorId: asActorId('unused'),
        actorClass: 'human',
      },
    };
    const { edges: nativeEdges } = mapDossierToGoverned(currentDossier, this.namespace, this.subject, () => unusedAttribution);
    const nativeById = new Map(nativeEdges.map((e) => [e.id, e]));

    return edgeIds.map((edgeId) => {
      const sidecarRecord = sidecar.edges.find((e) => e.id === String(edgeId));
      if (sidecarRecord) {
        return {
          edgeId,
          kind: sidecarRecord.kind as EdgeKind,
          sourceId: asNodeId(sidecarRecord.sourceId),
          targetId: asNodeId(sidecarRecord.targetId),
        };
      }
      const native = nativeById.get(edgeId);
      if (native) {
        return { edgeId, kind: native.kind, sourceId: native.sourceId, targetId: native.targetId };
      }
      throw new Error(`cannot resolve edge "${edgeId}" for deletion: not found in the namespace sidecar or the dossier's current native edges`);
    });
  }

  private applySidecarDelta(sidecar: NamespaceSidecar, write: PreparedWrite, resolvedDeletions: ResolvedEdgeDeletion[]): NamespaceSidecar {
    let edges = [...sidecar.edges];
    for (const edge of write.edgesUpserted) {
      if (isNativeEdgeKind(edge.kind)) continue; // derivable from dossier fields; never persisted here
      const record: SidecarEdgeRecord = {
        id: String(edge.id),
        kind: edge.kind,
        sourceId: String(edge.sourceId),
        targetId: String(edge.targetId),
        provenance: edge.provenance,
        revision: edge.revision,
      };
      const idx = edges.findIndex((e) => e.id === record.id);
      if (idx >= 0) edges[idx] = record;
      else edges.push(record);
    }
    for (const deletion of resolvedDeletions) {
      if (isNativeEdgeKind(deletion.kind)) continue;
      edges = edges.filter((e) => e.id !== String(deletion.edgeId));
    }

    const nodeProvenance = { ...sidecar.nodeProvenance };
    for (const node of write.nodesUpserted) {
      nodeProvenance[String(node.id)] = { provenance: node.provenance, revision: node.revision };
    }
    for (const nodeId of write.nodesDeleted) {
      delete nodeProvenance[String(nodeId)];
    }

    return {
      mappingVersion: ADAPTER_MAPPING_VERSION,
      nodeProvenance,
      edges,
      revisions: [...sidecar.revisions, write.revisionRecord],
    };
  }

  /**
   * Structured commit trailers for the human/audit-facing git log. Only
   * fields actually threaded through PreparedWrite/RevisionRecord (the
   * governed Repository port, out of scope to change here) are populated --
   * Proposal-Id, Attestation-Id, and Reviewer-Id are NOT available at this
   * layer because the orchestrator does not pass proposal/attestation
   * identity into its PreparedWrite. A coordinator with access to that
   * identity (e.g. cohort 6's SQLite proposal service) can still correlate a
   * revision via Operation-Id (the write's idempotency key).
   */
  private buildTrailers(write: PreparedWrite, priorNamespaceRevision: number | null): CommitTrailer[] {
    const idempotencyKeyHash = createHash('sha256').update(String(write.revisionRecord.idempotencyKey)).digest('hex');
    const diffHash = createHash('sha256').update(JSON.stringify(write.revisionRecord.diff)).digest('hex');
    const sourceRefs = Array.from(
      new Set(
        [...write.nodesUpserted, ...write.edgesUpserted].flatMap((entity) =>
          entity.provenance.sources.map((s) => s.locator ?? `${s.kind}:${s.id}`),
        ),
      ),
    );

    const trailers: CommitTrailer[] = [
      { key: 'Operation-Id', value: String(write.revisionRecord.idempotencyKey) },
      { key: 'Idempotency-Key-Hash', value: idempotencyKeyHash },
      { key: 'Mutation-Diff-Hash', value: diffHash },
      { key: 'Revision-Id', value: String(write.revisionRecord.revisionId) },
      { key: 'Namespace-Revision', value: String(write.revisionRecord.namespaceRevision) },
      { key: 'Prior-Namespace-Revision', value: priorNamespaceRevision === null ? 'none' : String(priorNamespaceRevision) },
      { key: 'Actor-Id', value: String(write.revisionRecord.actorId) },
      { key: 'Actor-Class', value: write.revisionRecord.actorClass },
    ];

    const revertEntry = write.revisionRecord.diff.find((d) => d.changeKind === 'revert');
    if (revertEntry) trailers.push({ key: 'Reversal-Target', value: String(revertEntry.entityId) });
    if (sourceRefs.length > 0) trailers.push({ key: 'Source-Refs', value: sourceRefs.join(',') });

    return trailers;
  }

  // -------------------------------------------------------------------------
  // Recovery
  // -------------------------------------------------------------------------

  private markerPath(): string {
    return path.join(this.repoRoot, '.algerknown/governed/.recovery', `${encodeNamespaceForPath(this.namespace)}.json`);
  }

  private writeRecoveryMarker(parentSha: string | undefined, relativePaths: string[]): void {
    const previousContent = relativePaths.map((p) => {
      const abs = path.join(this.repoRoot, p);
      return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : null;
    });
    const marker: RecoveryMarker = { parentSha: parentSha ?? null, paths: relativePaths, previousContent };
    const markerPath = this.markerPath();
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileAtomic(markerPath, JSON.stringify(marker));
  }

  private clearRecoveryMarker(): void {
    fs.rmSync(this.markerPath(), { force: true });
  }

  /**
   * Self-heals from a crash between the pre-commit marker write and
   * clearRecoveryMarker(): if the branch tip is unchanged since the marker
   * was written, the git commit never landed, so working-tree bytes are
   * rolled back; otherwise a commit did land (ours, most likely) and the
   * working tree is (re)materialized from the current tip. Called at the
   * top of every public method so recovery is transparent to callers.
   */
  private recoverIfNeeded(): void {
    const markerPath = this.markerPath();
    if (!fs.existsSync(markerPath)) return;

    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8')) as RecoveryMarker;
    const currentTip = gitRevParse(this.repoRoot, this.branch) ?? null;

    if (currentTip === marker.parentSha) {
      marker.paths.forEach((p, i) => {
        const abs = path.join(this.repoRoot, p);
        const previous = marker.previousContent[i]!;
        if (previous === null) fs.rmSync(abs, { force: true });
        else writeFileAtomic(abs, previous);
      });
    } else {
      for (const p of marker.paths) {
        const content = gitShow(this.repoRoot, currentTip!, p);
        if (content !== undefined) writeFileAtomic(path.join(this.repoRoot, p), content);
      }
      gitAdd(this.repoRoot, marker.paths);
    }

    fs.rmSync(markerPath, { force: true });
  }

  // -------------------------------------------------------------------------
  // Shared read helpers
  // -------------------------------------------------------------------------

  private readCurrentSummaryDoc() {
    const content = fs.readFileSync(path.join(this.repoRoot, this.dossierRelPath), 'utf-8');
    const doc = parseDocument(content);
    const summary = doc.toJS() as Summary;
    return { doc, summary };
  }

  private readSidecarOrUndefined(): NamespaceSidecar | undefined {
    const abs = path.join(this.repoRoot, this.sidecarRelPath);
    if (!fs.existsSync(abs)) return undefined;
    return parseSidecar(fs.readFileSync(abs, 'utf-8'));
  }

  private readSidecar(): NamespaceSidecar {
    return this.readSidecarOrUndefined() ?? emptySidecar();
  }

  private mapCurrent(): { nodes: GovernedNode[]; edges: GovernedEdge[] } {
    const { summary } = this.readCurrentSummaryDoc();
    const dossier = summary.dossier;
    if (!dossier) return { nodes: [], edges: [] };

    const sidecar = this.readSidecar();
    const sourceCommit = gitLastCommitTouching(this.repoRoot, this.branch, [this.dossierRelPath]);
    const sourceDate = sourceCommit ? gitCommitDate(this.repoRoot, sourceCommit) : new Date(0).toISOString();
    const resolver = this.buildAttributionResolver(sidecar, sourceCommit, sourceDate);
    return mapDossierToGoverned(dossier, this.namespace, this.subject, resolver);
  }

  private buildAttributionResolver(
    sidecar: NamespaceSidecar,
    sourceCommit: string | undefined,
    sourceDate: string,
  ): AttributionResolver {
    return (id: string): RecordAttribution => {
      const stored = sidecar.nodeProvenance[id];
      if (stored) return stored as RecordAttribution;
      return {
        provenance: {
          sources: [{ kind: 'external', id, locator: `git:${sourceCommit ?? 'unknown'}:${this.binding.path}#${id}` }],
          railId: 'human-gated',
          evaluatorVerdicts: [],
        },
        revision: {
          revisionId: asRevisionId(`git:${sourceCommit ?? 'unknown'}`),
          namespaceRevision: 0,
          createdAt: sourceDate,
          actorId: asActorId(`${this.binding.summaryId}:source`),
          actorClass: 'human',
        },
      };
    };
  }
}
