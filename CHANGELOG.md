# Changelog

Nothing has been released yet and every package is `0.0.0`: the list below is what the working tree contains. Changes a
consumer has to follow are marked **Breaking**. See *Stability* in the README for what may change without notice.

## Unreleased

### Added

- **Model**: a JSON-serializable `Workspace` of roots, splits, tab groups and panels; pure, deterministic operations
  (`apply`, `tryApply`) with typed errors; serialization with a `version` field and validation; hit-testing of a pointer
  against measured rectangles (drop zones, regions to highlight, tab insertion index).
- **Store**: `createStore` applies operations, announces what changed and replaces the whole workspace after validating it.
- **Renderer** (`@iyulab/dock-core/element`): the `<dock-root>` web component: splits with resizable splitters, tab groups
  with overflow scrolling, drag and drop with an overlay and an insertion line, keyboard navigation, empty / error /
  loading states, theming through CSS custom properties and parts, and the `dock-intent`, `dock-drag` and `dock-reset`
  events. `attachStore` wires an element to a store.
- A built package (`dist`, two entry points) that installs into an empty project and runs under strict TypeScript.
- README: installing from a checkout, panel content, removing and restoring a layout.

### Changed

- Tab groups expose the whole ARIA tabs pattern: the body is a `tabpanel` labelled by the selected tab, which points back with `aria-controls`, and the close control has the role `button` (before, only `tablist` and `tab` were exposed, so a screen reader could not tell which panel a tab shows).

### Fixed

- An element whose root is not in the workspace stayed blank. It now says why (no workspace attached, no `root` attribute,
  or an id the workspace does not have) and names the root.
- While a tab is dragged, text selection is cancelled for the whole page, so the pointer crossing content the application
  owns cannot start a selection.
