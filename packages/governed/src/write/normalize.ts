import { createHash } from 'node:crypto';
import { asMutationHash } from '../domain/ids.js';
import type { MutationHash } from '../domain/ids.js';
import type { EdgeMutation, NodeMutation, WriteCommand } from '../domain/write-command.js';

function canonicalStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(',')}}`;
}

function nodeMutationSortKey(mutation: NodeMutation): string {
  return `${mutation.op}:${mutation.nodeId}`;
}

function edgeMutationSortKey(mutation: EdgeMutation): string {
  return `${mutation.op}:${mutation.edgeId}`;
}

export interface NormalizedWriteCommand {
  command: WriteCommand;
  mutationHash: MutationHash;
}

/**
 * Sorts mutation arrays into a deterministic order and canonicalizes field
 * ordering so the same logical mutation always hashes identically regardless
 * of the order the caller supplied it in. This is the first orchestrator
 * step and the canonical form proposals and attestations bind to.
 */
export function normalizeWriteCommand(command: WriteCommand): NormalizedWriteCommand {
  const nodeMutations = [...command.nodeMutations].sort((a, b) =>
    nodeMutationSortKey(a).localeCompare(nodeMutationSortKey(b)),
  );
  const edgeMutations = [...command.edgeMutations].sort((a, b) =>
    edgeMutationSortKey(a).localeCompare(edgeMutationSortKey(b)),
  );

  const normalized: WriteCommand = { ...command, nodeMutations, edgeMutations };

  const hashInput = canonicalStringify({
    namespace: normalized.namespace,
    subject: normalized.subject,
    nodeMutations,
    edgeMutations,
  });
  const mutationHash = asMutationHash(createHash('sha256').update(hashInput).digest('hex'));

  return { command: normalized, mutationHash };
}
