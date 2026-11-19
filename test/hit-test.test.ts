import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hitTest, hitTestGroup, placementFor, tabInsertIndex, type GroupGeometry } from '../src/index.ts';

// a group at (100,50), 400x300, with a 34px tab bar; body spans y 84..350
const g: GroupGeometry = { group: 'g', rect: { x: 100, y: 50, width: 400, height: 300 }, barHeight: 34 };
const at = (x: number, y: number) => hitTestGroup(g, { x, y });

test('outside the group there is no hit; the right and bottom edges are exclusive', () => {
  assert.equal(at(99, 100), null);
  assert.equal(at(500, 100), null);
  assert.equal(at(300, 350), null);
  assert.ok(at(100, 50));
  assert.ok(at(499, 349));
});

test('over the tab bar the zone is tabbar and the region is the bar', () => {
  const h = at(300, 60)!;
  assert.equal(h.zone, 'tabbar');
  assert.deepEqual(h.region, { x: 100, y: 50, width: 400, height: 34 });
  assert.equal(at(300, 83)!.zone, 'tabbar');
  assert.notEqual(at(300, 84)!.zone, 'tabbar');
});

test('the middle of the body is center and highlights the whole group', () => {
  const h = at(300, 217)!;
  assert.equal(h.zone, 'center');
  assert.deepEqual(h.region, g.rect);
});

test('near an edge the zone is that side and the region is the half it would take', () => {
  assert.deepEqual(at(110, 217), { group: 'g', zone: 'left', region: { x: 100, y: 84, width: 200, height: 266 } });
  assert.deepEqual(at(490, 217), { group: 'g', zone: 'right', region: { x: 300, y: 84, width: 200, height: 266 } });
  assert.deepEqual(at(300, 90), { group: 'g', zone: 'top', region: { x: 100, y: 84, width: 400, height: 133 } });
  assert.deepEqual(at(300, 345), { group: 'g', zone: 'bottom', region: { x: 100, y: 217, width: 400, height: 133 } });
});

test('the edge fraction decides how deep an edge zone reaches', () => {
  // 26% of the 400px body width is 104px: x=190 is 90px in (22%), x=210 is 110px in (27.5%)
  assert.equal(at(190, 217)!.zone, 'left');
  assert.equal(at(210, 217)!.zone, 'center');
  assert.equal(hitTestGroup(g, { x: 210, y: 217 }, 0.3)!.zone, 'left');
  assert.equal(hitTestGroup(g, { x: 190, y: 217 }, 0.1)!.zone, 'center');
});

test('in a corner the nearest edge wins; exact ties resolve left, right, top, bottom', () => {
  assert.equal(at(105, 100)!.zone, 'left'); // 1.25% from left, 6% from top
  assert.equal(at(300, 86)!.zone, 'top');
  const tiny: GroupGeometry = { group: 't', rect: { x: 0, y: 0, width: 100, height: 134 }, barHeight: 34 };
  assert.equal(hitTestGroup(tiny, { x: 0, y: 34 })!.zone, 'left'); // left and top both 0: left first
});

test('the topmost group wins where groups overlap, and misses give null', () => {
  const under: GroupGeometry = { group: 'under', rect: { x: 0, y: 0, width: 600, height: 400 }, barHeight: 34 };
  assert.equal(hitTest([under, g], { x: 300, y: 217 })!.group, 'g');
  assert.equal(hitTest([g, under], { x: 300, y: 217 })!.group, 'under');
  assert.equal(hitTest([g], { x: 0, y: 0 }), null);
});

test('tab insertion index follows tab midpoints; the line sits at the gap', () => {
  const tabs = [
    { x: 0, y: 0, width: 100, height: 34 },
    { x: 100, y: 0, width: 100, height: 34 },
    { x: 200, y: 0, width: 60, height: 34 },
  ];
  assert.deepEqual(tabInsertIndex(tabs, 10), { index: 0, lineX: 0 });
  assert.deepEqual(tabInsertIndex(tabs, 60), { index: 1, lineX: 100 });
  assert.deepEqual(tabInsertIndex(tabs, 140), { index: 1, lineX: 100 }); // left of the second tab's midpoint (150)
  assert.deepEqual(tabInsertIndex(tabs, 160), { index: 2, lineX: 200 });
  assert.deepEqual(tabInsertIndex(tabs, 300), { index: 3, lineX: 260 });
  assert.deepEqual(tabInsertIndex([], 5), { index: 0, lineX: null });
});

test('a hit becomes the matching placement', () => {
  const ids = { group: 'ng', split: 'ns' };
  assert.deepEqual(placementFor(at(300, 60)!, ids, 2), { kind: 'tabs', group: 'g', index: 2 });
  assert.deepEqual(placementFor(at(300, 60)!, ids), { kind: 'tabs', group: 'g' });
  assert.deepEqual(placementFor(at(300, 217)!, ids), { kind: 'tabs', group: 'g' });
  assert.deepEqual(placementFor(at(110, 217)!, ids), { kind: 'edge', group: 'g', side: 'left', ids });
});
