import type { GroupId, Side, SplitId } from './types.ts';
import type { Placement } from './ops.ts';

/** Pure geometry. A host measures rectangles however it likes and asks where a pointer would drop. */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type DropZone = 'tabbar' | 'center' | Side;

/** A tab group as the host measured it: its whole rectangle, and the height of its tab bar at the top. */
export interface GroupGeometry {
  readonly group: GroupId;
  readonly rect: Rect;
  readonly barHeight: number;
}

export interface Hit {
  readonly group: GroupId;
  readonly zone: DropZone;
  /** The region the dropped panel would occupy, for the host to highlight. */
  readonly region: Rect;
}

/** How deep into a group's body (as a fraction of its size) an edge zone reaches. */
export const DEFAULT_EDGE_FRACTION = 0.26;

const contains = (r: Rect, p: Point): boolean => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;

/**
 * Where a pointer would drop on one group.
 * Over the tab bar: `tabbar`. Over the body: the nearest edge when the pointer is within `edgeFraction` of it
 * (ties resolve left, right, top, bottom), otherwise `center`. Returns `null` when the pointer is outside the group.
 */
export function hitTestGroup(g: GroupGeometry, p: Point, edgeFraction: number = DEFAULT_EDGE_FRACTION): Hit | null {
  const r = g.rect;
  if (!contains(r, p)) return null;
  const bar: Rect = { x: r.x, y: r.y, width: r.width, height: Math.min(g.barHeight, r.height) };
  if (p.y < bar.y + bar.height) return { group: g.group, zone: 'tabbar', region: bar };

  const body: Rect = { x: r.x, y: bar.y + bar.height, width: r.width, height: r.height - bar.height };
  const fx = (p.x - body.x) / body.width;
  const fy = (p.y - body.y) / body.height;
  const distances: [Side, number][] = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy],
  ];
  let best = distances[0] as [Side, number];
  for (const d of distances) if (d[1] < best[1]) best = d;
  if (best[1] > edgeFraction) return { group: g.group, zone: 'center', region: r };

  const hw = body.width / 2;
  const hh = body.height / 2;
  const region: Rect = {
    left: { x: body.x, y: body.y, width: hw, height: body.height },
    right: { x: body.x + hw, y: body.y, width: hw, height: body.height },
    top: { x: body.x, y: body.y, width: body.width, height: hh },
    bottom: { x: body.x, y: body.y + hh, width: body.width, height: hh },
  }[best[0]];
  return { group: g.group, zone: best[0], region };
}

/** The topmost group under the pointer: later entries are on top, as with painted windows. */
export function hitTest(groups: readonly GroupGeometry[], p: Point, edgeFraction?: number): Hit | null {
  for (let i = groups.length - 1; i >= 0; i--) {
    const hit = hitTestGroup(groups[i] as GroupGeometry, p, edgeFraction);
    if (hit) return hit;
  }
  return null;
}

/**
 * Where a tab dropped at horizontal position `x` would be inserted, given the tab rectangles in order.
 * `lineX` is where to draw the insertion line (`null` when there are no tabs).
 */
export function tabInsertIndex(tabs: readonly Rect[], x: number): { index: number; lineX: number | null } {
  for (let i = 0; i < tabs.length; i++) {
    const t = tabs[i] as Rect;
    if (x < t.x + t.width / 2) return { index: i, lineX: t.x };
  }
  const last = tabs[tabs.length - 1];
  return { index: tabs.length, lineX: last ? last.x + last.width : null };
}

/**
 * Turns a hit into the operation placement. `ids` are the identifiers the caller allocated for anything created;
 * `tabIndex` comes from {@link tabInsertIndex} when the hit is over the tab bar.
 */
export function placementFor(hit: Hit, ids: { group: GroupId; split: SplitId }, tabIndex?: number): Placement {
  if (hit.zone === 'tabbar') {
    return tabIndex === undefined ? { kind: 'tabs', group: hit.group } : { kind: 'tabs', group: hit.group, index: tabIndex };
  }
  if (hit.zone === 'center') return { kind: 'tabs', group: hit.group };
  return { kind: 'edge', group: hit.group, side: hit.zone, ids };
}
