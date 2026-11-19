import type { Store } from '../controller/store.ts';
import type { DockIntentDetail, DockRoot } from './dock-root.ts';

/**
 * Wires a root element to a store: the element shows the store's workspace and its intents are dispatched to the
 * store. This is the whole host for a page without windows; a host that orders operations first (several windows)
 * dispatches to its own sequencer instead. Returns a function that undoes the wiring.
 */
export function attachStore(element: DockRoot, store: Store): () => void {
  element.workspace = store.getState();
  const off = store.subscribe((workspace) => {
    element.workspace = workspace;
  });
  const onIntent = (event: Event): void => {
    store.dispatch((event as CustomEvent<DockIntentDetail>).detail.op);
  };
  element.addEventListener('dock-intent', onIntent);
  return () => {
    off();
    element.removeEventListener('dock-intent', onIntent);
  };
}
