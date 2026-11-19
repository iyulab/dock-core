import type { MutableNode as MNode, MutableWorkspace } from './types.ts';

/**
 * Brings a (private, mutable) workspace into its normal form:
 * - a tab group without panels disappears;
 * - a split with one child is replaced by that child;
 * - a split nested in a split of the same direction is merged into it;
 * - sizes sum to 1.
 * Idempotent, and a no-op on an already normalized workspace.
 */
export function normalize(w: MutableWorkspace): void {
  for (const root of Object.values(w.roots)) root.node = normalizeNode(root.node);
}

function normalizeNode(node: MNode | null): MNode | null {
  if (!node) return null;
  if (node.kind === 'tabs') {
    if (node.panels.length === 0) return null;
    if (!node.panels.includes(node.active)) node.active = node.panels[0] as string;
    return node;
  }
  const children: MNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const n = normalizeNode(child);
    const size = node.sizes[i] as number;
    if (!n) return;
    if (n.kind === 'split' && n.direction === node.direction) {
      const total = n.sizes.reduce((a, b) => a + b, 0);
      n.children.forEach((grand, j) => {
        children.push(grand);
        sizes.push((size * (n.sizes[j] as number)) / total);
      });
    } else {
      children.push(n);
      sizes.push(size);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0] as MNode;
  const sum = sizes.reduce((a, b) => a + b, 0);
  node.children = children;
  // Leave sizes alone when they already sum to 1 (within rounding): rescaling them again would shift the last
  // digits on every pass, and a workspace must survive serialization and re-normalization unchanged.
  node.sizes = Math.abs(sum - 1) <= 1e-9 ? sizes : sizes.map((s) => s / sum);
  return node;
}
