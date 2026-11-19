import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apply, createWorkspace, parseWorkspace, serialize, tryApply, validateWorkspace, type Op, type Placement, type Workspace } from '../src/index.ts';
import { inventory, rng } from './helpers.ts';

/**
 * Audit checklist, as a test: after ANY sequence of operations (including invalid ones) the workspace keeps
 * every invariant, is identical when the same operations are replayed on another copy, and survives serialization.
 */
function randomOp(ws: Workspace, r: ReturnType<typeof rng>, fresh: () => string): Op {
  const inv = inventory(ws);
  const bogus = () => r.chance(0.08);
  const group = (): string => (bogus() ? 'ghost' : (r.pick(inv.groups) ?? 'ghost'));
  const root = (): string => (bogus() ? 'ghost' : (r.pick(inv.roots) ?? 'ghost'));
  const panel = (): string => (bogus() ? 'ghost' : (r.pick(inv.panels) ?? 'ghost'));

  const placement = (): Placement => {
    const kind = r.pick(['tabs', 'tabs', 'edge', 'edge', 'edge', 'root'] as const)!;
    if (kind === 'tabs') return r.chance(0.5) ? { kind, group: group() } : { kind, group: group(), index: r.int(6) - 1 };
    if (kind === 'edge') return { kind, group: group(), side: r.pick(['left', 'right', 'top', 'bottom'] as const)!, ids: { group: fresh(), split: fresh() } };
    return { kind: 'root', root: r.chance(0.7) ? (r.pick(inv.emptyRoots) ?? root()) : root(), ids: { group: fresh() } };
  };

  const kind = r.pick(['add-panel', 'add-panel', 'move-panel', 'move-panel', 'move-panel', 'move-group', 'detach', 'remove-panel', 'activate', 'resize', 'add-root', 'remove-root'] as const)!;
  switch (kind) {
    case 'add-panel': {
      const id = fresh();
      return { type: 'add-panel', panel: { id, title: `Panel ${id}`, params: { n: r.int(100) } }, to: placement() };
    }
    case 'move-panel':
      return { type: 'move-panel', panel: panel(), to: placement() };
    case 'move-group':
      return { type: 'move-group', group: group(), to: placement() };
    case 'detach':
      return { type: 'detach', panel: panel(), root: r.chance(0.9) ? fresh() : root(), ids: { group: fresh() } };
    case 'remove-panel':
      return { type: 'remove-panel', panel: panel() };
    case 'activate':
      return { type: 'activate', panel: panel() };
    case 'resize': {
      const s = r.pick(inv.splits);
      const n = s ? (r.chance(0.9) ? s.children : s.children + 1) : 2;
      return { type: 'resize', split: s?.id ?? 'ghost', sizes: Array.from({ length: n }, () => (r.chance(0.03) ? 0 : 0.1 + r.next())) };
    }
    case 'add-root':
      return { type: 'add-root', root: r.chance(0.9) ? fresh() : root() };
    case 'remove-root':
      return { type: 'remove-root', root: r.chance(0.7) ? (r.pick(inv.emptyRoots) ?? root()) : root() };
  }
}

for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  test(`random operation sequences keep every invariant (seed ${seed})`, () => {
    const r = rng(seed);
    let n = 0;
    const fresh = (): string => `i${++n}`;
    let ws = createWorkspace();
    const ok = new Map<string, number>();
    let rejected = 0;

    for (let step = 0; step < 500; step++) {
      const op = randomOp(ws, r, fresh);
      const res = tryApply(ws, op);
      const replica = JSON.parse(serialize(ws)) as Workspace;
      const res2 = tryApply(replica, op);

      assert.equal(res.ok, res2.ok, `step ${step}: the same operation must be accepted or rejected on every copy`);
      if (!res.ok || !res2.ok) {
        rejected++;
        assert.equal(apply(ws, op), ws, `step ${step}: a rejected operation must leave the workspace as it was`);
        continue;
      }
      assert.equal(serialize(res.workspace), serialize(res2.workspace), `step ${step}: replicas diverged on ${op.type}`);
      ws = res.workspace;
      ok.set(op.type, (ok.get(op.type) ?? 0) + 1);

      assert.deepEqual(validateWorkspace(ws), [], `step ${step}: ${op.type} broke an invariant`);
      const back = parseWorkspace(serialize(ws));
      assert.ok(back.ok, `step ${step}: serialized workspace failed to restore`);
      if (back.ok) assert.equal(serialize(back.workspace), serialize(ws), `step ${step}: round trip changed the workspace`);
    }

    // the run must actually exercise the operations, not just reject everything
    for (const t of ['add-panel', 'move-panel', 'detach', 'resize'] as const) assert.ok((ok.get(t) ?? 0) > 5, `${t} succeeded only ${ok.get(t) ?? 0} times`);
    assert.ok(rejected > 20, 'invalid operations should be exercised too');
  });
}
