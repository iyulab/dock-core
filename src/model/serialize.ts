import { has, isJson, isRecord, isSafeId, isString } from './guards.ts';
import { normalize } from './normalize.ts';
import { SCHEMA_VERSION, type MutableWorkspace, type Node, type Workspace } from './types.ts';

export type ParseErrorCode = 'syntax' | 'version' | 'shape' | 'invariant';

export interface ParseError {
  readonly code: ParseErrorCode;
  readonly message: string;
  readonly details?: readonly string[];
}

export type ParseResult =
  | { readonly ok: true; readonly workspace: Workspace }
  | { readonly ok: false; readonly error: ParseError };

export function serialize(workspace: Workspace): string {
  return JSON.stringify(workspace);
}

/**
 * Restores a workspace from JSON text or an already parsed value. Never throws: a layout that cannot be restored
 * comes back as an error the host can show. The result is normalized, so a hand-edited layout with an empty group
 * is repaired rather than rejected.
 */
export function parseWorkspace(input: unknown): ParseResult {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch (e) {
      return err('syntax', `not valid JSON: ${(e as Error).message}`);
    }
  }
  if (!isRecord(value)) return err('shape', 'a workspace must be an object');
  const version = value.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return err('shape', 'version must be a positive integer');
  }
  if (version > SCHEMA_VERSION) {
    return err('version', `schema version ${version} is newer than the supported version ${SCHEMA_VERSION}`);
  }
  const shape = shapeProblems(value);
  if (shape.length) return err('shape', 'the layout has the wrong shape', shape);

  const w = JSON.parse(JSON.stringify(value)) as MutableWorkspace;
  normalize(w);
  const problems = validateWorkspace(w);
  if (problems.length) return err('invariant', 'the layout breaks a workspace invariant', problems);
  return { ok: true, workspace: w };
}

/** Lists every violated invariant of a workspace; empty means valid. Assumes the shape is right. */
export function validateWorkspace(w: Workspace): string[] {
  const problems: string[] = [];
  const seenNodes = new Set<string>();
  const seenPanels = new Set<string>();

  for (const [key, root] of Object.entries(w.roots)) {
    if (root.id !== key) problems.push(`root key "${key}" does not match its id "${root.id}"`);
    const visit = (n: Node): void => {
      if (seenNodes.has(n.id)) problems.push(`node id "${n.id}" is used more than once`);
      seenNodes.add(n.id);
      if (n.kind === 'tabs') {
        if (n.panels.length === 0) problems.push(`group "${n.id}" has no panels`);
        if (!n.panels.includes(n.active)) problems.push(`group "${n.id}": active panel "${n.active}" is not in the group`);
        for (const p of n.panels) {
          if (seenPanels.has(p)) problems.push(`panel "${p}" appears in more than one place`);
          seenPanels.add(p);
          if (!has(w.panels, p)) problems.push(`panel "${p}" is in a group but not registered`);
        }
      } else {
        if (n.children.length === 0) problems.push(`split "${n.id}" has no children`);
        if (n.sizes.length !== n.children.length) problems.push(`split "${n.id}": sizes do not match children`);
        if (n.sizes.some((s) => !(Number.isFinite(s) && s > 0))) problems.push(`split "${n.id}": sizes must be positive`);
        n.children.forEach(visit);
      }
    };
    if (root.node) visit(root.node);
  }
  for (const [key, panel] of Object.entries(w.panels)) {
    if (panel.id !== key) problems.push(`panel key "${key}" does not match its id "${panel.id}"`);
    if (!seenPanels.has(key)) problems.push(`panel "${key}" is registered but not placed in any group`);
  }
  return problems;
}

/* ------------------------------------------------------------------------------------------------ shape */

const err = (code: ParseErrorCode, message: string, details?: string[]): ParseResult => ({
  ok: false,
  error: details ? { code, message, details } : { code, message },
});

function shapeProblems(v: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (!isRecord(v.roots)) return ['"roots" must be an object'];
  if (!isRecord(v.panels)) return ['"panels" must be an object'];
  for (const [k, p] of Object.entries(v.panels)) {
    if (!isSafeId(k)) out.push(`"${k}" is not a usable panel id`);
    if (!isRecord(p) || !isString(p.id) || !isString(p.title)) out.push(`panel "${k}" needs a string id and title`);
    else if (p.params !== undefined && !isJson(p.params)) out.push(`panel "${k}": params must be JSON data`);
  }
  const node = (n: unknown, where: string): void => {
    if (!isRecord(n) || !isSafeId(n.id)) return void out.push(`${where}: a node needs a usable string id`);
    if (n.kind === 'tabs') {
      if (!Array.isArray(n.panels) || !n.panels.every(isString)) out.push(`${where}: tabs.panels must be a list of strings`);
      if (!isString(n.active)) out.push(`${where}: tabs.active must be a string`);
    } else if (n.kind === 'split') {
      if (n.direction !== 'row' && n.direction !== 'column') out.push(`${where}: split.direction must be "row" or "column"`);
      if (!Array.isArray(n.children)) return void out.push(`${where}: split.children must be a list`);
      if (!Array.isArray(n.sizes) || !n.sizes.every((s) => typeof s === 'number')) out.push(`${where}: split.sizes must be numbers`);
      n.children.forEach((c, i) => node(c, `${where}/${i}`));
    } else out.push(`${where}: unknown node kind`);
  };
  for (const [k, r] of Object.entries(v.roots)) {
    if (!isSafeId(k)) out.push(`"${k}" is not a usable root id`);
    if (!isRecord(r) || !isString(r.id)) out.push(`root "${k}" needs a string id`);
    else if (r.node !== null) node(r.node, `root "${k}"`);
  }
  return out;
}
