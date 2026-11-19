import { hitTest, placementFor, tabInsertIndex, type GroupGeometry, type Hit, type Point, type Rect } from '../model/hit-test.ts';
import type { Op } from '../model/ops.ts';
import type { GroupId, Node, PanelId, RootId, Split, SplitId, Tabs, Workspace } from '../model/types.ts';
import { defaultIdSource, type IdSource } from './ids.ts';
import { STYLES } from './styles.ts';

/** A drag in progress. Carries identifiers only: the panel itself lives in the shared workspace registry. */
export interface DragSession {
  readonly id: string;
  readonly panel: PanelId;
  readonly fromRoot: RootId;
  readonly title: string;
}

export interface DockDragDetail {
  readonly phase: 'start' | 'move' | 'end';
  readonly session: DragSession;
  /** Pointer position in this document's viewport. */
  readonly client: Point;
  /** The dock root of this document under the pointer, as a candidate only: another window may cover it. */
  readonly target: { readonly root: RootId } | null;
  /** On `end`: the drag was cancelled (Escape, pointer cancel, or the workspace changed underneath it). */
  readonly cancelled: boolean;
}

export const MIN_GROUP_SIZE = 90;
const DRAG_THRESHOLD = 5;

let dragCounter = 0;
const toRect = (r: DOMRect): Rect => ({ x: r.left, y: r.top, width: r.width, height: r.height });

interface ActiveDrag {
  readonly session: DragSession;
  readonly pointerId: number;
  readonly origin: Point;
  readonly tab: HTMLElement;
  started: boolean;
  last: Point;
  /** Same-document root currently showing a drop overlay because of the default handling. */
  over: DockRoot | null;
  readonly onMove: (e: PointerEvent) => void;
  readonly onUp: (e: PointerEvent) => void;
  readonly onCancel: () => void;
  readonly onKey: (e: KeyboardEvent) => void;
  /** Cancels text selection for the whole page while the drag lasts: the pointer crosses content the app owns. */
  readonly onSelect: (e: Event) => void;
}

interface DropTarget {
  readonly hit: Hit | null;
  readonly tabIndex?: number;
  readonly region: Rect;
  readonly label: string;
  readonly insertAt?: { readonly x: number; readonly top: number; readonly height: number };
}

/**
 * Renders one root of a workspace. A controlled component: it never changes its own workspace. What the user decides
 * leaves as a `dock-intent` event carrying an operation; the host applies it and hands the new workspace back.
 *
 * Panel content is the application's: put each panel as a direct child with `slot="<panel id>"`. Only the active
 * panel of each group is assigned to a slot, so inactive content stays alive but hidden.
 */
export class DockRoot extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['root'];
  }

  /** Allocates ids for groups and splits created by operations built here. Replace it to control id policy. */
  idSource: IdSource = defaultIdSource;

  #workspace: Workspace | null = null;
  #root: RootId = '';
  #error: string | null = null;
  readonly #loading = new Set<PanelId>();

  readonly #surface: HTMLElement;
  readonly #ghost: HTMLElement;
  readonly #overlay: HTMLElement;
  readonly #overlayLabel: HTMLElement;
  readonly #insert: HTMLElement;

  readonly #groups = new Map<GroupId, Tabs>();
  readonly #splits = new Map<SplitId, Split>();
  #focusNext: { panel?: PanelId; group?: GroupId } | null = null;
  #ariaCount = 0;
  #drag: ActiveDrag | null = null;
  #suppressClick = false;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLES;
    this.#surface = el('div', 'root');
    this.#ghost = el('div', 'ghost');
    this.#overlayLabel = el('span');
    this.#overlay = el('div', 'overlay');
    this.#overlay.append(this.#overlayLabel);
    this.#insert = el('div', 'insert');
    shadow.append(style, this.#surface, this.#ghost, this.#overlay, this.#insert);

    this.#surface.addEventListener('click', (e) => this.#onClick(e));
    this.#surface.addEventListener('keydown', (e) => this.#onKeyDown(e));
    this.#surface.addEventListener('pointerdown', (e) => this.#onPointerDown(e));
    this.#surface.addEventListener('wheel', (e) => this.#onWheel(e), { passive: false });
  }

  /* ------------------------------------------------------------------------------------------ properties */

  get workspace(): Workspace | null {
    return this.#workspace;
  }
  set workspace(value: Workspace | null) {
    if (value === this.#workspace) return;
    this.#workspace = value;
    this.#render();
  }

  get root(): RootId {
    return this.#root;
  }
  set root(value: RootId) {
    if (this.getAttribute('root') !== value) this.setAttribute('root', value);
    else this.#setRoot(value);
  }

  /** A layout that could not be restored: shows the reason and a "Reset layout" action (event `dock-reset`). */
  get error(): string | null {
    return this.#error;
  }
  set error(value: string | null) {
    this.#error = value;
    this.#render();
  }

  /** Host-driven loading state for a panel: its slot is replaced by a skeleton while it is `loading`. */
  setPanelState(panel: PanelId, state: 'loading' | 'ready'): void {
    const changed = state === 'loading' ? !this.#loading.has(panel) : this.#loading.delete(panel);
    if (state === 'loading') this.#loading.add(panel);
    if (changed) this.#render();
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === 'root') this.#setRoot(value ?? '');
  }

  /* ------------------------------------------------------------------------------- drop target (any drag) */

  /** Shows where a drag that arrived at `point` (viewport coordinates) would land. */
  dragOver(point: Point, session: DragSession): void {
    this.#showTarget(this.#resolve(point, session));
  }

  dragLeave(): void {
    this.#showTarget(null);
  }

  /** Commits a drop at `point`: emits the `move-panel` operation, or nothing when there is no valid target. */
  drop(point: Point, session: DragSession): void {
    const target = this.#resolve(point, session);
    this.#showTarget(null);
    if (!target) return;
    const placement = target.hit
      ? placementFor(target.hit, { group: this.idSource('group'), split: this.idSource('split') }, target.tabIndex)
      : ({ kind: 'root', root: this.#root, ids: { group: this.idSource('group') } } as const);
    this.#emitIntent({ type: 'move-panel', panel: session.panel, to: placement });
  }

  /* --------------------------------------------------------------------------------------------- render */

  #setRoot(value: RootId): void {
    if (value === this.#root) return;
    this.#root = value;
    this.#render();
  }

  #render(): void {
    if (this.#drag?.started) this.#finishDrag(this.#drag.last, true);
    const scrolls = new Map<GroupId, number>();
    for (const bar of this.#surface.querySelectorAll<HTMLElement>('.tabs > .bar')) {
      const gid = (bar.parentElement as HTMLElement).dataset['gid'];
      if (gid !== undefined) scrolls.set(gid, bar.scrollLeft);
    }
    const focused = (this.shadowRoot?.activeElement as HTMLElement | null)?.closest?.('.tab') as HTMLElement | null | undefined;
    const keepFocus = focused?.dataset['pid'];

    this.#groups.clear();
    this.#splits.clear();
    this.#surface.replaceChildren();
    this.#surface.dataset['state'] = 'ready';

    if (this.#error !== null) {
      this.#surface.dataset['state'] = 'error';
      this.#surface.append(this.#errorState(this.#error));
    } else {
      const record = this.#workspace && Object.hasOwn(this.#workspace.roots, this.#root) ? this.#workspace.roots[this.#root] : undefined;
      if (!record) {
        this.#surface.dataset['state'] = 'no-root';
        this.#surface.append(this.#noRootState());
      } else if (record.node === null) {
        this.#surface.dataset['state'] = 'empty';
        this.#surface.append(this.#emptyState());
      } else {
        this.#surface.append(this.#renderNode(record.node));
      }
    }

    for (const bar of this.#surface.querySelectorAll<HTMLElement>('.tabs > .bar')) {
      const gid = (bar.parentElement as HTMLElement).dataset['gid'];
      if (gid !== undefined && scrolls.has(gid)) bar.scrollLeft = scrolls.get(gid) ?? 0;
      revealActive(bar);
    }

    const want = this.#focusNext;
    this.#focusNext = null;
    if (want?.panel !== undefined) this.#focusTab(want.panel);
    else if (want?.group !== undefined) {
      const g = this.#groups.get(want.group);
      if (g) this.#focusTab(g.active);
    } else if (keepFocus !== undefined) this.#focusTab(keepFocus);
  }

  #renderNode(node: Node): HTMLElement {
    if (node.kind === 'tabs') return this.#renderTabs(node);
    this.#splits.set(node.id, node);
    const split = el('div', `split ${node.direction}`);
    split.dataset['splitId'] = node.id;
    const total = node.sizes.reduce((a, b) => a + b, 0) || 1;
    node.children.forEach((child, i) => {
      if (i > 0) {
        const gutter = el('div', 'gutter');
        gutter.dataset['index'] = String(i);
        gutter.setAttribute('part', 'splitter');
        split.append(gutter);
      }
      const cell = el('div', 'cell');
      cell.style.flex = `${(((node.sizes[i] ?? 0) / total) * 100).toString()} 1 0`;
      cell.append(this.#renderNode(child));
      split.append(cell);
    });
    return split;
  }

  #renderTabs(node: Tabs): HTMLElement {
    this.#groups.set(node.id, node);
    // ids that tie the selected tab to the panel it shows (panel ids are arbitrary strings, so these are generated)
    const bodyId = `dock-body-${++this.#ariaCount}`;
    const tabId = (index: number): string => `${bodyId}-tab-${index}`;
    const labelId = (index: number): string => `${tabId(index)}-label`;
    const group = el('div', 'tabs');
    group.dataset['gid'] = node.id;
    const bar = el('div', 'bar');
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('part', 'tabbar');
    node.panels.forEach((id, index) => {
      const panel = this.#workspace && Object.hasOwn(this.#workspace.panels, id) ? this.#workspace.panels[id] : undefined;
      const active = id === node.active;
      const tab = el('div', 'tab');
      tab.id = tabId(index);
      tab.dataset['pid'] = id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(active));
      if (active) tab.setAttribute('aria-controls', bodyId);
      tab.setAttribute('part', active ? 'tab tab-active' : 'tab');
      tab.tabIndex = active ? 0 : -1;
      const label = el('span', 'label');
      label.id = labelId(index);
      label.textContent = panel?.title ?? id;
      // the tab is named by its title alone: a name computed from its content would read "Title Close Title"
      tab.setAttribute('aria-labelledby', label.id);
      const close = el('span', 'close');
      close.dataset['close'] = id;
      close.setAttribute('role', 'button');
      close.setAttribute('aria-label', `Close ${panel?.title ?? id}`);
      close.textContent = '✕';
      tab.append(label, close);
      bar.append(tab);
    });
    const body = el('div', 'body');
    body.id = bodyId;
    body.setAttribute('role', 'tabpanel');
    const activeIndex = node.panels.indexOf(node.active);
    // the panel is named by the selected tab's title (the tab also holds the close control, which is not part of the name)
    if (activeIndex >= 0) body.setAttribute('aria-labelledby', labelId(activeIndex));
    body.setAttribute('part', 'body');
    if (this.#loading.has(node.active)) {
      const skeleton = el('div', 'skeleton');
      for (const w of ['55%', '100%', '80%', '65%', '40%']) {
        const line = document.createElement('i');
        line.style.width = w;
        skeleton.append(line);
      }
      body.append(skeleton);
    } else {
      const slot = document.createElement('slot');
      slot.name = node.active;
      body.append(slot);
    }
    group.append(bar, body);
    return group;
  }

  #emptyState(): HTMLElement {
    const box = el('div', 'state empty');
    const inner = document.createElement('div');
    const title = el('div', 'title');
    title.textContent = 'No panels in this window';
    const hint = document.createElement('div');
    hint.textContent = 'Drag a tab here to dock it.';
    inner.append(title, hint);
    box.append(inner);
    return box;
  }

  /** Developer-facing: a window asked for a root the workspace does not have (no workspace, no `root` attribute, or a stale id). */
  #noRootState(): HTMLElement {
    const box = el('div', 'state no-root');
    const inner = document.createElement('div');
    const title = el('div', 'title');
    title.textContent = 'This root is not in the workspace';
    const why = document.createElement('div');
    if (this.#workspace === null) why.textContent = 'No workspace is attached to this element.';
    else if (this.#root === '') why.textContent = 'This element has no root attribute.';
    else why.textContent = `The workspace has no root “${this.#root}”. Add it with an add-root operation.`;
    inner.append(title, why);
    box.append(inner);
    return box;
  }

  #errorState(reason: string): HTMLElement {
    const box = el('div', 'state error');
    const inner = document.createElement('div');
    const title = el('div', 'title');
    title.textContent = 'Couldn’t restore this layout';
    const why = document.createElement('div');
    why.textContent = reason;
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.dataset['reset'] = '';
    reset.textContent = 'Reset layout';
    inner.append(title, why, reset);
    box.append(inner);
    return box;
  }

  #focusTab(panel: PanelId): void {
    for (const tab of this.#surface.querySelectorAll<HTMLElement>('.tab')) {
      if (tab.dataset['pid'] === panel) {
        tab.focus({ preventScroll: true });
        return;
      }
    }
  }

  /* ------------------------------------------------------------------------------- tabs: click, keyboard */

  #emitIntent(op: Op): void {
    this.dispatchEvent(new CustomEvent('dock-intent', { detail: { op }, bubbles: true, composed: true }));
  }

  #onClick(e: MouseEvent): void {
    const path = e.target as HTMLElement | null;
    if (!path) return;
    if (this.#suppressClick) {
      this.#suppressClick = false;
      return;
    }
    if (path.closest('[data-reset]')) {
      this.dispatchEvent(new CustomEvent('dock-reset', { bubbles: true, composed: true }));
      return;
    }
    const close = path.closest<HTMLElement>('[data-close]');
    if (close?.dataset['close'] !== undefined) {
      const panel = close.dataset['close'];
      const group = close.closest<HTMLElement>('.tabs')?.dataset['gid'];
      this.#focusNext = group !== undefined ? { group } : null;
      this.#emitIntent({ type: 'remove-panel', panel });
      return;
    }
    const tab = path.closest<HTMLElement>('.tab');
    const panel = tab?.dataset['pid'];
    if (panel === undefined) return;
    this.#focusNext = { panel };
    if (tab?.getAttribute('aria-selected') !== 'true') this.#emitIntent({ type: 'activate', panel });
    else this.#focusTab(panel);
  }

  #onKeyDown(e: KeyboardEvent): void {
    const tab = (e.target as HTMLElement | null)?.closest<HTMLElement>('.tab');
    const group = tab?.closest<HTMLElement>('.tabs');
    const panel = tab?.dataset['pid'];
    const node = group?.dataset['gid'] !== undefined ? this.#groups.get(group.dataset['gid']) : undefined;
    if (!node || panel === undefined) return;
    const i = node.panels.indexOf(panel);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = Math.min(i + 1, node.panels.length - 1);
    else if (e.key === 'ArrowLeft') next = Math.max(i - 1, 0);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = node.panels.length - 1;
    else if (e.key === 'Delete') {
      e.preventDefault();
      this.#focusNext = { group: node.id };
      this.#emitIntent({ type: 'remove-panel', panel });
      return;
    } else return;
    e.preventDefault();
    const target = node.panels[next];
    if (target === undefined) return;
    this.#focusNext = { panel: target };
    if (target !== node.active) this.#emitIntent({ type: 'activate', panel: target });
    else this.#focusTab(target);
  }

  #onWheel(e: WheelEvent): void {
    const bar = (e.target as HTMLElement | null)?.closest<HTMLElement>('.bar');
    if (bar && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      bar.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }

  /* ----------------------------------------------------------------------------------------- pointer */

  #onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const gutter = target.closest<HTMLElement>('.gutter');
    if (gutter) return this.#startResize(e, gutter);
    const tab = target.closest<HTMLElement>('.tab');
    if (tab && !target.closest('[data-close]')) this.#beginTabDrag(e, tab);
  }

  /* --------------------------------------------------------------------------- splitter: live, commit once */

  #startResize(e: PointerEvent, gutter: HTMLElement): void {
    const splitEl = gutter.parentElement as HTMLElement;
    const node = this.#splits.get(splitEl.dataset['splitId'] ?? '');
    const index = Number(gutter.dataset['index']);
    if (!node || !Number.isInteger(index)) return;
    e.preventDefault();
    const row = node.direction === 'row';
    const total = (row ? splitEl.clientWidth : splitEl.clientHeight) || 1;
    const sum = node.sizes.reduce((a, b) => a + b, 0) || 1;
    const cells = [...splitEl.children].filter((c): c is HTMLElement => c.classList.contains('cell'));
    const before = cells[index - 1];
    const after = cells[index];
    const start = row ? e.clientX : e.clientY;
    const a0 = node.sizes[index - 1] ?? 0;
    const b0 = node.sizes[index] ?? 0;
    const minUnits = (MIN_GROUP_SIZE / total) * sum;
    let live: [number, number] | null = null;
    gutter.classList.add('dragging');
    gutter.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent): void => {
      const d = (((row ? ev.clientX : ev.clientY) - start) / total) * sum;
      let a = a0 + d;
      let b = b0 - d;
      if (a < minUnits) {
        b -= minUnits - a;
        a = minUnits;
      }
      if (b < minUnits) {
        a -= minUnits - b;
        b = minUnits;
      }
      if (before) before.style.flex = `${((a / sum) * 100).toString()} 1 0`;
      if (after) after.style.flex = `${((b / sum) * 100).toString()} 1 0`;
      live = [a, b];
    };
    const end = (): void => {
      gutter.removeEventListener('pointermove', move);
      gutter.removeEventListener('pointerup', end);
      gutter.removeEventListener('pointercancel', end);
      gutter.classList.remove('dragging');
      if (live) {
        const sizes = [...node.sizes];
        sizes[index - 1] = live[0];
        sizes[index] = live[1];
        this.#emitIntent({ type: 'resize', split: node.id, sizes });
      }
    };
    gutter.addEventListener('pointermove', move);
    gutter.addEventListener('pointerup', end);
    gutter.addEventListener('pointercancel', end);
  }

  /* ------------------------------------------------------------------------------------------ tab drag */

  #beginTabDrag(e: PointerEvent, tab: HTMLElement): void {
    const panel = tab.dataset['pid'];
    if (panel === undefined || this.#drag) return;
    const title = this.#workspace && Object.hasOwn(this.#workspace.panels, panel) ? (this.#workspace.panels[panel]?.title ?? panel) : panel;
    tab.setPointerCapture(e.pointerId);
    const drag: ActiveDrag = {
      session: { id: `drag-${++dragCounter}`, panel, fromRoot: this.#root, title },
      pointerId: e.pointerId,
      origin: { x: e.clientX, y: e.clientY },
      tab,
      started: false,
      last: { x: e.clientX, y: e.clientY },
      over: null,
      onMove: (ev) => this.#dragMove(ev),
      onUp: (ev) => this.#dragUp(ev),
      onCancel: () => this.#finishDrag(this.#drag?.last ?? { x: 0, y: 0 }, true),
      onKey: (ev) => {
        if (ev.key === 'Escape') this.#finishDrag(this.#drag?.last ?? { x: 0, y: 0 }, true);
      },
      onSelect: (ev) => ev.preventDefault(),
    };
    this.#drag = drag;
    tab.addEventListener('pointermove', drag.onMove);
    tab.addEventListener('pointerup', drag.onUp);
    tab.addEventListener('pointercancel', drag.onCancel);
    document.addEventListener('keydown', drag.onKey, true);
    document.addEventListener('selectstart', drag.onSelect, true);
  }

  #candidateAt(point: Point): DockRoot | null {
    const scope = this.getRootNode() as Document | ShadowRoot;
    for (const found of scope.elementsFromPoint(point.x, point.y)) if (found instanceof DockRoot) return found;
    return null;
  }

  #announce(phase: DockDragDetail['phase'], drag: ActiveDrag, point: Point, candidate: DockRoot | null, cancelled: boolean): boolean {
    const detail: DockDragDetail = {
      phase,
      session: drag.session,
      client: point,
      target: candidate ? { root: candidate.root } : null,
      cancelled,
    };
    return this.dispatchEvent(new CustomEvent<DockDragDetail>('dock-drag', { detail, bubbles: true, composed: true, cancelable: true }));
  }

  #dragMove(e: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const point = { x: e.clientX, y: e.clientY };
    drag.last = point;
    if (!drag.started) {
      if (Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) < DRAG_THRESHOLD) return;
      drag.started = true;
      drag.tab.classList.add('ghosted');
      this.#ghost.textContent = drag.session.title;
      this.#ghost.style.display = 'block';
      this.#announce('start', drag, point, this.#candidateAt(point), false);
    }
    this.#ghost.style.left = `${point.x + 12}px`;
    this.#ghost.style.top = `${point.y + 10}px`;
    const candidate = this.#candidateAt(point);
    if (this.#announce('move', drag, point, candidate, false)) {
      if (drag.over && drag.over !== candidate) drag.over.dragLeave();
      candidate?.dragOver(point, drag.session);
      drag.over = candidate;
    }
  }

  #dragUp(e: PointerEvent): void {
    const drag = this.#drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    this.#finishDrag({ x: e.clientX, y: e.clientY }, false);
  }

  #finishDrag(point: Point, cancelled: boolean): void {
    const drag = this.#drag;
    if (!drag) return;
    this.#drag = null;
    drag.tab.removeEventListener('pointermove', drag.onMove);
    drag.tab.removeEventListener('pointerup', drag.onUp);
    drag.tab.removeEventListener('pointercancel', drag.onCancel);
    document.removeEventListener('keydown', drag.onKey, true);
    document.removeEventListener('selectstart', drag.onSelect, true);
    if (drag.tab.hasPointerCapture(drag.pointerId)) drag.tab.releasePointerCapture(drag.pointerId);
    drag.tab.classList.remove('ghosted');
    this.#ghost.style.display = 'none';
    if (!drag.started) return;
    // the release that ends a drag must not also count as a click on a tab; after a cancel it has not happened yet
    this.#suppressClick = true;
    const clear = (): void => {
      setTimeout(() => {
        this.#suppressClick = false;
      }, 0);
    };
    if (cancelled) window.addEventListener('pointerup', clear, { once: true, capture: true });
    else clear();
    const candidate = cancelled ? null : this.#candidateAt(point);
    const proceed = this.#announce('end', drag, point, candidate, cancelled);
    if (proceed) {
      drag.over?.dragLeave();
      if (!cancelled && candidate) candidate.drop(point, drag.session);
    }
    drag.over = null;
  }

  /* ----------------------------------------------------------------------------------- drop resolution */

  #resolve(point: Point, session: DragSession): DropTarget | null {
    if (this.#error !== null || !this.#workspace || !Object.hasOwn(this.#workspace.roots, this.#root)) return null;
    const record = this.#workspace.roots[this.#root];
    if (!record) return null;
    if (record.node === null) {
      const rect = toRect(this.#surface.getBoundingClientRect());
      const inside = point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
      return inside ? { hit: null, region: rect, label: 'dock here' } : null;
    }
    const groups: GroupGeometry[] = [];
    for (const g of this.#surface.querySelectorAll<HTMLElement>('.tabs')) {
      const gid = g.dataset['gid'];
      const bar = g.querySelector<HTMLElement>('.bar');
      if (gid !== undefined && bar) groups.push({ group: gid, rect: toRect(g.getBoundingClientRect()), barHeight: bar.getBoundingClientRect().height });
    }
    const hit = hitTest(groups, point);
    if (!hit) return null;
    const node = this.#groups.get(hit.group);
    const edge = hit.zone !== 'center' && hit.zone !== 'tabbar';
    // splitting a group off itself when the dragged panel is its only tab changes nothing
    if (edge && node && node.panels.length === 1 && node.panels[0] === session.panel) return null;

    if (hit.zone === 'tabbar') {
      const gEl = [...this.#surface.querySelectorAll<HTMLElement>('.tabs')].find((g) => g.dataset['gid'] === hit.group);
      const rects = gEl ? [...gEl.querySelectorAll<HTMLElement>('.tab')].map((t) => toRect(t.getBoundingClientRect())) : [];
      const at = tabInsertIndex(rects, point.x);
      const barRect = hit.region;
      return {
        hit,
        tabIndex: at.index,
        region: barRect,
        label: '',
        insertAt: { x: at.lineX ?? barRect.x, top: barRect.y + 4, height: Math.max(0, barRect.height - 8) },
      };
    }
    return { hit, region: hit.region, label: hit.zone === 'center' ? 'add to group' : `split ${hit.zone}` };
  }

  #showTarget(target: DropTarget | null): void {
    if (!target) {
      this.#overlay.style.display = 'none';
      this.#insert.style.display = 'none';
      return;
    }
    if (target.insertAt) {
      this.#overlay.style.display = 'none';
      const s = this.#insert.style;
      s.display = 'block';
      s.left = `${target.insertAt.x}px`;
      s.top = `${target.insertAt.top}px`;
      s.height = `${target.insertAt.height}px`;
      return;
    }
    this.#insert.style.display = 'none';
    const s = this.#overlay.style;
    s.display = 'block';
    s.left = `${target.region.x}px`;
    s.top = `${target.region.y}px`;
    s.width = `${target.region.width}px`;
    s.height = `${target.region.height}px`;
    this.#overlayLabel.textContent = target.label;
  }
}

/** Keeps the active tab inside the visible part of a scrolled tab bar (measured, so fractional layouts are exact). */
function revealActive(bar: HTMLElement): void {
  const active = bar.querySelector<HTMLElement>('.tab[aria-selected="true"]');
  if (!active) return;
  const view = bar.getBoundingClientRect();
  const tab = active.getBoundingClientRect();
  if (tab.left < view.left) bar.scrollLeft -= view.left - tab.left;
  else if (tab.right > view.right) bar.scrollLeft += tab.right - view.right;
}

function el(tag: string, className = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** Registers the element once. The default tag is `dock-root`. */
export function defineDockRoot(tag = 'dock-root'): typeof DockRoot {
  if (!customElements.get(tag)) customElements.define(tag, DockRoot);
  return DockRoot;
}

declare global {
  interface HTMLElementTagNameMap {
    'dock-root': DockRoot;
  }
}
