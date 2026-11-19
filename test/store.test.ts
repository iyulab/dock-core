import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStore, createWorkspace, serialize, type Op, type Workspace } from '../src/index.ts';

const open: Op[] = [
  { type: 'add-root', root: 'main' },
  { type: 'add-panel', panel: { id: 'a', title: 'A' }, to: { kind: 'root', root: 'main', ids: { group: 'g1' } } },
  { type: 'add-panel', panel: { id: 'b', title: 'B' }, to: { kind: 'edge', group: 'g1', side: 'right', ids: { group: 'g2', split: 's1' } } },
];

test('a new store holds an empty workspace and applies dispatched operations', () => {
  const store = createStore();
  assert.equal(serialize(store.getState()), serialize(createWorkspace()));
  for (const op of open) assert.equal(store.dispatch(op).ok, true);
  assert.deepEqual(Object.keys(store.getState().panels), ['a', 'b']);
});

test('dispatch returns the same result as tryApply and never throws on a bad operation', () => {
  const store = createStore();
  const bad = store.dispatch({ type: 'activate', panel: 'ghost' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.error.code, 'unknown-panel');
  const before = store.getState();
  assert.equal(store.dispatch(JSON.parse('{"type":"nope"}') as Op).ok, false);
  assert.equal(store.getState(), before, 'a rejected operation leaves the same state reference');
});

test('listeners hear accepted operations only, in order, with the new state', () => {
  const store = createStore();
  const heard: string[] = [];
  store.subscribe((state, change) => heard.push(`${change.kind === 'op' ? change.op.type : change.kind}:${Object.keys(state.roots).length}`));
  store.dispatch(open[0] as Op);
  store.dispatch({ type: 'activate', panel: 'ghost' });
  store.dispatch(open[1] as Op);
  assert.deepEqual(heard, ['add-root:1', 'add-panel:1']);
});

test('unsubscribing stops notifications, and doing so during a dispatch does not skip other listeners', () => {
  const store = createStore();
  const calls: string[] = [];
  const off1 = store.subscribe(() => {
    calls.push('one');
    off1();
  });
  store.subscribe(() => calls.push('two'));
  store.dispatch(open[0] as Op);
  store.dispatch({ type: 'add-root', root: 'other' });
  assert.deepEqual(calls, ['one', 'two', 'two']);
});

test('a throwing listener cannot corrupt the state or starve the others', () => {
  const store = createStore();
  let reached = false;
  store.subscribe(() => {
    throw new Error('boom');
  });
  store.subscribe(() => {
    reached = true;
  });
  assert.throws(() => store.dispatch(open[0] as Op), (e: unknown) => e instanceof AggregateError && e.errors.length === 1);
  assert.equal(reached, true);
  assert.deepEqual(Object.keys(store.getState().roots), ['main'], 'the operation stays applied');
});

test('two stores fed the same operations hold identical state (replicas)', () => {
  const a = createStore();
  const b = createStore();
  for (const op of open) {
    a.dispatch(op);
    b.dispatch(op);
  }
  assert.equal(serialize(a.getState()), serialize(b.getState()));
});

test('replace swaps in a valid workspace and reports an invalid one without changing state', () => {
  const store = createStore();
  const seen: string[] = [];
  store.subscribe((_s, change) => seen.push(change.kind));
  const donor = createStore();
  for (const op of open) donor.dispatch(op);

  const ok = store.replace(donor.getState());
  assert.equal(ok.ok, true);
  assert.equal(serialize(store.getState()), serialize(donor.getState()));

  const broken = JSON.parse(serialize(donor.getState())) as Workspace;
  (broken.panels as Record<string, unknown>)['ghost'] = { id: 'ghost', title: 'Ghost' };
  const before = store.getState();
  const bad = store.replace(broken);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.errors.length > 0);
  assert.equal(store.getState(), before);
  assert.deepEqual(seen, ['replace'], 'only the successful replace is announced');
});

test('creating a store from an invalid workspace is a programming error', () => {
  const broken = JSON.parse(serialize(createWorkspace())) as Workspace;
  (broken.panels as Record<string, unknown>)['ghost'] = { id: 'ghost', title: 'Ghost' };
  assert.throws(() => createStore(broken), /invalid workspace/);
});
