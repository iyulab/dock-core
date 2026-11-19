import { tryApply, createWorkspace, type ApplyResult, type Op } from '../model/ops.ts';
import { validateWorkspace } from '../model/serialize.ts';
import type { Workspace } from '../model/types.ts';

/**
 * A host in its simplest form: it holds one workspace, applies operations to it, and tells listeners what changed.
 * A host that must put operations in a global order first (several windows sharing one workspace) dispatches each
 * operation only once the order is fixed; the store itself is only the apply-and-notify step.
 */

export type Change =
  | { readonly kind: 'op'; readonly op: Op }
  /** The whole workspace was swapped (restore, or joining from a snapshot). */
  | { readonly kind: 'replace' };

export type Listener = (state: Workspace, change: Change) => void;

export type ReplaceResult = { readonly ok: true } | { readonly ok: false; readonly errors: readonly string[] };

export interface Store {
  getState(): Workspace;
  /**
   * Applies `op`. Same result as {@link tryApply}: an invalid operation is reported, leaves the state as it was
   * (same reference) and is not announced. Listeners run after the state is updated; if some of them throw, the
   * others still run, the operation stays applied, and an `AggregateError` with their errors is thrown afterwards.
   */
  dispatch(op: Op): ApplyResult;
  /** Replaces the workspace if it satisfies every invariant; otherwise reports why and changes nothing. */
  replace(next: Workspace): ReplaceResult;
  /** Returns a function that removes the listener. Safe to call from inside a listener. */
  subscribe(listener: Listener): () => void;
}

export function createStore(initial: Workspace = createWorkspace()): Store {
  const problems = validateWorkspace(initial);
  if (problems.length > 0) throw new Error(`invalid workspace: ${problems[0]}`);

  let state = initial;
  const listeners = new Set<Listener>();

  const announce = (change: Change): void => {
    const errors: unknown[] = [];
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue; // removed by an earlier listener during this announcement
      try {
        listener(state, change);
      } catch (e) {
        errors.push(e);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'a listener threw');
  };

  return {
    getState: () => state,
    dispatch(op) {
      const result = tryApply(state, op);
      if (!result.ok) return result;
      state = result.workspace;
      announce({ kind: 'op', op });
      return result;
    },
    replace(next) {
      const errors = validateWorkspace(next);
      if (errors.length > 0) return { ok: false, errors };
      state = next;
      announce({ kind: 'replace' });
      return { ok: true };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
