# Changelog

Nothing has been released yet and every package is `0.0.0`: the list below is what the working tree contains. Changes a
consumer has to follow are marked **Breaking**. See *Stability* in the README for what may change without notice.

## Unreleased

Nothing has been tagged, so the entries are grouped by the day they were committed. If you run a checkout, `git log -1 --format=%cs` gives its date; the sections from that date forward are the ones that may apply to you.

### 2026-11-20

#### Added

- `DockIntentDetail`, exported from `@iyulab/dock-core/element`: the type of a `dock-intent` event's `detail` (`{ op }`). The event bubbles and is composed.
- README and `docs/HOSTS.md`: installing from a checkout, panel content, removing and restoring a layout, what a host supplies, what the renderer needs from its environment, ordering operations across copies and relaying a drag between windows (as runnable examples), restoring after an update that removed a panel, and how saved layouts are versioned.
- A changelog and a stability note.

#### Changed

- A tab, and the panel it shows, are named by the panel's title alone. The tab's accessible name used to be computed from its content and so read "Title Close Title"; the tab and the panel now point at the title element with `aria-labelledby`. Checked against the browser's accessibility tree, and the layout against a keyboard-only pass (one tab stop per group, no trap, arrows and Delete).
- Tab groups expose the whole ARIA tabs pattern: the body is a `tabpanel` labelled by the selected tab, which points back with `aria-controls`, and the close control has the role `button` (before, only `tablist` and `tab` were exposed, so a screen reader could not tell which panel a tab shows).

#### Fixed

- The default id source could mint the same group or split id in two windows. Without `crypto.randomUUID` (a page served over plain http has none) it used a clock reading and a per-window counter, so two windows creating a group in the same millisecond collided. It now also carries a random token drawn once per source.
- An element whose root is not in the workspace stayed blank. It now says why (no workspace attached, no `root` attribute,
  or an id the workspace does not have) and names the root.
- While a tab is dragged, text selection is cancelled for the whole page, so the pointer crossing content the application
  owns cannot start a selection.

### 2026-11-19

#### Added

- **Model**: a JSON-serializable `Workspace` of roots, splits, tab groups and panels; pure, deterministic operations
  (`apply`, `tryApply`) with typed errors; serialization with a `version` field and validation; hit-testing of a pointer
  against measured rectangles (drop zones, regions to highlight, tab insertion index).
- **Store**: `createStore` applies operations, announces what changed and replaces the whole workspace after validating it.
- **Renderer** (`@iyulab/dock-core/element`): the `<dock-root>` web component: splits with resizable splitters, tab groups
  with overflow scrolling, drag and drop with an overlay and an insertion line, keyboard navigation, empty / error /
  loading states, theming through CSS custom properties and parts, and the `dock-intent`, `dock-drag` and `dock-reset`
  events. `attachStore` wires an element to a store.
- A built package (`dist`, two entry points) that installs into an empty project and runs under strict TypeScript.
