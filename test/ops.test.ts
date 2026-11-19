import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apply, createWorkspace, serialize, tryApply, type Node, type Workspace } from '../src/index.ts';
import { deepFreeze, groupIdOf, ids, layout, must, mustFail, sample } from './helpers.ts';

const sizesOf = (n: Node | null): number[] => (n && n.kind === 'split' ? [...n.sizes] : []);
const close = (a: number[], b: number[]) => {
  assert.equal(a.length, b.length);
  a.forEach((x, i) => assert.ok(Math.abs(x - (b[i] as number)) < 1e-9, `${a} vs ${b}`));
};

test('sample layout: [p1,p2] | [p3] in one row, empty second root', () => {
  const ws = sample();
  assert.equal(layout(ws, 'A'), 'row([p1,p2*] | [p3*])');
  assert.equal(layout(ws, 'B'), '∅');
});

test('add-panel into an empty root creates the group and registers the panel', () => {
  const ws = must(must(createWorkspace(), { type: 'add-root', root: 'A' }), {
    type: 'add-panel',
    panel: { id: 'p', title: 'P', params: { file: 'a.rs' } },
    to: { kind: 'root', root: 'A', ids: { group: 'g1' } },
  });
  assert.equal(layout(ws, 'A'), '[p*]');
  assert.deepEqual(ws.panels.p, { id: 'p', title: 'P', params: { file: 'a.rs' } });
});

test('add-panel at an index and activating it', () => {
  let ws = sample();
  ws = must(ws, { type: 'add-panel', panel: { id: 'p4', title: 'Four' }, to: { kind: 'tabs', group: groupIdOf(ws, 'p1'), index: 1 } });
  assert.equal(layout(ws, 'A'), 'row([p1,p4*,p2] | [p3*])');
  ws = must(ws, { type: 'activate', panel: 'p1' });
  assert.equal(layout(ws, 'A'), 'row([p1*,p4,p2] | [p3*])');
});

test('edge split in the same direction as the parent inserts a sibling and halves the neighbour', () => {
  let ws = sample();
  const before = sizesOf(ws.roots.A!.node);
  close(before, [0.5, 0.5]);
  ws = must(ws, { type: 'move-panel', panel: 'p2', to: { kind: 'edge', group: groupIdOf(ws, 'p3'), side: 'left', ids: ids('x').group() } });
  assert.equal(layout(ws, 'A'), 'row([p1*] | [p2*] | [p3*])');
  close(sizesOf(ws.roots.A!.node), [0.5, 0.25, 0.25]);
});

test('edge split in the other direction wraps the target in a new split', () => {
  let ws = sample();
  ws = must(ws, { type: 'move-panel', panel: 'p2', to: { kind: 'edge', group: groupIdOf(ws, 'p3'), side: 'bottom', ids: ids('x').group() } });
  assert.equal(layout(ws, 'A'), 'row([p1*] | column([p3*] | [p2*]))');
});

test('a split that ends up nested in a split of the same direction is merged into it', () => {
  let ws = sample();
  ws = must(ws, { type: 'move-panel', panel: 'p2', to: { kind: 'edge', group: groupIdOf(ws, 'p3'), side: 'bottom', ids: ids('x').group() } });
  // moving p2 beside p3 on the right: column(p3|p2) becomes column(p3) -> p3, then a same-direction row merges
  ws = must(ws, { type: 'move-panel', panel: 'p2', to: { kind: 'edge', group: groupIdOf(ws, 'p3'), side: 'right', ids: ids('y').group() } });
  assert.equal(layout(ws, 'A'), 'row([p1*] | [p3*] | [p2*])');
  close(sizesOf(ws.roots.A!.node).map((s) => +s.toFixed(6)), [0.5, 0.25, 0.25]);
});

test('reordering inside a group: index counts positions before the move', () => {
  let ws = sample();
  ws = must(ws, { type: 'move-panel', panel: 'p1', to: { kind: 'tabs', group: groupIdOf(ws, 'p1'), index: 2 } });
  assert.equal(layout(ws, 'A'), 'row([p2,p1*] | [p3*])');
  ws = must(ws, { type: 'move-panel', panel: 'p1', to: { kind: 'tabs', group: groupIdOf(ws, 'p1'), index: 0 } });
  assert.equal(layout(ws, 'A'), 'row([p1*,p2] | [p3*])');
});

test('moving the last panel out of a root collapses its group and leaves an empty root', () => {
  let ws = sample();
  ws = must(ws, { type: 'move-panel', panel: 'p3', to: { kind: 'root', root: 'B', ids: { group: 'gB' } } });
  assert.equal(layout(ws, 'A'), '[p1,p2*]');
  assert.equal(layout(ws, 'B'), '[p3*]');
  ws = must(ws, { type: 'move-panel', panel: 'p3', to: { kind: 'tabs', group: groupIdOf(ws, 'p1') } });
  assert.equal(layout(ws, 'B'), '∅');
  assert.ok(ws.roots.B, 'an emptied root stays; the host decides when to remove it');
});

test('detach creates a new root holding the panel', () => {
  let ws = sample();
  ws = must(ws, { type: 'detach', panel: 'p2', root: 'C', ids: { group: 'gC' } });
  assert.equal(layout(ws, 'A'), 'row([p1*] | [p3*])');
  assert.equal(layout(ws, 'C'), '[p2*]');
  mustFail(ws, { type: 'detach', panel: 'p1', root: 'C', ids: { group: 'gZ' } }, 'root-exists');
});

test('removing the active tab activates the neighbour; closing the last tab collapses the split', () => {
  let ws = sample();
  ws = must(ws, { type: 'remove-panel', panel: 'p2' });
  assert.equal(layout(ws, 'A'), 'row([p1*] | [p3*])');
  ws = must(ws, { type: 'remove-panel', panel: 'p1' });
  assert.equal(layout(ws, 'A'), '[p3*]');
  assert.equal(ws.panels.p1, undefined);
});

test('move-group merges into a group, or recreates the group beside another', () => {
  let ws = sample();
  ws = must(ws, { type: 'move-group', group: groupIdOf(ws, 'p3'), to: { kind: 'tabs', group: groupIdOf(ws, 'p1') } });
  assert.equal(layout(ws, 'A'), '[p1,p2,p3*]');
  ws = sample();
  ws = must(ws, { type: 'move-group', group: groupIdOf(ws, 'p1'), to: { kind: 'root', root: 'B', ids: { group: 'gB' } } });
  assert.equal(layout(ws, 'B'), '[p1,p2*]');
  assert.equal(layout(ws, 'A'), '[p3*]');
});

test('resize normalizes sizes and rejects bad ones', () => {
  const ws = sample();
  const split = ws.roots.A!.node!.id;
  const resized = must(ws, { type: 'resize', split, sizes: [1, 3] });
  close(sizesOf(resized.roots.A!.node), [0.25, 0.75]);
  mustFail(ws, { type: 'resize', split, sizes: [1] }, 'invalid-sizes');
  mustFail(ws, { type: 'resize', split, sizes: [1, 0] }, 'invalid-sizes');
  mustFail(ws, { type: 'resize', split, sizes: [1, Number.NaN] }, 'invalid-sizes');
  mustFail(ws, { type: 'resize', split: 'nope', sizes: [1, 1] }, 'unknown-split');
});

test('invalid operations are rejected whole and leave the workspace as it was', () => {
  const ws = sample();
  const g1 = groupIdOf(ws, 'p1');
  mustFail(ws, { type: 'move-panel', panel: 'ghost', to: { kind: 'tabs', group: g1 } }, 'unknown-panel');
  mustFail(ws, { type: 'move-panel', panel: 'p1', to: { kind: 'tabs', group: 'ghost' } }, 'unknown-group');
  mustFail(ws, { type: 'move-panel', panel: 'p1', to: { kind: 'root', root: 'ghost', ids: { group: 'z' } } }, 'unknown-root');
  mustFail(ws, { type: 'move-panel', panel: 'p1', to: { kind: 'root', root: 'A', ids: { group: 'z' } } }, 'root-not-empty');
  mustFail(ws, { type: 'move-panel', panel: 'p3', to: { kind: 'edge', group: groupIdOf(ws, 'p3'), side: 'left', ids: { group: 'z', split: 'zz' } } }, 'self-target');
  mustFail(ws, { type: 'move-panel', panel: 'p1', to: { kind: 'edge', group: groupIdOf(ws, 'p3'), side: 'left', ids: { group: g1, split: 'zz' } } }, 'duplicate-id');
  mustFail(ws, { type: 'move-panel', panel: 'p1', to: { kind: 'edge', group: groupIdOf(ws, 'p3'), side: 'left', ids: { group: 'same', split: 'same' } } }, 'duplicate-id');
  mustFail(ws, { type: 'move-panel', panel: 'p1', to: { kind: 'tabs', group: g1, index: Number.NaN } }, 'invalid-index');
  mustFail(ws, { type: 'add-panel', panel: { id: 'p1', title: 'again' }, to: { kind: 'tabs', group: g1 } }, 'duplicate-panel');
  mustFail(ws, { type: 'add-panel', panel: { id: '', title: 'x' }, to: { kind: 'tabs', group: g1 } }, 'invalid-id');
  mustFail(ws, { type: 'move-group', group: g1, to: { kind: 'tabs', group: g1 } }, 'self-target');
  mustFail(ws, { type: 'remove-root', root: 'A' }, 'root-not-empty');
  mustFail(ws, { type: 'add-root', root: 'A' }, 'root-exists');
});

test('a failed operation never leaves a half-applied copy behind', () => {
  const ws = sample();
  const snapshot = serialize(ws);
  // the panel is lifted out first, then the destination turns out not to exist
  const r = tryApply(ws, { type: 'move-panel', panel: 'p1', to: { kind: 'tabs', group: 'ghost' } });
  assert.ok(!r.ok);
  assert.equal(serialize(ws), snapshot);
});

test('operations are pure: a deeply frozen input is not modified and not an obstacle', () => {
  const ws = deepFreeze(sample());
  const before = serialize(ws);
  const out = apply(ws, { type: 'move-panel', panel: 'p2', to: { kind: 'edge', group: groupIdOf(ws, 'p3'), side: 'top', ids: { group: 'xg', split: 'xs' } } });
  assert.equal(serialize(ws), before);
  assert.notEqual(serialize(out), before);
});

test('operations are deterministic: the same workspace and operation give the same bytes', () => {
  const a = sample();
  const b = JSON.parse(JSON.stringify(a)) as Workspace; // another "realm"
  const op = { type: 'move-panel', panel: 'p1', to: { kind: 'edge', group: groupIdOf(a, 'p3'), side: 'bottom', ids: { group: 'xg', split: 'xs' } } } as const;
  assert.equal(serialize(apply(a, op)), serialize(apply(b, op)));
  assert.equal(serialize(apply(a, op)), serialize(apply(a, op)));
});

test('remove-root removes only an empty root', () => {
  const ws = must(sample(), { type: 'remove-root', root: 'B' });
  assert.equal(ws.roots.B, undefined);
});
