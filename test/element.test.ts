import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { Split, Workspace } from '../src/index.ts';
import { layout } from './helpers.ts';
import { Browser, buildInto, findBrowser, sleep, type Page, type Point } from './support/browser.ts';

/**
 * The renderer against the prototype's conformance checklist (S1.x, S2.x, S3.x), driven the way a person drives it:
 * real pointer and keyboard input in a real browser, results read from the model and the rendered tree.
 */
const SKIP = findBrowser() ? false : 'no browser found (set DOCK_BROWSER to a Chrome or Edge executable)';

interface R {
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

let work = '';
let browser: Browser;

before(async () => {
  if (SKIP) return;
  work = mkdtempSync(join(tmpdir(), 'dock-core-element-'));
  const dist = join(work, 'dist');
  buildInto(dist);
  browser = await Browser.launch(dist);
});

after(async () => {
  if (SKIP) return;
  await browser.close();
  rmSync(work, { recursive: true, force: true });
});

class Dock {
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }
  call<T>(expr: string): Promise<T> {
    return this.page.eval<T>(`dock.${expr}`);
  }
  ws(): Promise<Workspace> {
    return this.call<Workspace>('state()');
  }
  async layout(root: string): Promise<string> {
    return layout(await this.ws(), root);
  }
  tab(root: 'a' | 'b', panel: string): Promise<R> {
    return this.call<R>(`tab('${root}','${panel}')`);
  }
  group(root: 'a' | 'b', gid: string): Promise<R> {
    return this.call<R>(`group('${root}','${gid}')`);
  }
  async settle(): Promise<void> {
    await sleep(30);
  }
}

/** Opens the test page in a scenario, runs `fn`, and fails the test if the page threw. */
async function withPage(scenario: string, fn: (d: Dock) => Promise<void>): Promise<void> {
  const page = await browser.newPage();
  try {
    await page.goto(`${browser.origin}/page/dock.html?scenario=${scenario}`);
    await fn(new Dock(page));
    assert.deepEqual(page.errors, [], 'the page must not report errors');
  } finally {
    await page.close();
  }
}

const pt = (r: R, dx = 0, dy = 0): Point => ({ x: r.cx + dx, y: r.cy + dy });
const near = (actual: number, expected: number, tolerance: number, what: string): void => assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`);

const rootSplit = (ws: Workspace, root: string): Split => ws.roots[root]!.node as unknown as Split;

const NORMAL = 'row([ex*] | column([ed1*,ed2] | [tm*]) | [in*])';

/* ------------------------------------------------------------------------------------ S1. split and tabs */

test('S1.1 + S1.10: nested splits with 1px splitters, tab groups, roles', { skip: SKIP }, () =>
  withPage('normal', async (d) => {
    assert.equal(await d.layout('A'), NORMAL);
    assert.equal(await d.call('count("a",".tabs")'), 4);
    assert.equal(await d.call('count("a",".gutter")'), 3);
    near((await d.call<R>('gutter("a",0)')).width, 1, 0.01, 'splitter width');
    const roles = await d.call<string[]>('roles("a")');
    assert.ok(roles.includes('tablist:null'));
    assert.ok(roles.includes('tab:true') && roles.includes('tab:false'));
    assert.deepEqual(await d.call('tabStops("a")'), [1, 1, 1, 1], 'exactly one tab stop per tab bar');
    // the selected tab and the panel it shows point at each other, so a screen reader announces the panel as that tab's
    const pattern = await d.call<Array<{ role: string; controls: boolean; labelledby: boolean; othersDoNotControl: boolean; closeRole: string | null }>>('tabPattern("a")');
    assert.equal(pattern.length, 4);
    for (const group of pattern) assert.deepEqual(group, { role: 'tabpanel', controls: true, labelledby: true, othersDoNotControl: true, closeRole: 'button' });
  }));

test('S1.2 + S1.3: splitter resizes live, commits once on release, keeps the minimum size', { skip: SKIP }, () =>
  withPage('normal', async (d) => {
    const before = rootSplit(await d.ws(), 'A');
    const g = await d.call<R>('gutter("a",0)');
    // away from the middle, where the splitter of the column inside the next cell crosses it
    const from = { x: g.cx, y: g.y + 100 };
    const flex0 = await d.call<string>('cellFlex("a",0)');
    await d.page.dragTo(from, [{ x: from.x + 20, y: from.y }, { x: from.x + 60, y: from.y }, { x: from.x + 100, y: from.y }]);
    assert.notEqual(await d.call<string>('cellFlex("a",0)'), flex0, 'the layout follows the pointer while dragging');
    assert.deepEqual(rootSplit(await d.ws(), 'A').sizes, before.sizes, 'nothing is committed before release');
    await d.page.up({ x: from.x + 100, y: from.y });
    await d.settle();
    const after = rootSplit(await d.ws(), 'A').sizes;
    assert.ok(after[0]! > before.sizes[0]!, 'the first column grew');
    near(after.reduce((s, v) => s + v, 0), 1, 1e-9, 'sizes still sum to one');
    assert.equal(await d.call('log.intents.filter((t) => t === "resize").length'), 1, 'one operation for the whole drag');

    const g2 = await d.call<R>('gutter("a",0)');
    await d.page.drag({ x: g2.cx, y: g2.y + 100 }, { x: -400, y: g2.y + 100 }, 4);
    await d.settle();
    near((await d.group('a', 'gEx')).width, 90, 3, 'minimum group size');
  }));

test('S1.4: closing the last tab removes the group and collapses the split', { skip: SKIP }, () =>
  withPage('normal', async (d) => {
    await d.page.click(pt(await d.call<R>('closeBtn("a","tm")')));
    await d.settle();
    assert.equal(await d.layout('A'), 'row([ex*] | [ed1*,ed2] | [in*])');
  }));

test('S1.5: an empty window shows the empty state', { skip: SKIP }, () =>
  withPage('empty', async (d) => {
    const text = await d.call<string>('text("b")');
    assert.match(text, /No panels in this window/);
    assert.match(text, /Drag a tab here to dock it\./);
  }));

test('S1.6: a loading panel shows a skeleton while tabs stay interactive', { skip: SKIP }, () =>
  withPage('normal', async (d) => {
    await d.call('loading("a","ed1",true)');
    assert.equal(await d.call('skeleton("a")'), 1);
    await d.page.click(pt(await d.tab('a', 'ed2')));
    await d.settle();
    assert.equal(await d.layout('A'), 'row([ex*] | column([ed1,ed2*] | [tm*]) | [in*])');
    assert.equal(await d.call('skeleton("a")'), 0, 'the skeleton belongs to the loading panel, not the group');
    await d.page.click(pt(await d.tab('a', 'ed1')));
    assert.equal(await d.call('skeleton("a")'), 1);
    await d.call('loading("a","ed1",false)');
    assert.equal(await d.call('skeleton("a")'), 0);
  }));

test('S1.7: a layout that cannot be restored shows the reason and a working reset', { skip: SKIP }, () =>
  withPage('error', async (d) => {
    const text = await d.call<string>('text("b")');
    assert.match(text, /schema version 3 is newer than the supported version 1/);
    assert.match(text, /Reset layout/);
    await d.page.click(pt(await d.call<R>('rect("b","button")')));
    await d.settle();
    assert.equal(await d.call('log.reset'), 1);
    assert.equal(await d.layout('B'), '[ch*]');
    assert.doesNotMatch(await d.call<string>('text("b")'), /restore/);
  }));

test('S1.11: a root that is not in the workspace says so and names the root', { skip: SKIP }, () =>
  withPage('noroot', async (d) => {
    assert.equal(await d.call('rootState("b")'), 'no-root');
    const text = await d.call<string>('text("b")');
    assert.match(text, /not in the workspace/);
    assert.match(text, /“ghost”/, 'the message names the root that was asked for');
    assert.doesNotMatch(text, /No panels in this window/, 'it is not the empty state: nothing can be dropped here');
    // a drag over it finds no target (nothing to dock into)
    const from = pt(await d.tab('a', 'ed2'));
    const b = await d.call<R>('rect("b",".root")');
    await d.page.dragTo(from, [{ x: from.x + 10, y: from.y + 10 }, { x: b.cx, y: b.cy }]);
    assert.deepEqual(await d.call('overlay("b")'), { overlay: null, insert: null });
    await d.page.up({ x: b.cx, y: b.cy });
  }));

test('S1.8 + S2.7: 40 tabs scroll horizontally, the active tab is in view, reordering works while scrolled', { skip: SKIP }, () =>
  withPage('many', async (d) => {
    const s0 = await d.call<{ left: number; max: number; width: number }>('barScroll("a","gFiles")');
    assert.ok(s0.max > 0, 'the tab bar overflows');
    const bar = await d.call<R>('bar("a","gFiles")');
    const active = await d.tab('a', 'f18');
    assert.ok(active.x >= bar.x - 1 && active.x + active.width <= bar.x + bar.width + 1, 'the active tab is scrolled into view');

    await d.page.wheel(pt(bar), 300);
    await d.settle();
    const s1 = await d.call<{ left: number }>('barScroll("a","gFiles")');
    assert.ok(s1.left > s0.left, 'the wheel scrolls the tab bar sideways');

    // two tabs that are visible in the scrolled bar
    const tabs = Object.keys((await d.ws()).panels);
    const visible: { id: string; r: R }[] = [];
    for (const id of tabs.filter((t) => t.startsWith('f'))) {
      const r = await d.tab('a', id);
      if (r.x >= bar.x + 5 && r.x + r.width <= bar.x + bar.width - 5) visible.push({ id, r });
    }
    assert.ok(visible.length >= 3, 'several tabs are visible after scrolling');
    const mover = visible[visible.length - 1]!;
    const anchor = visible[0]!;
    await d.page.drag(pt(mover.r), { x: anchor.r.x + 3, y: anchor.r.cy });
    await d.settle();
    const order = (rootSplit(await d.ws(), 'A').children[1] as unknown as { panels: string[] }).panels;
    assert.equal(order.indexOf(mover.id) + 1, order.indexOf(anchor.id), 'the tab landed right before the one it was dropped on');
    assert.equal(order.length, 40);
  }));

test('S1.9: roving tabindex and keyboard navigation', { skip: SKIP }, () =>
  withPage('normal', async (d) => {
    await d.page.click(pt(await d.tab('a', 'ed1')));
    assert.equal(await d.call('focused("a")'), 'ed1');
    await d.page.press('ArrowRight');
    await d.settle();
    assert.equal(await d.layout('A'), 'row([ex*] | column([ed1,ed2*] | [tm*]) | [in*])');
    assert.equal(await d.call('focused("a")'), 'ed2', 'focus follows the selection');
    await d.page.press('ArrowRight');
    assert.equal(await d.call('focused("a")'), 'ed2', 'the last tab stays put');
    await d.page.press('Home');
    await d.settle();
    assert.equal(await d.call('focused("a")'), 'ed1');
    await d.page.press('End');
    await d.settle();
    assert.equal(await d.call('focused("a")'), 'ed2');
    assert.deepEqual(await d.call('tabStops("a")'), [1, 1, 1, 1]);
    await d.page.press('Delete');
    await d.settle();
    assert.equal(await d.layout('A'), 'row([ex*] | column([ed1*] | [tm*]) | [in*])');
    assert.equal(await d.call('focused("a")'), 'ed1', 'focus lands on the tab that became active');
  }));

/* ------------------------------------------------------------------------------- S2. dragging a tab */

test('S2.1: drag starts after 5px, a ghost follows, the source tab dims, Escape cancels', { skip: SKIP }, () =>
  withPage('normal', async (d) => {
    const t = pt(await d.tab('a', 'ed2'));
    await d.page.dragTo(t, [{ x: t.x + 3, y: t.y }]);
    assert.equal(await d.call('ghost("a")'), null, 'a 3px movement is not a drag');
    await d.page.move({ x: t.x + 12, y: t.y + 6 });
    assert.equal(await d.call('ghost("a")'), 'node.rs');
    assert.deepEqual(await d.call('ghosted("a")'), ['ed2']);
    await d.page.press('Escape');
    await d.settle();
    assert.equal(await d.call('ghost("a")'), null);
    assert.deepEqual(await d.call('ghosted("a")'), []);
    assert.equal(await d.layout('A'), NORMAL);
    const end = await d.call<{ phase: string; cancelled: boolean }[]>('log.drag.filter((e) => e.phase === "end")');
    assert.deepEqual(end.map((e) => e.cancelled), [true]);
    await d.page.up(t);
    assert.equal(await d.layout('A'), NORMAL, 'releasing after the cancel does nothing');
  }));

test('S2.9: no text is selected while a tab is dragged across the page, and selecting works again afterwards', { skip: SKIP }, () =>
  withPage('text', async (d) => {
    assert.equal(await d.call('canSelect()'), true, 'selection is allowed before a drag');
    const from = pt(await d.tab('a', 'ed2'));
    const g = await d.group('a', 'gEd');
    await d.page.dragTo(from, [{ x: from.x, y: g.y + 120 }, { x: g.x + 40, y: g.y + 160 }, { x: g.x + g.width - 40, y: g.y + 260 }, { x: g.x + g.width - 40, y: g.y + 330 }]);
    assert.ok(await d.call('ghost("a")'), 'the drag is running');
    assert.deepEqual(await d.call('selected()'), { page: '', area: 0 }, 'nothing is selected while the drag runs');
    assert.equal(await d.call('canSelect()'), false, 'the page cancels the start of any selection during the drag');
    await d.page.up({ x: g.x + g.width - 40, y: g.y + 330 });
    await d.settle();
    assert.deepEqual(await d.call('selected()'), { page: '', area: 0 }, 'nor after it');
    assert.equal(await d.call('canSelect()'), true, 'selection is allowed again once the drag ended');

    // a drag that is cancelled lifts the block too
    const t2 = pt(await d.tab('a', 'ed2'));
    await d.page.dragTo(t2, [{ x: t2.x + 12, y: t2.y + 6 }]);
    assert.equal(await d.call('canSelect()'), false);
    await d.page.press('Escape');
    await d.page.up(t2);
    assert.equal(await d.call('canSelect()'), true);
  }));

test('S2.2 + S2.3: the nearest edge within 26% splits that side; the overlay shows the exact region', { skip: SKIP }, () =>
  withPage('normal', async (d) => {
    const from = pt(await d.tab('a', 'ed2'));
    const g = await d.group('a', 'gIn');
    await d.page.dragTo(from, [{ x: from.x + 10, y: from.y + 10 }, { x: g.x + g.width - 8, y: g.cy + 20 }]);
    const edge = (await d.call<{ overlay: R & { label: string } | null }>('overlay("a")')).overlay!;
    assert.equal(edge.label, 'split right');
    near(edge.width, g.width / 2, 2, 'half the group width');
    near(edge.x, g.x + g.width / 2, 2, 'right half');

    await d.page.move({ x: g.cx, y: g.cy + 20 });
    const center = (await d.call<{ overlay: R & { label: string } | null }>('overlay("a")')).overlay!;
    assert.equal(center.label, 'add to group');
    near(center.width, g.width, 2, 'the whole group');

    await d.page.move({ x: g.x + g.width - 8, y: g.cy + 20 });
    await d.page.up({ x: g.x + g.width - 8, y: g.cy + 20 });
    await d.settle();
    assert.equal(await d.layout('A'), 'row([ex*] | column([ed1*] | [tm*]) | [in*] | [ed2*])', 'dropping on the right edge docks the tab beside the group');
    assert.deepEqual(await d.call('overlay("a")'), { overlay: null, insert: null }, 'the overlay is gone after the drop');
  }));

test('S2.4: over a tab bar an insertion line shows the index and the drop reorders', { skip: SKIP }, () =>
  withPage('normal', async (d) => {
    const ed1 = await d.tab('a', 'ed1');
    const from = pt(await d.tab('a', 'ed2'));
    const to = { x: ed1.x + 3, y: ed1.cy };
    await d.page.dragTo(from, [{ x: from.x - 10, y: from.y }, to]);
    const o = await d.call<{ overlay: unknown; insert: R | null }>('overlay("a")');
    assert.equal(o.overlay, null);
    near(o.insert!.x, ed1.x, 2, 'the line sits at the left edge of the target tab');
    await d.page.up(to);
    await d.settle();
    assert.equal(await d.layout('A'), 'row([ex*] | column([ed2*,ed1] | [tm*]) | [in*])');
  }));

test('S2.5: splitting a group off itself when it holds only the dragged tab does nothing', { skip: SKIP }, () =>
  withPage('normal', async (d) => {
    const from = pt(await d.tab('a', 'tm'));
    const g = await d.group('a', 'gTm');
    const edge = { x: g.x + g.width - 8, y: g.cy + 20 };
    await d.page.dragTo(from, [{ x: from.x + 10, y: from.y + 10 }, edge]);
    assert.equal((await d.call<{ overlay: unknown }>('overlay("a")')).overlay, null, 'no overlay for an invalid target');
    await d.page.up(edge);
    await d.settle();
    assert.equal(await d.layout('A'), NORMAL);
  }));

test('S2.6: releasing where nothing takes the drop changes nothing', { skip: SKIP }, () =>
  withPage('normal', async (d) => {
    await d.call('setHost("takeover")');
    await d.page.drag(pt(await d.tab('a', 'ed2')), { x: 1300, y: 700 });
    await d.settle();
    assert.equal(await d.layout('A'), NORMAL);
    assert.equal(await d.layout('B'), '[ch*]');
  }));

test('S2.8: dropping a tab on the body of its own group only activates it', { skip: SKIP }, () =>
  withPage('normal', async (d) => {
    const g = await d.group('a', 'gEd');
    await d.page.drag(pt(await d.tab('a', 'ed2')), { x: g.cx, y: g.cy });
    await d.settle();
    assert.equal(await d.layout('A'), 'row([ex*] | column([ed1,ed2*] | [tm*]) | [in*])');
  }));

/* ---------------------------------------------------------------------------------- S3. between roots */

test('S3.1: dropping onto a group in another root moves the panel and collapses the source group', { skip: SKIP }, () =>
  withPage('normal', async (d) => {
    const g = await d.group('b', 'gCh');
    await d.page.drag(pt(await d.tab('a', 'tm')), { x: g.cx, y: g.cy + 30 });
    await d.settle();
    assert.equal(await d.layout('B'), '[ch,tm*]');
    assert.equal(await d.layout('A'), 'row([ex*] | [ed1*,ed2] | [in*])');
  }));

test('S3.2 + S3.4: an empty root takes a drop ("dock here"); a root that loses its last panel stays and shows the empty state', { skip: SKIP }, () =>
  withPage('empty', async (d) => {
    const b = await d.call<R>('rect("b",".root")');
    const from = pt(await d.tab('a', 'ex'));
    await d.page.dragTo(from, [{ x: from.x + 10, y: from.y + 10 }, { x: b.cx, y: b.cy }]);
    const hover = (await d.call<{ overlay: { label: string } | null }>('overlay("b")')).overlay!;
    assert.equal(hover.label, 'dock here');
    await d.page.up({ x: b.cx, y: b.cy });
    await d.settle();
    assert.equal(await d.layout('B'), '[ex*]');

    // and back out: the source root is left empty but stays open
    const tab = pt(await d.tab('b', 'ex'));
    const a = await d.group('a', 'gEd');
    await d.page.drag(tab, { x: a.cx, y: a.cy });
    await d.settle();
    assert.equal((await d.ws()).roots['B']!.node, null);
    assert.match(await d.call<string>('text("b")'), /No panels in this window/);
  }));

test('S3.3: released over nothing, the host is told so and tears the panel off into a new root', { skip: SKIP }, () =>
  withPage('normal', async (d) => {
    await d.page.drag(pt(await d.tab('a', 'ed2')), { x: 1300, y: 700 });
    await d.settle();
    const ws = await d.ws();
    const roots = Object.keys(ws.roots).sort();
    assert.equal(roots.length, 3);
    const torn = roots.find((r) => r !== 'A' && r !== 'B')!;
    assert.equal(layout(ws, torn), '[ed2*]');
    const ends = await d.call<{ phase: string; target: string | null; cancelled: boolean }[]>('log.drag.filter((e) => e.phase === "end")');
    assert.deepEqual(ends, [{ phase: 'end', target: null, cancelled: false }]);
  }));

/* ------------------------------------------------------------------------------- host takes control */

test('a host that prevents the default takes over every decision', { skip: SKIP }, () =>
  withPage('normal', async (d) => {
    await d.call('setHost("takeover")');
    const g = await d.group('a', 'gIn');
    const from = pt(await d.tab('a', 'ed2'));
    await d.page.dragTo(from, [{ x: from.x + 10, y: from.y + 10 }, { x: g.cx, y: g.cy + 20 }]);
    assert.equal((await d.call<{ overlay: unknown }>('overlay("a")')).overlay, null, 'no overlay unless the host asks for one');
    await d.page.up({ x: g.cx, y: g.cy + 20 });
    await d.settle();
    assert.equal(await d.layout('A'), NORMAL, 'no drop unless the host asks for one');
    const moves = await d.call<{ phase: string; target: string | null }[]>('log.drag.filter((e) => e.phase === "move")');
    assert.ok(moves.length > 0 && moves.every((m) => m.target === 'A'), 'the host is told which root is under the pointer');
  }));

test('a workspace that changes under a drag cancels it', { skip: SKIP }, () =>
  withPage('normal', async (d) => {
    const from = pt(await d.tab('a', 'ed2'));
    await d.page.dragTo(from, [{ x: from.x + 12, y: from.y + 6 }]);
    assert.equal(await d.call('ghost("a")'), 'node.rs');
    await d.call('setWorkspaceMidDrag()');
    assert.equal(await d.call('ghost("a")'), null);
    const ends = await d.call<{ cancelled: boolean }[]>('log.drag.filter((e) => e.phase === "end")');
    assert.deepEqual(ends.map((e) => e.cancelled), [true]);
    await d.page.up(from);
    assert.equal(await d.layout('A'), NORMAL);
  }));

/* ---------------------------------------------------------------------------------- documented example */

test('the two-roots example of docs/HOSTS.md renders and moves a panel between its roots with real input', { skip: SKIP }, async () => {
  const page = await browser.newPage();
  try {
    // the example page is the documentation's, so it carries no test hook: ready means both roots drew their tabs
    await page.goto(`${browser.origin}/docs/examples/two-roots.html`, `[...document.querySelectorAll('dock-root')].length === 2 && [...document.querySelectorAll('dock-root')].every((e) => e.shadowRoot && e.shadowRoot.querySelector('.tab'))`);
    const tabs = (root: string): Promise<string[]> =>
      page.eval<string[]>(`[...document.querySelector('dock-root[root="${root}"]').shadowRoot.querySelectorAll('.tab')].map((t) => t.dataset.pid)`);
    const rect = (root: string, selector: string, pid?: string): Promise<R> =>
      page.eval<R>(`(() => { const nodes = [...document.querySelector('dock-root[root="${root}"]').shadowRoot.querySelectorAll('${selector}')];
        const n = ${pid ? `nodes.find((t) => t.dataset.pid === '${pid}')` : 'nodes[0]'}; const r = n.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
    assert.deepEqual(await tabs('left'), ['files', 'notes']);
    assert.deepEqual(await tabs('right'), ['log']);
    const from = pt(await rect('left', '.tab', 'notes'));
    const target = await rect('right', '.tabs');
    await page.drag(from, { x: target.cx, y: target.cy + 30 });
    await sleep(60);
    assert.deepEqual(await tabs('left'), ['files']);
    assert.deepEqual((await tabs('right')).sort(), ['log', 'notes']);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

/* ---------------------------------------------------------------------------------- A1. what assistive technology receives */

interface AxNode {
  role: string;
  name: string;
  selected: boolean | null;
  focusable: boolean;
}

/** The accessibility tree as the browser computes it (shadow roots included), reduced to the roles a user of assistive technology meets, in reading order. */
async function axTree(page: Page): Promise<AxNode[]> {
  await page.send('Accessibility.enable');
  const { nodes } = await page.send<{ nodes: Array<{ nodeId: string; ignored?: boolean; role?: { value: string }; name?: { value: string }; properties?: Array<{ name: string; value: { value?: unknown } }>; childIds?: string[] }> }>('Accessibility.getFullAXTree');
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const out: AxNode[] = [];
  const walk = (id: string): void => {
    const n = byId.get(id);
    if (!n) return;
    const role = n.role?.value ?? '';
    if (!n.ignored && ['tablist', 'tab', 'tabpanel', 'button'].includes(role)) {
      const prop = (name: string): unknown => n.properties?.find((p) => p.name === name)?.value.value;
      out.push({ role, name: n.name?.value ?? '', selected: typeof prop('selected') === 'boolean' ? (prop('selected') as boolean) : null, focusable: prop('focusable') === true });
    }
    for (const child of n.childIds ?? []) walk(child);
  };
  if (nodes[0]) walk(nodes[0].nodeId);
  return out;
}

/** What has keyboard focus, looking through shadow roots: a tab's panel id, or the tag name of anything else. */
const focusedDeep = (page: Page): Promise<string> =>
  page.eval<string>(`(() => { let e = document.activeElement; while (e && e.shadowRoot && e.shadowRoot.activeElement) e = e.shadowRoot.activeElement; return e ? (e.dataset && e.dataset.pid) || e.tagName.toLowerCase() : 'none'; })()`);

test('A1: the accessibility tree names every tab, panel and close button, and says which tab is selected', { skip: SKIP }, () =>
  withPage('normal', async (d) => {
    const tree = await axTree(d.page);
    const of = (role: string): AxNode[] => tree.filter((n) => n.role === role);
    assert.equal(of('tablist').length, 5, 'one tab list per group');
    assert.deepEqual(of('tab').map((t) => t.name), ['Explorer', 'workspace.rs', 'node.rs', 'Terminal', 'Inspector', 'Throughput'], 'a tab is named by its title alone, not by the close control inside it');
    assert.deepEqual(of('tab').map((t) => t.selected), [true, true, false, true, true, true]);
    assert.deepEqual(of('tabpanel').map((t) => t.name), ['Explorer', 'workspace.rs', 'Terminal', 'Inspector', 'Throughput'], 'the panel is named after the selected tab');
    assert.deepEqual(of('button').map((b) => b.name), ['Close Explorer', 'Close workspace.rs', 'Close node.rs', 'Close Terminal', 'Close Inspector', 'Close Throughput']);
  }));

test('A1: selecting another tab moves the selected state and the panel name in the accessibility tree', { skip: SKIP }, () =>
  withPage('normal', async (d) => {
    await d.page.click(pt(await d.tab('a', 'ed1')));
    await d.page.press('ArrowRight');
    await d.settle();
    const tree = await axTree(d.page);
    const tabs = tree.filter((n) => n.role === 'tab');
    assert.deepEqual(tabs.filter((t) => t.selected).map((t) => t.name), ['Explorer', 'node.rs', 'Terminal', 'Inspector', 'Throughput']);
    assert.ok(tree.some((n) => n.role === 'tabpanel' && n.name === 'node.rs'), 'the panel shows and is named after node.rs');
    assert.ok(!tree.some((n) => n.role === 'tabpanel' && n.name === 'workspace.rs'));
  }));

test('A1: the whole layout works from the keyboard — one tab stop per group in reading order, no trap, arrows and Delete inside a group', { skip: SKIP }, () =>
  withPage('normal', async (d) => {
    const stops: string[] = [];
    for (let i = 0; i < 5; i++) {
      await d.page.press('Tab');
      stops.push(await focusedDeep(d.page));
    }
    assert.deepEqual(stops, ['ex', 'ed1', 'tm', 'in', 'ch'], 'one stop per group, in reading order, across both roots');
    await d.page.press('Tab');
    assert.ok(!['ex', 'ed1', 'tm', 'in', 'ch'].includes(await focusedDeep(d.page)), 'Tab leaves the layout (no keyboard trap)');

    const back: string[] = [];
    for (let i = 0; i < 5; i++) {
      await d.page.press('Tab', { shift: true });
      back.push(await focusedDeep(d.page));
    }
    assert.deepEqual(back, ['ch', 'in', 'tm', 'ed1', 'ex'], 'Shift+Tab walks the same stops backwards');

    // inside one group: arrows select and focus, the stop moves with the selection, Delete removes the focused tab's panel
    await d.page.press('Tab'); // from the first stop (ex) to the second
    assert.equal(await focusedDeep(d.page), 'ed1');
    await d.page.press('ArrowRight');
    await d.settle();
    assert.equal(await focusedDeep(d.page), 'ed2');
    await d.page.press('Tab', { shift: true });
    await d.page.press('Tab');
    assert.equal(await focusedDeep(d.page), 'ed2', 'the group keeps exactly one stop and it is the selected tab');
    await d.page.press('Delete');
    await d.settle();
    assert.equal(await d.layout('A'), 'row([ex*] | column([ed1*] | [tm*]) | [in*])');
    assert.equal(await focusedDeep(d.page), 'ed1', 'focus is not lost when the focused tab is removed');
  }));
