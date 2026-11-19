# dock-core constitution

This document states what `dock-core` is, what it refuses to be, and how it changes.
It is short on purpose: when a proposal conflicts with it, the proposal changes first.

## 0. License

MIT. `dock-core` is distributed as a package only and has no runtime of its own.

## 1. Identity and philosophy

`dock-core` is a **docking layout engine that is independent of any host**: a layout model that is plain data,
operations over it that are pure functions, hit-testing for drop zones, and a web-component renderer.

- **Multi-window is a primitive, not an add-on.** A workspace has several *roots*; a root is whatever the host maps
  to a window. Moving a panel or group between roots is a first-class operation.
- **The model knows nothing about the DOM, windows, or transport.** A host (a desktop shell, a browser, a test)
  decides what a root *is* and how operations travel between copies of a workspace.
- **Content belongs to the application.** The engine arranges panels; it does not own what they render.

Non-goals: window management, IPC and OS integration, a widget library, framework adapters (web components are
framework-neutral), compatibility shims for other docking libraries.

## 2. Scope boundary

The library starts from the essential core and widens only when a need is real.

**Core (in from the start)**
- Model: `Workspace` with roots; a node is a tab group or a split, and every panel is registered once in a workspace-wide registry (panel ids are unique across the whole workspace).
- Operations: add or remove a panel, activate a tab, resize a split, move a panel or group to a drop target,
  move between roots, detach into a new root.
- Serialization to and from JSON, with a schema version and a defined failure state.
- Hit-testing from a pointer position and node rectangles to a drop zone (tab bar, center, left, right, top, bottom).
- Renderer: splits with resizable splitters (minimum sizes), tab bars with drag start, drop overlay, slotted content.
- Tab overflow: horizontal scrolling when tabs exceed the available width.
- Keyboard focus across tabs (roving tabindex, arrow keys).

**Not in the core (promoted only on a real need)**: floating panels, maximize, layout history, pinned tabs,
multi-row tabs, tab overflow menu or search, keyboard docking, a theming engine (CSS custom properties only),
framework adapters.

**Promotion rule.** A feature outside the core is added only when (1) a named consumer or use case actually
requires it, (2) it fits without changing the model's invariants or the core paths (it extends the renderer or adds
operations), and (3) the prototype and its conformance checklist are updated first. "It would be nice" and
"another library has it" are not requirements. A feature that cannot satisfy all three is a scope change and is
decided explicitly, not merged.

## 3. Quality standards

**Principles**
1. The model stays pure. No DOM, window, timer, or global state in it.
2. Operations are deterministic. They never generate ids, timestamps, or randomness inside `apply`; whatever an
   operation needs travels in the operation. An invalid operation yields the same result in every copy.
3. Everything serializable stays serializable. A workspace survives `JSON.stringify` and back unchanged.
4. Zero runtime dependencies.
5. Interaction state that is not a decision (a splitter being dragged) never enters the model; the model changes
   when the user commits.

**Preferred patterns**: pure reducers over mutable object graphs (state can be copied between realms);
slotted light-DOM content over render callbacks (the host owns content and its lifecycle); CSS custom
properties for styling.

**Forbidden patterns**: DOM or window references inside the model; hidden global singletons shared between
instances (they break across windows); expanding the public API for a single consumer's convenience.

**Trade-off order**: model purity > renderer features > bundle size > convenience APIs.

## 4. Improvement protocol

| Autonomous | Proposed and reported | Needs explicit discussion |
|---|---|---|
| Internal refactoring; internal algorithms; tests; documentation fixes | Changes to operation or model contracts while the version is below 1.0 (breaking changes are a normal tool there); new operations; renderer behavior changes inside the existing scope | Identity, boundary, or scope changes; adding a runtime dependency; anything promoting a non-core feature without meeting the promotion rule; 1.0 |

Reports state what changed, why, and how to revert it.

## 5. Audit checklist

Check regularly:
- The model package imports nothing from the DOM, a window, or a host.
- `apply` is deterministic: the same workspace and operation produce the same result on every run.
- Serialization round-trips the property tests, including after a failed restore.
- Every feature outside the core traces to a named requirement.
- Runtime dependencies are still zero.
- The conformance checklist still describes what the renderer does.

## 6. Direction

Make the core excellent before widening it: drag and drop that feels exact, resizing without jank, tab overflow
that stays usable with many tabs, keyboard and screen-reader behavior that is not an afterthought. Widen by
real demand, one promoted feature at a time. It will not become a general UI framework.

## 7. Amending this document

If audits show the constitution and reality conflict repeatedly, propose an amendment that states what changed
and why. Do not work around it.
