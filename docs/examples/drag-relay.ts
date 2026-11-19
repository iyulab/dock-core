import type { Op, Point } from '@iyulab/dock-core';
import type { DockDragDetail, DockRoot, DragSession } from '@iyulab/dock-core/element';

/** Where the cursor is, as only the host can know it: which dock window is under it (windows overlap) and where inside it. */
export interface CursorHit {
  window: string;
  root: string;
  /** The cursor in that window's viewport coordinates. */
  point: Point;
}

/** What the host's windowing layer provides. This is yours, not dock-core's: a native cursor query, a message channel. */
export interface WindowLayer {
  /** The dock window under the cursor right now, or null over no dock window. */
  cursor(): Promise<CursorHit | null>;
  send(window: string, message: Relayed): void;
  /** Opens a window that shows `root`. */
  openWindow(root: string): Promise<void>;
}

export type Relayed =
  | { kind: 'over'; root: string; point: Point; session: DragSession }
  | { kind: 'drop'; root: string; point: Point; session: DragSession }
  | { kind: 'leave'; root: string };

/**
 * In the window a drag starts in. The element reports what the pointer does (`dock-drag`) and never decides where a
 * drop lands: this window holds the pointer, so only the host can say which window is really under the cursor.
 * A sketch: a real host also discards answers from `cursor()` that arrive after a newer one.
 */
export function relayDrags(layer: WindowLayer, submit: (op: Op) => void, newId: (kind: 'root' | 'group') => string): () => void {
  let over: { window: string; root: string } | null = null;
  const leave = (): void => {
    if (over) layer.send(over.window, { kind: 'leave', root: over.root });
    over = null;
  };

  const onDrag = (event: Event): void => {
    const { phase, session, cancelled } = (event as CustomEvent<DockDragDetail>).detail;
    event.preventDefault(); // the host decides; without this a page's own roots would take the drop themselves
    if (phase === 'start') return;
    if (phase === 'end' && cancelled) return leave();
    void layer.cursor().then(async (hit) => {
      if (phase === 'move') {
        if (over && (hit === null || hit.window !== over.window || hit.root !== over.root)) leave();
        if (hit) {
          over = { window: hit.window, root: hit.root };
          layer.send(hit.window, { kind: 'over', root: hit.root, point: hit.point, session });
        }
      } else if (hit) {
        if (over && (hit.window !== over.window || hit.root !== over.root)) leave();
        over = null; // `drop` clears the highlight itself
        layer.send(hit.window, { kind: 'drop', root: hit.root, point: hit.point, session });
      } else {
        leave();
        const root = newId('root'); // released over no dock window: tear the panel off into a new root and show it
        submit({ type: 'detach', panel: session.panel, root, ids: { group: newId('group') } });
        await layer.openWindow(root);
      }
    });
  };

  document.addEventListener('dock-drag', onDrag);
  return () => document.removeEventListener('dock-drag', onDrag);
}

/** In every window: run what the source window relays on the element that shows the root. */
export function receiveDrags(find: (root: string) => DockRoot | null): (message: Relayed) => void {
  return (message) => {
    const element = find(message.root);
    if (!element) return;
    if (message.kind === 'over') element.dragOver(message.point, message.session);
    else if (message.kind === 'drop') element.drop(message.point, message.session);
    else element.dragLeave();
  };
}
