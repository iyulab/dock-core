import { has, isJson, isRecord, isSafeId, isString, own } from './guards.ts';
import { normalize } from './normalize.ts';
import {
  SCHEMA_VERSION,
  type GroupId,
  type MutableNode as MNode,
  type MutablePanel,
  type MutableRoot as MRoot,
  type MutableSplit as MSplit,
  type MutableTabs as MTabs,
  type MutableWorkspace as W,
  type Panel,
  type PanelId,
  type RootId,
  type Side,
  type SplitId,
  type Workspace,
} from './types.ts';

/**
 * Where a panel or group goes.
 *
 * Identifiers for anything an operation creates travel inside the operation: `apply` never generates ids,
 * timestamps or randomness, so every copy of a workspace computes the same result for the same operation.
 */
export type Placement =
  /**
   * Into an existing group (its tab bar or the center of its body). `index` is the position before the move; without
   * it the panel is appended, except that dropping a panel on the center of its own group only activates it.
   */
  | { readonly kind: 'tabs'; readonly group: GroupId; readonly index?: number }
  /** Beside an existing group, splitting it. `ids.split` is only used when a new split must be created. */
  | {
      readonly kind: 'edge';
      readonly group: GroupId;
      readonly side: Side;
      readonly ids: { readonly group: GroupId; readonly split: SplitId };
    }
  /** As the only content of an empty root. */
  | { readonly kind: 'root'; readonly root: RootId; readonly ids: { readonly group: GroupId } };

export type Op =
  | { readonly type: 'add-root'; readonly root: RootId }
  | { readonly type: 'remove-root'; readonly root: RootId }
  | { readonly type: 'add-panel'; readonly panel: Panel; readonly to: Placement }
  | { readonly type: 'remove-panel'; readonly panel: PanelId }
  | { readonly type: 'activate'; readonly panel: PanelId }
  | { readonly type: 'resize'; readonly split: SplitId; readonly sizes: readonly number[] }
  | { readonly type: 'move-panel'; readonly panel: PanelId; readonly to: Placement }
  /** Moves every panel of a group. Creates a new group (`ids.group`) at the destination, or merges into a group. */
  | { readonly type: 'move-group'; readonly group: GroupId; readonly to: Placement }
  /** Moves a panel into a new root `root`, as its only content. */
  | { readonly type: 'detach'; readonly panel: PanelId; readonly root: RootId; readonly ids: { readonly group: GroupId } };

export type OpErrorCode =
  /** The operation itself is malformed: unknown type, missing or mistyped field. Operations arrive over IPC as untyped data. */
  | 'invalid-op'
  | 'unknown-panel'
  | 'unknown-group'
  | 'unknown-split'
  | 'unknown-root'
  | 'duplicate-panel'
  | 'duplicate-id'
  | 'root-not-empty'
  | 'root-exists'
  | 'invalid-sizes'
  | 'invalid-index'
  | 'invalid-id'
  | 'self-target';

export interface OpError {
  readonly code: OpErrorCode;
  readonly message: string;
}

export type ApplyResult =
  | { readonly ok: true; readonly workspace: Workspace }
  | { readonly ok: false; readonly error: OpError };

export function createWorkspace(): Workspace {
  return { version: SCHEMA_VERSION, roots: {}, panels: {} };
}

/**
 * Applies an operation. Pure and deterministic: the input is never modified, and the same workspace and operation
 * give the same result on every run and in every realm. An invalid operation is reported, never half-applied, and
 * never throws: `op` may be any value, since operations arrive from other windows as untyped data.
 */
export function tryApply(workspace: Workspace, op: Op): ApplyResult {
  const w = clone(workspace) as W;
  try {
    checkOp(op);
    run(w, op);
  } catch (e) {
    if (e instanceof OpFailure) return { ok: false, error: { code: e.code, message: e.message } };
    throw e;
  }
  normalize(w);
  return { ok: true, workspace: w };
}

/** Like {@link tryApply}, but an invalid operation leaves the workspace as it is (same reference). */
export function apply(workspace: Workspace, op: Op): Workspace {
  const r = tryApply(workspace, op);
  return r.ok ? r.workspace : workspace;
}

/* ------------------------------------------------------------------------------------------------ internals */

class OpFailure extends Error {
  readonly code: OpErrorCode;
  constructor(code: OpErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const fail = (code: OpErrorCode, message: string): never => {
  throw new OpFailure(code, message);
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/* ---- operation shape: the model trusts nothing about what it is handed ---- */

const SIDES: readonly string[] = ['left', 'right', 'top', 'bottom'];

function checkPlacement(to: unknown, where: string): void {
  const bad = (m: string): never => fail('invalid-op', `${where}: ${m}`);
  if (!isRecord(to)) return bad('a placement must be an object');
  switch (to.kind) {
    case 'tabs':
      if (!isString(to.group)) bad('tabs placement needs a string group');
      if (to.index !== undefined && typeof to.index !== 'number') bad('index must be a number');
      return;
    case 'edge':
      if (!isString(to.group)) bad('edge placement needs a string group');
      if (!isString(to.side) || !SIDES.includes(to.side)) bad('side must be left, right, top or bottom');
      if (!isRecord(to.ids) || !isString(to.ids.group) || !isString(to.ids.split)) bad('edge placement needs ids.group and ids.split');
      return;
    case 'root':
      if (!isString(to.root)) bad('root placement needs a string root');
      if (!isRecord(to.ids) || !isString(to.ids.group)) bad('root placement needs ids.group');
      return;
    default:
      return bad('unknown placement kind');
  }
}

function checkOp(op: unknown): void {
  const bad = (m: string): never => fail('invalid-op', m);
  if (!isRecord(op)) return bad('an operation must be an object');
  const str = (k: string): void => {
    if (!isString(op[k])) bad(`${String(op.type)}: "${k}" must be a string`);
  };
  switch (op.type) {
    case 'add-root':
    case 'remove-root':
      return str('root');
    case 'add-panel': {
      const p = op.panel;
      if (!isRecord(p) || !isString(p.id) || !isString(p.title)) bad('add-panel: panel needs a string id and title');
      if (isRecord(p) && p.params !== undefined && !isJson(p.params)) bad('add-panel: params must be JSON data');
      return checkPlacement(op.to, 'add-panel.to');
    }
    case 'remove-panel':
    case 'activate':
      return str('panel');
    case 'resize':
      str('split');
      if (!Array.isArray(op.sizes) || !op.sizes.every((s) => typeof s === 'number')) bad('resize: sizes must be a list of numbers');
      return;
    case 'move-panel':
      str('panel');
      return checkPlacement(op.to, 'move-panel.to');
    case 'move-group':
      str('group');
      return checkPlacement(op.to, 'move-group.to');
    case 'detach':
      str('panel');
      str('root');
      if (!isRecord(op.ids) || !isString(op.ids.group)) bad('detach: needs ids.group');
      return;
    default:
      return bad(`unknown operation type "${String(op.type)}"`);
  }
}

/* ---- locating things ---- */

interface GroupLoc {
  readonly root: MRoot;
  readonly node: MTabs;
  readonly parent: MSplit | null;
  readonly index: number;
}

function groups(w: W): GroupLoc[] {
  const out: GroupLoc[] = [];
  const visit = (root: MRoot, node: MNode | null, parent: MSplit | null, index: number): void => {
    if (!node) return;
    if (node.kind === 'tabs') out.push({ root, node, parent, index });
    else node.children.forEach((c, i) => visit(root, c, node, i));
  };
  for (const root of Object.values(w.roots)) visit(root, root.node, null, 0);
  return out;
}

function nodeIds(w: W): Set<string> {
  const ids = new Set<string>();
  const visit = (n: MNode | null): void => {
    if (!n) return;
    ids.add(n.id);
    if (n.kind === 'split') n.children.forEach(visit);
  };
  for (const root of Object.values(w.roots)) visit(root.node);
  return ids;
}

const findGroup = (w: W, id: GroupId): GroupLoc | undefined => groups(w).find((g) => g.node.id === id);
const findPanelGroup = (w: W, panel: PanelId): GroupLoc | undefined => groups(w).find((g) => g.node.panels.includes(panel));

function findSplit(w: W, id: SplitId): MSplit | undefined {
  let found: MSplit | undefined;
  const visit = (n: MNode | null): void => {
    if (!n || n.kind === 'tabs') return;
    if (n.id === id) found = n;
    n.children.forEach(visit);
  };
  for (const root of Object.values(w.roots)) visit(root.node);
  return found;
}

const requireGroup = (w: W, id: GroupId): GroupLoc => findGroup(w, id) ?? fail('unknown-group', `no group with id "${id}"`);
const requireRoot = (w: W, id: RootId): MRoot => own(w.roots, id) ?? fail('unknown-root', `no root with id "${id}"`);

function requireNewId(kind: string, id: string): void {
  if (!isSafeId(id)) fail('invalid-id', `${kind} id must be a non-empty string other than "__proto__"`);
}

function requireFreshIds(w: W, ...ids: string[]): void {
  const used = nodeIds(w);
  const seen = new Set<string>();
  for (const id of ids) {
    requireNewId('node', id);
    if (used.has(id) || seen.has(id)) fail('duplicate-id', `node id "${id}" is already in use`);
    seen.add(id);
  }
}

function clampIndex(index: number | undefined, length: number): number {
  if (index === undefined) return length;
  if (!Number.isFinite(index)) fail('invalid-index', 'index must be a finite number');
  return Math.max(0, Math.min(length, Math.trunc(index)));
}

/* ---- moving things ---- */

/** Removes `panel` from its group. The group may be left empty; normalization removes it afterwards. */
function takePanel(w: W, panel: PanelId): GroupLoc {
  const loc = findPanelGroup(w, panel) ?? fail('unknown-panel', `no panel with id "${panel}" in any group`);
  const i = loc.node.panels.indexOf(panel);
  loc.node.panels.splice(i, 1);
  if (loc.node.active === panel && loc.node.panels.length > 0) {
    loc.node.active = loc.node.panels[Math.min(i, loc.node.panels.length - 1)] as string;
  }
  return loc;
}

/** Places existing panels at `to`. `ids.group` names the new group when one is created. */
function place(w: W, panels: PanelId[], active: PanelId, to: Placement): void {
  switch (to.kind) {
    case 'tabs': {
      const g = requireGroup(w, to.group);
      g.node.panels.splice(clampIndex(to.index, g.node.panels.length), 0, ...panels);
      g.node.active = active;
      return;
    }
    case 'edge': {
      const g = requireGroup(w, to.group);
      requireFreshIds(w, to.ids.group, to.ids.split);
      const created: MTabs = { kind: 'tabs', id: to.ids.group, panels, active };
      const direction = to.side === 'left' || to.side === 'right' ? 'row' : 'column';
      const before = to.side === 'left' || to.side === 'top';
      if (g.parent && g.parent.direction === direction) {
        const half = (g.parent.sizes[g.index] as number) / 2;
        const at = g.index + (before ? 0 : 1);
        g.parent.sizes[g.index] = half;
        g.parent.children.splice(at, 0, created);
        g.parent.sizes.splice(at, 0, half);
      } else {
        const split: MSplit = {
          kind: 'split',
          id: to.ids.split,
          direction,
          children: before ? [created, g.node] : [g.node, created],
          sizes: [0.5, 0.5],
        };
        if (g.parent) g.parent.children[g.index] = split;
        else g.root.node = split;
      }
      return;
    }
    case 'root': {
      const root = requireRoot(w, to.root);
      if (root.node) fail('root-not-empty', `root "${to.root}" already has content`);
      requireFreshIds(w, to.ids.group);
      root.node = { kind: 'tabs', id: to.ids.group, panels, active };
      return;
    }
  }
}

function run(w: W, op: Op): void {
  switch (op.type) {
    case 'add-root': {
      requireNewId('root', op.root);
      if (has(w.roots, op.root)) fail('root-exists', `root "${op.root}" already exists`);
      w.roots[op.root] = { id: op.root, node: null };
      return;
    }
    case 'remove-root': {
      const root = requireRoot(w, op.root);
      if (root.node) fail('root-not-empty', `root "${op.root}" still has content; move or remove its panels first`);
      delete w.roots[op.root];
      return;
    }
    case 'add-panel': {
      const id = op.panel.id;
      requireNewId('panel', id);
      if (has(w.panels, id)) fail('duplicate-panel', `panel "${id}" already exists`);
      w.panels[id] = clone(op.panel) as MutablePanel;
      place(w, [id], id, op.to);
      return;
    }
    case 'remove-panel': {
      if (!has(w.panels, op.panel)) fail('unknown-panel', `no panel with id "${op.panel}"`);
      takePanel(w, op.panel);
      delete w.panels[op.panel];
      return;
    }
    case 'activate': {
      const loc = findPanelGroup(w, op.panel) ?? fail('unknown-panel', `no panel with id "${op.panel}" in any group`);
      loc.node.active = op.panel;
      return;
    }
    case 'resize': {
      const split = findSplit(w, op.split) ?? fail('unknown-split', `no split with id "${op.split}"`);
      const ok = op.sizes.length === split.children.length && op.sizes.every((s) => Number.isFinite(s) && s > 0);
      if (!ok) fail('invalid-sizes', 'sizes must be positive numbers, one per child');
      const sum = op.sizes.reduce((a, b) => a + b, 0);
      split.sizes = op.sizes.map((s) => s / sum);
      return;
    }
    case 'move-panel': {
      const src = findPanelGroup(w, op.panel) ?? fail('unknown-panel', `no panel with id "${op.panel}" in any group`);
      const to = op.to;
      if (to.kind === 'tabs' && to.group === src.node.id) {
        const n = src.node;
        if (to.index === undefined) {
          n.active = op.panel; // dropped on its own group's body: nothing moves
          return;
        }
        // reorder inside the group; `index` counts positions before the panel is lifted out
        const from = n.panels.indexOf(op.panel);
        let at = clampIndex(to.index, n.panels.length);
        if (at > from) at -= 1;
        n.panels.splice(from, 1);
        n.panels.splice(at, 0, op.panel);
        n.active = op.panel;
        return;
      }
      if (to.kind === 'edge' && to.group === src.node.id && src.node.panels.length === 1) {
        fail('self-target', 'a group that holds only this panel cannot be split by it');
      }
      takePanel(w, op.panel);
      place(w, [op.panel], op.panel, to);
      return;
    }
    case 'move-group': {
      const src = requireGroup(w, op.group);
      const to = op.to;
      if ((to.kind === 'tabs' || to.kind === 'edge') && to.group === op.group) {
        fail('self-target', 'a group cannot be moved onto itself');
      }
      const moved = [...src.node.panels];
      const active = src.node.active;
      src.node.panels.length = 0; // emptied now, removed by normalization once the destination is placed
      place(w, moved, active, to);
      return;
    }
    case 'detach': {
      requireNewId('root', op.root);
      if (has(w.roots, op.root)) fail('root-exists', `root "${op.root}" already exists`);
      takePanel(w, op.panel);
      w.roots[op.root] = { id: op.root, node: null };
      place(w, [op.panel], op.panel, { kind: 'root', root: op.root, ids: op.ids });
      return;
    }
  }
}
