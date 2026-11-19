// unknown-panels.ts
import { apply, createStore, createWorkspace, parseWorkspace, serialize, type Workspace } from '@iyulab/dock-core';

/** A layout an older build of the application saved: it still has a panel this build no longer ships. */
function savedByAnOlderBuild(): string {
  let ws: Workspace = createWorkspace();
  const step = (op: Parameters<typeof apply>[1]): void => {
    ws = apply(ws, op);
  };
  step({ type: 'add-root', root: 'main' });
  step({ type: 'add-panel', panel: { id: 'files', title: 'Files' }, to: { kind: 'root', root: 'main', ids: { group: 'g1' } } });
  step({ type: 'add-panel', panel: { id: 'legacy-report', title: 'Legacy report' }, to: { kind: 'tabs', group: 'g1' } });
  step({ type: 'add-panel', panel: { id: 'console', title: 'Console' }, to: { kind: 'edge', group: 'g1', side: 'bottom', ids: { group: 'g2', split: 's1' } } });
  return serialize(ws);
}

/** The panels this build of the application can show: the host's own registry. */
const registry = new Set(['files', 'editor', 'console']);

const parsed = parseWorkspace(savedByAnOlderBuild());
if (!parsed.ok) throw new Error(`the stored layout cannot be restored: ${parsed.error.message}`);
const store = createStore(parsed.workspace);

// The recipe: compare what the restored workspace holds with what the application can show, and remove the rest with
// ordinary operations. Panels the application knows are left exactly where the user put them.
const removed: string[] = [];
for (const id of Object.keys(store.getState().panels)) {
  if (registry.has(id)) continue;
  const result = store.dispatch({ type: 'remove-panel', panel: id });
  if (result.ok) removed.push(id);
}

console.log(JSON.stringify({ removed, panels: Object.keys(store.getState().panels) }));
