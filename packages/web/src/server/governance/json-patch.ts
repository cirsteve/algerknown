/** Minimal RFC 6902 JSON Patch: add, remove, replace, move, copy, test. */

export class JsonPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonPatchError';
  }
}

export type JsonPatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'move'; path: string; from: string }
  | { op: 'copy'; path: string; from: string }
  | { op: 'test'; path: string; value: unknown };

function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new JsonPatchError(`invalid JSON pointer "${pointer}": must start with "/"`);
  }
  return pointer
    .slice(1)
    .split('/')
    .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function getParent(root: unknown, tokens: string[]): { parent: Record<string, unknown> | unknown[]; key: string } {
  let current: unknown = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i]!;
    if (Array.isArray(current)) {
      current = current[Number(token)];
    } else if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[token];
    } else {
      throw new JsonPatchError(`path segment "${token}" does not resolve to an object or array`);
    }
  }
  if (!current || typeof current !== 'object') {
    throw new JsonPatchError('path does not resolve to a container');
  }
  return { parent: current as Record<string, unknown> | unknown[], key: tokens[tokens.length - 1] ?? '' };
}

/**
 * "-" (the array append target) is only meaningful as a *write* target for
 * "add" -- RFC 6902 defines it purely in terms of insertion, not as a
 * readable "last element" locator. Using it here for test/copy/move reads
 * would silently read a different element than the caller's path implies.
 */
function getValue(root: unknown, pointer: string): unknown {
  const tokens = parsePointer(pointer);
  let current = root;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (token === '-') {
        throw new JsonPatchError(`"-" is not a valid read target in path "${pointer}"`);
      }
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new JsonPatchError(`array index "${token}" out of bounds in path "${pointer}"`);
      }
      current = current[index];
    } else if (current && typeof current === 'object') {
      const record = current as Record<string, unknown>;
      if (!(token in record)) {
        throw new JsonPatchError(`path "${pointer}" does not resolve to a value`);
      }
      current = record[token];
    } else {
      throw new JsonPatchError(`path "${pointer}" does not resolve to a value`);
    }
  }
  return current;
}

/**
 * "add" may target index === length (append) or "-" (append shorthand);
 * "replace" may only target an index that already exists, or it silently
 * degenerates into an append.
 */
function setValue(root: unknown, pointer: string, value: unknown, mode: 'add' | 'replace'): void {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) {
    throw new JsonPatchError('cannot set the document root');
  }
  const { parent, key } = getParent(root, tokens);
  if (Array.isArray(parent)) {
    if (key === '-') {
      if (mode !== 'add') {
        throw new JsonPatchError('"-" is only a valid array target for "add"');
      }
      parent.push(value);
      return;
    }
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) {
      throw new JsonPatchError(`array index "${key}" is invalid`);
    }
    if (mode === 'add') {
      if (index > parent.length) {
        throw new JsonPatchError(`array index "${key}" out of bounds`);
      }
      parent.splice(index, 0, value);
    } else {
      if (index >= parent.length) {
        throw new JsonPatchError(`array index "${key}" out of bounds`);
      }
      parent[index] = value;
    }
  } else {
    (parent as Record<string, unknown>)[key] = value;
  }
}

function removeValue(root: unknown, pointer: string): unknown {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) {
    throw new JsonPatchError('cannot remove the document root');
  }
  const { parent, key } = getParent(root, tokens);
  if (Array.isArray(parent)) {
    const index = Number(key);
    if (Number.isNaN(index) || index < 0 || index >= parent.length) {
      throw new JsonPatchError(`array index "${key}" out of bounds`);
    }
    return parent.splice(index, 1)[0];
  }
  const record = parent as Record<string, unknown>;
  if (!(key in record)) {
    throw new JsonPatchError(`path "${pointer}" does not exist`);
  }
  const value = record[key];
  delete record[key];
  return value;
}

/** Structural JSON equality: object key order never affects the result. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;

  if (aIsArray && bIsArray) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.prototype.hasOwnProperty.call(bRecord, key) && deepEqual(aRecord[key], bRecord[key]));
}

/** Applies `patch` to a deep clone of `document`, never mutating the input. Throws JsonPatchError on any failure. */
export function applyJsonPatch<T>(document: T, patch: JsonPatchOp[]): T {
  const result = clone(document);
  for (const op of patch) {
    switch (op.op) {
      case 'add':
        setValue(result, op.path, clone(op.value), 'add');
        break;
      case 'replace':
        setValue(result, op.path, clone(op.value), 'replace');
        break;
      case 'remove':
        removeValue(result, op.path);
        break;
      case 'move': {
        const value = removeValue(result, op.from);
        setValue(result, op.path, value, 'add');
        break;
      }
      case 'copy': {
        const value = clone(getValue(result, op.from));
        setValue(result, op.path, value, 'add');
        break;
      }
      case 'test': {
        const value = getValue(result, op.path);
        if (!deepEqual(value, op.value)) {
          throw new JsonPatchError(`test failed at path "${op.path}"`);
        }
        break;
      }
      default:
        throw new JsonPatchError(`unsupported op "${(op as { op: string }).op}"`);
    }
  }
  return result;
}

export function isJsonPatchOpArray(value: unknown): value is JsonPatchOp[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const op = (item as Record<string, unknown>).op;
    const path = (item as Record<string, unknown>).path;
    if (typeof path !== 'string') return false;
    if (op === 'remove') return Object.keys(item).length === 2;
    if (op === 'add' || op === 'replace' || op === 'test') return 'value' in item && Object.keys(item).length === 3;
    if (op === 'move' || op === 'copy') return typeof (item as Record<string, unknown>).from === 'string' && Object.keys(item).length === 3;
    return false;
  });
}
