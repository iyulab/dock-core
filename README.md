# dock-core

A docking layout engine that is independent of any host.

- **A layout is plain data.** Splits, tab groups and panels live in a JSON-serializable `Workspace` with no DOM,
  window or transport in it, so copies of it can live in different windows or processes.
- **Operations are pure functions.** `apply(workspace, op)` returns a new workspace, never modifies its input, and is
  deterministic: the same workspace and operation give the same result in every copy. Anything an operation creates
  (ids) travels inside the operation.
- **Multi-window is a primitive.** A workspace has several *roots*; a root is whatever your host maps to a window.
  Moving a panel or group between roots, or detaching a panel into a new root, are ordinary operations.
- **Hit-testing is geometry.** Give it measured rectangles and a pointer position; it tells you the drop zone and the
  region to highlight.
- Zero runtime dependencies.

Status: pre-release. The data model, operations, serialization, hit-testing and a minimal store are implemented and tested; the
web-component renderer is implemented and tested against a conformance checklist in a real browser. See [`docs/CONSTITUTION.md`](docs/CONSTITUTION.md) for scope.

```ts
import { createWorkspace, apply, tryApply } from '@iyulab/dock-core';

let ws = createWorkspace();
ws = apply(ws, { type: 'add-root', root: 'main' });
ws = apply(ws, {
  type: 'add-panel',
  panel: { id: 'editor', title: 'main.rs' },
  to: { kind: 'root', root: 'main', ids: { group: 'g1' } },
});
// split a new panel to the right of the editor group
ws = apply(ws, {
  type: 'add-panel',
  panel: { id: 'term', title: 'Terminal' },
  to: { kind: 'edge', group: 'g1', side: 'right', ids: { group: 'g2', split: 's1' } },
});
// move it into a new root (e.g. a new window)
ws = apply(ws, { type: 'detach', panel: 'term', root: 'win2', ids: { group: 'g3' } });

const r = tryApply(ws, { type: 'move-panel', panel: 'nope', to: { kind: 'tabs', group: 'g1' } });
// r.ok === false, r.error.code === 'unknown-panel'; apply() would return ws unchanged
```

A host that just needs to hold a workspace, apply operations and tell listeners what changed can use the store:

```ts
import { createStore } from '@iyulab/dock-core';

const store = createStore();
const off = store.subscribe((state, change) => render(state)); // change.kind: 'op' | 'replace'
store.dispatch({ type: 'add-root', root: 'main' }); // same result as tryApply; invalid operations are not announced
store.replace(restoredWorkspace); // validated; reports the problems and changes nothing if it is not sound
```

## Renderer

`@iyulab/dock-core/element` is a web component, `<dock-root>`, that draws one root of a workspace. It is a controlled
component: it never changes its own workspace. What the user decides leaves as a `dock-intent` event carrying an
operation, and the host applies it and hands the new workspace back.

```html
<dock-root root="main">
  <!-- panel content is yours: a direct child per panel, slotted by panel id -->
  <div slot="editor">…</div>
  <div slot="term">…</div>
</dock-root>
```

```ts
import { createStore } from '@iyulab/dock-core';
import { attachStore, defineDockRoot } from '@iyulab/dock-core/element';

defineDockRoot();
const store = createStore(/* a workspace with a root "main" */);
attachStore(document.querySelector('dock-root')!, store); // shows the store's workspace, dispatches its intents
```

Splits with resizable splitters (minimum size enforced), tab groups with overflow scrolling, drag and drop with a
drop-zone overlay and tab insertion line, keyboard navigation (roving tabindex), empty / error / loading states.
Several `<dock-root>` elements in one document can move panels between each other. A host that spans windows listens to
`dock-drag` (cancelable) and drives the target with `dragOver` / `dragLeave` / `drop`; the element never creates windows.
Theming is through CSS custom properties (`--dock-accent`, `--dock-bg`, …) and `part`s.

A host that shares one workspace between windows puts operations in one global order first and dispatches each
operation only once its place is fixed; the store is the apply-and-notify step.

## Develop

Requires Node 22.18 or newer (TypeScript is run directly through type stripping).

```
npm install
npm test       # model, store, package, and the renderer in headless Chrome or Edge (set DOCK_BROWSER to choose one)
npm run typecheck
npm run build   # emits dist/ (JavaScript and declarations); tests pack and install it into an empty project
```

## License

MIT
