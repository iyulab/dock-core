/**
 * The layout model is plain data: no DOM, no window, no transport. A workspace survives
 * `JSON.stringify` and back unchanged, so copies of it can live in different realms.
 */

export const SCHEMA_VERSION = 1;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type PanelId = string;
/** Identifier of a tab group. Groups and splits share one namespace: node ids are unique across a workspace. */
export type GroupId = string;
export type SplitId = string;
/** A root is whatever the host maps to a window. The model only knows its id. */
export type RootId = string;

export type Direction = 'row' | 'column';
export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface Panel {
  readonly id: PanelId;
  readonly title: string;
  /** Serializable data the application needs to re-create the panel's content in another realm. */
  readonly params?: Json;
}

export interface Tabs {
  readonly kind: 'tabs';
  readonly id: GroupId;
  /** Never empty in a normalized workspace. */
  readonly panels: readonly PanelId[];
  readonly active: PanelId;
}

export interface Split {
  readonly kind: 'split';
  readonly id: SplitId;
  readonly direction: Direction;
  readonly children: readonly Node[];
  /** Relative sizes, one per child, each positive. Normalized to sum to 1 after every operation. */
  readonly sizes: readonly number[];
}

export type Node = Tabs | Split;

export interface Root {
  readonly id: RootId;
  /** `null` is an empty root (a window with no panels). */
  readonly node: Node | null;
}

export interface Workspace {
  readonly version: number;
  readonly roots: Readonly<Record<RootId, Root>>;
  /** Registry of every panel in the workspace. Each registered panel appears in exactly one group. */
  readonly panels: Readonly<Record<PanelId, Panel>>;
}

/* Mutable mirrors of the model, used only on a private copy while an operation runs; never exposed. */
export interface MutablePanel {
  id: PanelId;
  title: string;
  params?: Json;
}
export interface MutableTabs {
  kind: 'tabs';
  id: GroupId;
  panels: PanelId[];
  active: PanelId;
}
export interface MutableSplit {
  kind: 'split';
  id: SplitId;
  direction: Direction;
  children: MutableNode[];
  sizes: number[];
}
export type MutableNode = MutableTabs | MutableSplit;
export interface MutableRoot {
  id: RootId;
  node: MutableNode | null;
}
export interface MutableWorkspace {
  version: number;
  roots: Record<RootId, MutableRoot>;
  panels: Record<PanelId, MutablePanel>;
}
