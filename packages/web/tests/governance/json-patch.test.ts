import { describe, expect, it } from 'vitest';
import { applyJsonPatch, JsonPatchError } from '../../src/server/governance/json-patch.js';

describe('applyJsonPatch', () => {
  it('add with "-" appends to an array', () => {
    const result = applyJsonPatch({ items: [1, 2] }, [{ op: 'add', path: '/items/-', value: 3 }]);
    expect(result.items).toEqual([1, 2, 3]);
  });

  it('add at index === length appends (equivalent to "-")', () => {
    const result = applyJsonPatch({ items: [1, 2] }, [{ op: 'add', path: '/items/2', value: 3 }]);
    expect(result.items).toEqual([1, 2, 3]);
  });

  it('rejects "-" as a replace target instead of silently appending', () => {
    expect(() => applyJsonPatch({ items: [1, 2] }, [{ op: 'replace', path: '/items/-', value: 9 }])).toThrow(JsonPatchError);
  });

  it('rejects replace at index === length instead of silently appending', () => {
    expect(() => applyJsonPatch({ items: [1, 2] }, [{ op: 'replace', path: '/items/2', value: 9 }])).toThrow(/out of bounds/);
  });

  it('replace at an existing index replaces in place', () => {
    const result = applyJsonPatch({ items: [1, 2, 3] }, [{ op: 'replace', path: '/items/1', value: 9 }]);
    expect(result.items).toEqual([1, 9, 3]);
  });

  it('rejects "-" as a read target for test', () => {
    expect(() => applyJsonPatch({ items: [1, 2] }, [{ op: 'test', path: '/items/-', value: 2 }])).toThrow(JsonPatchError);
  });

  it('rejects "-" as a read target for copy/move "from"', () => {
    expect(() => applyJsonPatch({ items: [1, 2] }, [{ op: 'copy', from: '/items/-', path: '/items/0' }])).toThrow(JsonPatchError);
    expect(() => applyJsonPatch({ items: [1, 2] }, [{ op: 'move', from: '/items/-', path: '/items/0' }])).toThrow(JsonPatchError);
  });

  it('rejects an out-of-bounds array read consistently', () => {
    expect(() => applyJsonPatch({ items: [1, 2] }, [{ op: 'test', path: '/items/5', value: 1 }])).toThrow(/out of bounds/);
  });

  it('test succeeds for structurally-equal objects regardless of key order', () => {
    const result = applyJsonPatch({ a: { x: 1, y: 2 } }, [{ op: 'test', path: '/a', value: { y: 2, x: 1 } }]);
    expect(result).toEqual({ a: { x: 1, y: 2 } });
  });

  it('test fails for structurally-different objects even with matching stringified length', () => {
    expect(() => applyJsonPatch({ a: { x: 1, y: 2 } }, [{ op: 'test', path: '/a', value: { x: 1, y: 3 } }])).toThrow(/test failed/);
  });

  it('test with nested arrays/objects is order-independent at every level', () => {
    const doc = { list: [{ a: 1, b: 2 }, { c: 3 }] };
    const result = applyJsonPatch(doc, [{ op: 'test', path: '/list', value: [{ b: 2, a: 1 }, { c: 3 }] }]);
    expect(result).toEqual(doc);
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects a "%s" pointer segment instead of polluting the prototype', (segment) => {
    expect(() => applyJsonPatch({}, [{ op: 'add', path: `/${segment}/polluted`, value: 'x' }])).toThrow(JsonPatchError);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(({} as any).polluted).toBeUndefined();
  });

  it('rejects a terminal "__proto__" segment as well', () => {
    expect(() => applyJsonPatch({}, [{ op: 'add', path: '/__proto__', value: { polluted: 'x' } }])).toThrow(JsonPatchError);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(({} as any).polluted).toBeUndefined();
  });
});
