# dock-core

A docking layout engine that is independent of any host. What a host has to supply, and what the renderer needs from its environment, is listed in [`docs/HOSTS.md`](docs/HOSTS.md).

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
web-component renderer is implemented and tested against a conformance checklist in a real browser. See [`docs/CONSTITUTION.md`](docs/CONSTITUTION.md) for scope, [Stability](#stability) for what may change, and [CHANGELOG.md](CHANGELOG.md).

## Install

Not published yet, so it is used from a checkout:

```
cd dock-core
npm install
npm run build        # writes dist/ (JavaScript and declarations); there is nothing to import before this
```

then, in your app, `npm install ../dock-core`. Two entry points are exported: `@iyulab/dock-core` (model, operations, store) and `@iyulab/dock-core/element` (the renderer). Everything is `0.0.0`, so a package built from an older checkout fails with an unrelated-looking `Cannot find module`; rebuild after every pull.

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
operation, and the host applies it and hands the new workspace back. The event's `detail` is `{ op }` (the type is
`DockIntentDetail`, exported from `@iyulab/dock-core/element`), and it bubbles and is composed, so you can listen on the
element, on an ancestor or on the document.

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

Accessibility: tab groups follow the WAI-ARIA tabs pattern (`tablist`, `tab`, `tabpanel`); a tab and its panel are named by the panel's title, the close control is a `button` named "Close <title>", and the layout has one tab stop per group (arrows, Home, End and Delete work inside it). The test suite checks this against the browser's accessibility tree and with keyboard-only input in a real browser. It does not check what a particular screen reader says: no screen reader has been run against it.

### Panel content, removing and restoring

- **Panel content is yours.** The workspace holds a panel's id, title and `params`, never its content. The element shows, for each tab group, the child whose `slot` is the active panel's id; the other children stay in the DOM, hidden. Give every root that can show a panel a child for it, and create one when a panel appears.
- **Moving a panel moves data only.** Between roots (windows) the panel's id, title and `params` travel; the node in the old root stays where it is, with whatever was typed or scrolled in it, and the new root shows its own node for that id. State that should follow a panel belongs in your application, keyed by panel id.
- **The tab's ✕ (and the Delete key on a focused tab) removes the panel from the workspace** with a `remove-panel` operation; it is not "hide". To get a panel back, add it again with `add-panel`.
- **A root the workspace does not have** (a missing `root` attribute, no workspace attached, an id that is not in it) shows a message that names the cause instead of a blank rectangle, and accepts no drop.
- **A layout that could not be restored** is shown by setting `error`; the element then offers a "Reset layout" button that raises `dock-reset`:

```ts
element.error = 'The stored layout was written by a newer version.'; // shows the reason and the button
element.addEventListener('dock-reset', () => {
  element.error = null;
  store.replace(defaultWorkspace); // yours: a workspace that passes validation
});
```

A host that shares one workspace between windows puts operations in one global order first and dispatches each
operation only once its place is fixed; the store is the apply-and-notify step. [`docs/HOSTS.md`](docs/HOSTS.md) lists what a host has to supply and shows the ordering contract and the drag relay as code you can run.

## Stability

Every package is `0.0.0`. Anything may change without a deprecation period: the operation types and their fields, placements, the element's attributes, events and parts. [CHANGELOG.md](CHANGELOG.md) lists each change a consumer has to follow, marked **Breaking**. What is meant to stay: a workspace is plain JSON and operations are pure and deterministic, so copies fed the same operations in the same order stay identical; and a serialized workspace carries a `version`, which `parseWorkspace` checks, refusing a version it does not know instead of misreading it.

**Saved layouts.** There is one schema version today, `1`. `parseWorkspace` refuses a version greater than the one it supports with a `version` error (the renderer's `error` property shows it with a reset action), refuses a missing, non-integer or non-positive version with a `shape` error, and reads a supported version as it is. There is no migration step: no older version exists yet, and when one does, the CHANGELOG will say how it is read. Until then a host that must survive a format change keeps its own fallback (a default workspace) for the cases `parseWorkspace` refuses.

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
