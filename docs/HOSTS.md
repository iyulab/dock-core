# Hosting dock-core

dock-core draws a layout and edits it. It never opens a window, sends a message, writes a file or decides where a drag
ends up — that is the **host's** job, and a host is whatever you build around it: a single page, an Electron shell, a
Tauri app (see [tauri-dock](https://github.com/iyulab/tauri-dock)), a server that keeps layouts for several browsers.
This page lists what a host has to supply, what the library gives it for each, and shows the two parts that are easy to
get wrong — ordering operations across copies and relaying a drag between windows — as code that is type-checked and, where it can be, run.

## What a host supplies

| The host… | …because dock-core | What you use |
|---|---|---|
| **maps roots to windows.** A workspace has one or more *roots*; each is drawn by one `<dock-root root="…">`. Which window shows which root is yours. | only knows root ids | `root` attribute, `detach`, `add-root`, `remove-root` |
| **keeps a copy of the workspace per window and applies operations in one agreed order** (only when more than one copy exists). | guarantees that equal copies fed equal operations in equal order stay equal | `tryApply`, `createStore`, [the ordering contract](#several-copies-the-ordering-contract) |
| **delivers operations to every copy and helps a copy that missed some catch up.** | has no transport | [`ordered-replicas.ts`](#ordered-replicas) |
| **supplies panel content.** Every root that can show a panel needs a child for it, `slot`ted by panel id; a panel that arrives in a new window is rebuilt from its `params`. | holds an id, a title and `params`, never content | slots, `params` |
| **stores layouts** and decides what to show when a stored layout cannot be read. | gives a checked round trip | `serialize`, `parseWorkspace`, the element's `error` property and `dock-reset` event |
| **decides where a drag ends** when it can leave the document, and opens a window when a panel is released over nothing. | reports the pointer, shows a drop target on request | `dock-drag` out; `dragOver`, `dragLeave`, `drop` in; [`drag-relay.ts`](#dragging-between-windows) |
| **supplies identifiers for the groups and splits an operation creates** if the default (`crypto.randomUUID`) does not suit. | never creates an id inside the model | the element's `idSource` |

A host with a single document needs only the first and the last rows plus panel content, which is the next section.

## What the renderer needs from its environment

The model, the operations, serialization, hit-testing and the store (`@iyulab/dock-core`) need nothing from a platform: they run in Node, a worker or a page. The renderer (`@iyulab/dock-core/element`) is a web component and needs a browser-grade document:

- **A DOM at import time.** The module defines a class that extends `HTMLElement`, so importing `@iyulab/dock-core/element` in plain Node, a worker or during server-side rendering throws `ReferenceError: HTMLElement is not defined`. Import it only where a document exists, and keep the model side (for example a sequencer or a server that stores layouts) on the main entry.
- **Custom Elements v1** (`customElements.define`; `defineDockRoot()` is a no-op when the tag is already defined) and an **open shadow root with named slots**, which is how panel content you own is shown.
- **Pointer Events with pointer capture** (`setPointerCapture`) for dragging tabs and splitters, plus keyboard events and `selectstart` on the document while a drag lasts (it is cancelled so the pointer crossing your content cannot start a text selection).
- **Layout measurement** (`getBoundingClientRect`, element client sizes and scroll offsets), `CustomEvent`, and `getRootNode()` to find the document or shadow root the element lives in.
- **CSS** with custom properties, `::part`, `:focus-visible` and `inset`. The element brings its own style sheet inside its shadow root; theming is through custom properties and `part`s.
- **Optional:** `crypto.randomUUID` for new group and split ids. Without it (a page served over plain http has none) the element falls back to an id built from the clock, a counter and a random token; pass your own `idSource` to control ids.

A host that is not a browser engine (a terminal, a native toolkit) can still use everything else and draw the layout itself from `Workspace` and `hitTest`; the renderer is not required.

## One page, several roots

The smallest multi-window host is one document with two `<dock-root>` elements and **one store**. There is a single
copy of the workspace, so there is nothing to order: both elements get the same store through `attachStore`, and a panel
dragged from one to the other is an ordinary `move-panel`.

```html
<!-- two-roots.html -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Two dock roots in one page</title>
<style>
  html, body { margin: 0; height: 100%; background: #0f1115; display: flex; gap: 8px; padding: 8px; box-sizing: border-box; }
  dock-root { flex: 1; min-width: 0; }
  .content { padding: 12px 14px; color: #d6dae3; font: 13px sans-serif; }
</style>
<!-- Serve the repository root (any static server) and open /docs/examples/two-roots.html after `npm run build`.
     In an application the import map is your bundler's job. -->
<script type="importmap">
{ "imports": { "@iyulab/dock-core": "../../dist/index.js", "@iyulab/dock-core/element": "../../dist/element/index.js" } }
</script>
</head>
<body>
<dock-root root="left"></dock-root>
<dock-root root="right"></dock-root>
<script type="module">
import { createStore } from '@iyulab/dock-core';
import { attachStore, defineDockRoot } from '@iyulab/dock-core/element';

defineDockRoot();

// One store, two roots. The host's whole job here is to give both elements the same store.
const store = createStore();
const must = (op) => { const r = store.dispatch(op); if (!r.ok) throw new Error(`${op.type}: ${r.error.code}`); };
must({ type: 'add-root', root: 'left' });
must({ type: 'add-root', root: 'right' });
must({ type: 'add-panel', panel: { id: 'files', title: 'Files' }, to: { kind: 'root', root: 'left', ids: { group: 'g1' } } });
must({ type: 'add-panel', panel: { id: 'notes', title: 'Notes' }, to: { kind: 'tabs', group: 'g1' } });
must({ type: 'add-panel', panel: { id: 'log', title: 'Log' }, to: { kind: 'root', root: 'right', ids: { group: 'g2' } } });

for (const el of document.querySelectorAll('dock-root')) {
  // Panel content is the application's: every root gets a child for every panel it may show, slotted by panel id.
  for (const id of Object.keys(store.getState().panels)) {
    const content = document.createElement('div');
    content.className = 'content';
    content.slot = id;
    content.textContent = `content of ${id}`;
    el.append(content);
  }
  attachStore(el, store); // shows the store's workspace for this element's root; applies the intents it raises
}
</script>
</body>
</html>
```

Serve the repository root with any static server after `npm run build`, open `/docs/examples/two-roots.html` and drag
the *Notes* tab onto the other root. The test suite does exactly that with real pointer input.

## Several copies: the ordering contract

When each window keeps its own copy of the workspace (separate documents, processes or machines), the copies stay equal
because operations are pure and deterministic. That holds only if **every copy applies the same operations in the same
order**. A host that provides this has an *ordering layer*; its contract is small:

1. **One place decides the order.** It gives every operation a sequence number, densely: 1, 2, 3, … It does not read the operation.
2. **An operation is not applied where it was made.** A copy that wants to change the layout sends the operation to the ordering layer and applies it when the announcement comes back, like every other copy. (A copy that applied it first could not tell, later, whether the order it assumed was the order that was chosen.)
3. **Each copy applies announcements in sequence order, once.** A number it has already applied is a repeat and is ignored. A number beyond *last applied + 1* is a **gap**: the copy applies nothing and catches up (rule 4).
4. **Catching up is "snapshot plus tail".** The ordering layer keeps the latest snapshot and every operation after it. A copy that is behind asks with the last number it applied and receives the snapshot (only if the copy is older than it) and the operations that follow. A **window that opens late** is the same request with *last applied = 0*; a **lost announcement** is detected by rule 3 and is the same request again. Nothing else is needed.
5. **Any copy can take the snapshot.** It serializes its workspace at its own sequence number and hands it over; the ordering layer drops the operations the snapshot covers. The ordering layer never has to understand a layout.
6. **A refused operation still has a number.** `tryApply` refuses the same operations in every copy (an unknown panel, a duplicate id), so the refusal is not an error of the ordering layer: the number is used, nothing changes, and the copies stay equal.
7. **Operations carry the ids they create.** The element creates them through `idSource` before the operation leaves the window; nothing inside the model draws a random number or reads a clock.
8. **Submissions from one copy keep their order.** If your transport can reorder two calls from the same window (an asynchronous command channel can), send one operation at a time and wait for its announcement, or make the order of submissions part of the transport.

<a id="ordered-replicas"></a>
The following is the whole contract in plain TypeScript with no DOM: a sequencer, two copies and a late joiner. It loses
one announcement on purpose, has a refused operation, and ends by comparing the serialized copies. Run it from a
project that has the package installed with `node ordered-replicas.ts` (Node 22.18 or newer).

```ts
// ordered-replicas.ts
import { createWorkspace, parseWorkspace, serialize, tryApply, type Op, type Workspace } from '@iyulab/dock-core';

/** An operation after the ordering layer has given it its place in the one global order. */
interface Applied {
  seq: number;
  origin: string;
  op: Op;
}

/** What a copy needs to catch up: a stored snapshot (when its own state is older than the snapshot) and every operation after it. */
interface Catchup {
  snapshot: { seq: number; blob: string } | null;
  tail: Applied[];
}

/**
 * The ordering layer. It is the one place that decides the order: it numbers operations densely (1, 2, 3, ...), keeps
 * them until a snapshot covers them, and announces each one to every attached copy. It never looks inside an operation.
 */
class Sequencer {
  #seq = 0;
  #snapshot: { seq: number; blob: string } | null = null;
  #tail: Applied[] = [];
  readonly #copies = new Set<Replica>();
  /** Announcements the transport will lose, as `copy:seq` (a stand-in for a slow or restarting window). */
  readonly lose = new Set<string>();

  attach(copy: Replica): void {
    this.#copies.add(copy);
  }

  submit(origin: string, op: Op): void {
    const applied: Applied = { seq: ++this.#seq, origin, op: structuredClone(op) };
    this.#tail.push(applied);
    for (const copy of this.#copies) {
      if (!this.lose.has(`${copy.name}:${applied.seq}`)) copy.announce(applied);
    }
  }

  /** Any copy may report its state at its own sequence number. Operations up to that number need not be kept. */
  storeSnapshot(seq: number, blob: string): void {
    if (seq > this.#seq) throw new Error('a snapshot cannot come from the future');
    this.#snapshot = { seq, blob };
    this.#tail = this.#tail.filter((a) => a.seq > seq);
  }

  /** `after` is the last sequence number the copy has applied (0: nothing yet). */
  catchup(after: number): Catchup {
    if (this.#snapshot === null || after >= this.#snapshot.seq) {
      return { snapshot: null, tail: structuredClone(this.#tail.filter((a) => a.seq > after)) };
    }
    return { snapshot: this.#snapshot, tail: structuredClone(this.#tail) };
  }
}

/** One copy of the workspace, for example the one inside a window. It applies operations in order and never before. */
class Replica {
  workspace: Workspace = createWorkspace();
  seq = 0;
  resyncs = 0;
  readonly rejected: number[] = [];
  readonly name: string;
  readonly #sequencer: Sequencer;

  constructor(name: string, sequencer: Sequencer) {
    this.name = name;
    this.#sequencer = sequencer;
  }

  /** Sending is not applying: the copy that sends an operation applies it like everyone else, when its announcement arrives. */
  submit(op: Op): void {
    this.#sequencer.submit(this.name, op);
  }

  /** The transport hands over each announcement. */
  announce(applied: Applied): void {
    if (applied.seq <= this.seq) return; // already applied (a repeat)
    if (applied.seq > this.seq + 1) return this.catchUp(); // a gap: an announcement was lost
    this.#apply(applied);
  }

  /** Late join and recovery are the same step: ask for what is missing. */
  catchUp(): void {
    this.resyncs++;
    const { snapshot, tail } = this.#sequencer.catchup(this.seq);
    if (snapshot) {
      const parsed = parseWorkspace(snapshot.blob);
      if (!parsed.ok) throw new Error(`the stored snapshot cannot be restored: ${parsed.error.message}`);
      this.workspace = parsed.workspace;
      this.seq = snapshot.seq;
    }
    for (const applied of tail) this.#apply(applied);
  }

  #apply(applied: Applied): void {
    // The same operations in the same order give the same result everywhere, including the same refusals.
    const result = tryApply(this.workspace, applied.op);
    if (result.ok) this.workspace = result.workspace;
    else this.rejected.push(applied.seq);
    this.seq = applied.seq;
  }
}

const sequencer = new Sequencer();
const a = new Replica('a', sequencer);
const b = new Replica('b', sequencer);
sequencer.attach(a);
sequencer.attach(b);

// Operations carry the ids they create, so every copy creates the same ones.
a.submit({ type: 'add-root', root: 'main' }); // 1
a.submit({ type: 'add-panel', panel: { id: 'editor', title: 'Editor' }, to: { kind: 'root', root: 'main', ids: { group: 'g1' } } }); // 2
a.submit({
  type: 'add-panel',
  panel: { id: 'terminal', title: 'Terminal' },
  to: { kind: 'edge', group: 'g1', side: 'right', ids: { group: 'g2', split: 's1' } },
}); // 3
b.submit({ type: 'move-panel', panel: 'ghost', to: { kind: 'tabs', group: 'g1' } }); // 4: refused by every copy, identically

sequencer.lose.add('b:5'); // window b never hears about 5
a.submit({ type: 'detach', panel: 'terminal', root: 'side', ids: { group: 'g3' } }); // 5: the terminal moves to a new root
a.submit({ type: 'activate', panel: 'editor' }); // 6: b sees 6 right after 4, notices the gap and catches up

sequencer.storeSnapshot(a.seq, serialize(a.workspace)); // from now on 1..6 are not kept
a.submit({ type: 'add-panel', panel: { id: 'inspector', title: 'Inspector' }, to: { kind: 'tabs', group: 'g1' } }); // 7

const late = new Replica('late', sequencer); // a window that opens now: the snapshot at 6, then 7
sequencer.attach(late);
late.catchUp();

const same = serialize(a.workspace) === serialize(b.workspace) && serialize(a.workspace) === serialize(late.workspace);
console.log(
  JSON.stringify({
    same,
    seq: [a.seq, b.seq, late.seq],
    rejected: a.rejected,
    resyncs: { a: a.resyncs, b: b.resyncs, late: late.resyncs },
    roots: Object.keys(late.workspace.roots),
  }),
);
```

It prints `{"same":true,"seq":[7,7,7],"rejected":[4],"resyncs":{"a":0,"b":1,"late":1},"roots":["main","side"]}`: all three
copies are equal at number 7, number 4 was refused everywhere, the window that lost number 5 caught up once, and the
late joiner needed one request (the snapshot at 6 plus number 7).

What the sketch leaves to you: a real transport, persistence of the snapshot, deciding *who* takes snapshots (any copy,
after some number of operations or some idle time), and what to do when a copy cannot restore a snapshot
(`parseWorkspace` returns an error; show it with the element's `error` property rather than starting empty).

## Dragging between windows

The element knows only its own document. A drag that leaves it is relayed by the host over two channels with fixed
directions: **out**, the `dock-drag` event (`start`, `move`, `end`, and whether it was cancelled); **in**, the methods
`dragOver(point, session)`, `dragLeave()` and `drop(point, session)` on the element that should show or take the drop.
`drop` is the only way a drop is committed, and it raises the `move-panel` operation as an intent like any other.

The host has to decide which window is under the cursor, because the window the drag started in holds the pointer and
windows can cover each other; the event's `target` is only a candidate in the source document. Releasing over no dock
window is the host's cue to tear the panel off: submit a `detach` for a new root and open a window for it.

```ts
// drag-relay.ts
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
```

The sketch compiles under `strict` against the declarations; it is not run, because it needs a windowing layer that is
yours. [tauri-dock](https://github.com/iyulab/tauri-dock) implements this for Tauri on Windows (on macOS and Linux it has
no window-under-cursor query yet, so a drag cannot cross windows there).

## Restoring after an update: panels the application no longer has

A saved layout names panels by id. When an update removes a panel, an old layout still lists it, and the element shows its tab with nothing to show in it, because panel content is the application's and the library cannot know which ids you still ship. The library offers no callback for this on purpose; the application compares and removes with ordinary operations. After restoring, compare the workspace's panels with your own registry and remove what is unknown:

```ts
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
```

It prints `{"removed":["legacy-report"],"panels":["files","console"]}`: the unknown panel is gone, the others are exactly where the user left them, and the group that held it keeps its remaining tabs. In a host that shares the workspace between windows, run the comparison in one place only and send each `remove-panel` through the ordering layer like any other operation, so every copy removes the same panels at the same position in the order.

## What this page does not cover

- A real screen reader's output (the renderer's accessibility tree is checked in the test suite).
- Persistence formats, window geometry and session restore: those belong to the host.
- Conflict resolution between *concurrent* edits: the ordering contract puts every edit in one order, so there are no
  conflicts to resolve, only operations that turn out to be refused.
