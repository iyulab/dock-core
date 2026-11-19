import assert from 'node:assert/strict';
import { apply, createWorkspace, tryApply, type Node, type Op, type Workspace } from '../src/index.ts';

/** Unique ids for things an operation creates, as a host would allocate them. */
export function ids(prefix = 'n') {
  let n = 0;
  return {
    next: (): string => `${prefix}${++n}`,
    group: (): { group: string; split: string } => ({ group: `${prefix}g${++n}`, split: `${prefix}s${++n}` }),
  };
}

/** Applies an operation that must succeed. */
export function must(ws: Workspace, op: Op): Workspace {
  const r = tryApply(ws, op);
  if (!r.ok) assert.fail(`expected ${op.type} to succeed, got ${r.error.code}: ${r.error.message}`);
  return r.workspace;
}

/** Asserts an operation is rejected with `code`, and that `apply` then leaves the workspace untouched. */
export function mustFail(ws: Workspace, op: Op, code: string): void {
  const r = tryApply(ws, op);
  assert.ok(!r.ok, `expected ${op.type} to fail with ${code}`);
  if (!r.ok) assert.equal(r.error.code, code);
  assert.equal(apply(ws, op), ws, 'an invalid operation must return the same workspace reference');
}

/** `[a,b*b]` for a group with active tab b, `row(x | y)` for splits: compact, comparable layout text. */
export function dump(node: Node | null): string {
  if (!node) return '∅';
  if (node.kind === 'tabs') return `[${node.panels.map((p) => (p === node.active ? p + '*' : p)).join(',')}]`;
  return `${node.direction}(${node.children.map(dump).join(' | ')})`;
}

export const layout = (ws: Workspace, root: string): string => dump(ws.roots[root]?.node ?? null);

export function groupIdOf(ws: Workspace, panel: string): string {
  let found = '';
  const visit = (n: Node | null): void => {
    if (!n) return;
    if (n.kind === 'tabs') {
      if (n.panels.includes(panel)) found = n.id;
    } else n.children.forEach(visit);
  };
  Object.values(ws.roots).forEach((r) => visit(r.node));
  assert.ok(found, `panel ${panel} is not in a group`);
  return found;
}

/** Every group, split and root id present, for building operations against a workspace. */
export function inventory(ws: Workspace) {
  const groups: string[] = [];
  const splits: { id: string; children: number }[] = [];
  const visit = (n: Node | null): void => {
    if (!n) return;
    if (n.kind === 'tabs') groups.push(n.id);
    else {
      splits.push({ id: n.id, children: n.children.length });
      n.children.forEach(visit);
    }
  };
  Object.values(ws.roots).forEach((r) => visit(r.node));
  return {
    groups,
    splits,
    roots: Object.keys(ws.roots),
    emptyRoots: Object.values(ws.roots).filter((r) => !r.node).map((r) => r.id),
    panels: Object.keys(ws.panels),
  };
}

export function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    Object.values(v as object).forEach(deepFreeze);
  }
  return v;
}

/** A small deterministic PRNG (mulberry32) so property tests are reproducible from a seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number): number => Math.floor(next() * n),
    pick: <T>(xs: readonly T[]): T | undefined => xs[Math.floor(next() * xs.length)],
    chance: (p: number): boolean => next() < p,
  };
}

/** A workspace with one root "A": [p1,p2] beside [p3], and an empty root "B". */
export function sample(): Workspace {
  const id = ids('s');
  let ws = createWorkspace();
  ws = must(ws, { type: 'add-root', root: 'A' });
  ws = must(ws, { type: 'add-root', root: 'B' });
  ws = must(ws, { type: 'add-panel', panel: { id: 'p1', title: 'One' }, to: { kind: 'root', root: 'A', ids: { group: id.next() } } });
  ws = must(ws, { type: 'add-panel', panel: { id: 'p2', title: 'Two' }, to: { kind: 'tabs', group: groupIdOf(ws, 'p1') } });
  ws = must(ws, { type: 'add-panel', panel: { id: 'p3', title: 'Three' }, to: { kind: 'edge', group: groupIdOf(ws, 'p1'), side: 'right', ids: id.group() } });
  return ws;
}
