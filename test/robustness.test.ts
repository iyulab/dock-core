import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apply, createWorkspace, parseWorkspace, serialize, tryApply, validateWorkspace, type Op, type Workspace } from '../src/index.ts';
import { groupIdOf, layout, must, rng, sample } from './helpers.ts';

/** Operations arrive from other windows as untyped data, so the model must cope with any value. */
const asOp = (v: unknown): Op => v as Op;

test('malformed operations are reported as invalid-op, never thrown, and leave the workspace alone', () => {
  const ws = sample();
  const g = groupIdOf(ws, 'p1');
  const malformed: unknown[] = [
    null, undefined, 5, 'move', [], {},
    { type: 'frobnicate' },
    { type: 'move-panel', panel: 'p1' }, // no destination
    { type: 'move-panel', panel: 5, to: { kind: 'tabs', group: g } },
    { type: 'move-panel', panel: 'p1', to: null },
    { type: 'move-panel', panel: 'p1', to: { kind: 'dock-left', group: g } },
    { type: 'move-panel', panel: 'p1', to: { kind: 'edge', group: g, side: 'diagonal', ids: { group: 'a', split: 'b' } } },
    { type: 'move-panel', panel: 'p1', to: { kind: 'edge', group: g, side: 'left' } },
    { type: 'add-panel', panel: { id: 'x' }, to: { kind: 'tabs', group: g } }, // no title
    { type: 'add-panel', panel: { id: 'x', title: 't', params: { f: 1n } }, to: { kind: 'tabs', group: g } },
    { type: 'add-panel', panel: { id: 'x', title: 't', params: { f: () => 1 } }, to: { kind: 'tabs', group: g } },
    { type: 'add-panel', panel: 'x', to: { kind: 'tabs', group: g } },
    { type: 'resize', split: 's', sizes: 'wide' },
    { type: 'resize', split: 's', sizes: [1, '2'] },
    { type: 'detach', panel: 'p1', root: 'C' },
    { type: 'add-root' },
    { type: 'remove-panel' },
  ];
  for (const op of malformed) {
    const r = tryApply(ws, asOp(op));
    assert.ok(!r.ok, `expected a rejection for ${String(JSON.stringify(op, (_k, v) => (typeof v === 'bigint' ? 'big' : v)))}`);
    if (!r.ok) assert.equal(r.error.code, 'invalid-op');
    assert.equal(apply(ws, asOp(op)), ws);
  }
});

test('whatever apply accepts can be saved and restored (fuzzed with arbitrary values)', () => {
  const r = rng(20261119);
  const pool = ['A', 'B', 'p1', 'p2', 'p3', 'g1', '', '__proto__', 'constructor', 'x'];
  const keys = ['type', 'root', 'panel', 'group', 'to', 'kind', 'ids', 'split', 'sizes', 'side', 'index', 'id', 'title', 'params'];
  const types = ['add-root', 'remove-root', 'add-panel', 'remove-panel', 'activate', 'resize', 'move-panel', 'move-group', 'detach'];
  const value = (depth: number): unknown => {
    switch (r.int(depth > 2 ? 4 : 7)) {
      case 0: return r.pick(pool);
      case 1: return r.int(5) - 1;
      case 2: return r.chance(0.5) ? null : r.chance(0.5);
      case 3: return r.pick(['left', 'right', 'top', 'bottom', 'tabs', 'edge', 'root']);
      case 4: return Array.from({ length: r.int(4) }, () => value(depth + 1));
      default: {
        const o: Record<string, unknown> = {};
        for (let i = r.int(5); i > 0; i--) o[r.pick(keys) as string] = value(depth + 1);
        return o;
      }
    }
  };
  let accepted = 0;
  let ws: Workspace = sample();
  for (let i = 0; i < 4000; i++) {
    const op: Record<string, unknown> = r.chance(0.5) ? (value(0) as Record<string, unknown>) : { type: r.pick(types), ...(value(1) as object) };
    let res;
    assert.doesNotThrow(() => (res = tryApply(ws, asOp(op))), `an operation must never make apply throw: ${JSON.stringify(op)}`);
    const out = res as unknown as ReturnType<typeof tryApply>;
    if (out.ok) {
      accepted++;
      ws = out.workspace;
      assert.deepEqual(validateWorkspace(ws), []);
      const back = parseWorkspace(serialize(ws));
      assert.ok(back.ok, 'a workspace produced by apply must be restorable');
      if (back.ok) assert.equal(serialize(back.workspace), serialize(ws));
    }
  }
  assert.ok(accepted > 0, 'the fuzz should also hit valid operations');
});

test('names that exist on Object.prototype are ordinary identifiers', () => {
  const names = ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__', 'isPrototypeOf'];
  let ws = createWorkspace();
  ws = must(ws, { type: 'add-root', root: 'constructor' });
  ws = must(ws, { type: 'add-root', root: 'toString' });
  ws = must(ws, { type: 'add-panel', panel: { id: 'hasOwnProperty', title: 'h' }, to: { kind: 'root', root: 'constructor', ids: { group: 'valueOf' } } });
  ws = must(ws, { type: 'add-panel', panel: { id: 'isPrototypeOf', title: 'i' }, to: { kind: 'tabs', group: 'valueOf' } });
  ws = must(ws, { type: 'detach', panel: 'isPrototypeOf', root: '__defineGetter__', ids: { group: 'g-x' } });
  ws = must(ws, { type: 'move-panel', panel: 'hasOwnProperty', to: { kind: 'root', root: 'toString', ids: { group: 'g-y' } } });
  assert.equal(layout(ws, 'toString'), '[hasOwnProperty*]');
  assert.equal(layout(ws, '__defineGetter__'), '[isPrototypeOf*]');
  assert.deepEqual(validateWorkspace(ws), []);
  const back = parseWorkspace(serialize(ws));
  assert.ok(back.ok);
  if (back.ok) assert.equal(serialize(back.workspace), serialize(ws));
  // names that merely exist on the prototype chain are NOT treated as present
  for (const n of names) assert.ok(!tryApply(createWorkspace(), { type: 'remove-panel', panel: n }).ok);
  const dup = tryApply(createWorkspace(), { type: 'add-root', root: 'constructor' });
  assert.ok(dup.ok, 'adding a root called "constructor" must not be mistaken for a duplicate');
  assert.ok(tryApply(createWorkspace(), { type: 'remove-root', root: 'toString' }).ok === false);
  ws = must(ws, { type: 'remove-panel', panel: 'hasOwnProperty' });
  assert.equal(Object.hasOwn(ws.panels, 'hasOwnProperty'), false, 'removed means gone from the registry itself');
});

test('"__proto__" is rejected as an identifier everywhere, and nothing is polluted', () => {
  const ws = sample();
  const g = groupIdOf(ws, 'p1');
  const bad = [
    { type: 'add-root', root: '__proto__' },
    { type: 'add-panel', panel: { id: '__proto__', title: 't' }, to: { kind: 'tabs', group: g } },
    { type: 'add-panel', panel: { id: 'ok', title: 't' }, to: { kind: 'edge', group: g, side: 'left', ids: { group: '__proto__', split: 's' } } },
    { type: 'add-panel', panel: { id: 'ok', title: 't' }, to: { kind: 'edge', group: g, side: 'left', ids: { group: 'g', split: '__proto__' } } },
    { type: 'detach', panel: 'p1', root: '__proto__', ids: { group: 'gz' } },
    { type: 'move-panel', panel: 'p1', to: { kind: 'root', root: 'B', ids: { group: '__proto__' } } },
  ];
  for (const op of bad) {
    const r = tryApply(ws, asOp(op));
    assert.ok(!r.ok, JSON.stringify(op));
    if (!r.ok) assert.equal(r.error.code, 'invalid-id');
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.getPrototypeOf(ws.roots), Object.prototype);
  assert.equal(Object.getPrototypeOf(ws.panels), Object.prototype);

  for (const text of [
    '{"version":1,"roots":{"__proto__":{"id":"__proto__","node":null}},"panels":{}}',
    '{"version":1,"roots":{},"panels":{"__proto__":{"id":"__proto__","title":"t"}}}',
    '{"version":1,"roots":{"A":{"id":"A","node":{"kind":"tabs","id":"__proto__","panels":["p"],"active":"p"}}},"panels":{"p":{"id":"p","title":"t"}}}',
  ]) {
    const r = parseWorkspace(text);
    assert.ok(!r.ok, text);
    if (!r.ok) assert.equal(r.error.code, 'shape');
  }
});

test('dropping a tab on the body of its own group leaves the order alone and only activates it', () => {
  let ws = sample();
  const g = groupIdOf(ws, 'p1');
  ws = must(ws, { type: 'activate', panel: 'p2' });
  ws = must(ws, { type: 'move-panel', panel: 'p1', to: { kind: 'tabs', group: g } });
  assert.equal(layout(ws, 'A'), 'row([p1*,p2] | [p3*])');
  ws = must(ws, { type: 'move-panel', panel: 'p2', to: { kind: 'tabs', group: g } });
  assert.equal(layout(ws, 'A'), 'row([p1,p2*] | [p3*])');
});
