import type { LeafPane, PaneDirection, PaneLayout, PaneTab } from '@shared/data/cache/cacheValueTypes'

/**
 * Find a leaf pane by its ID in the layout tree.
 */
export function findLeafById(layout: PaneLayout, paneId: string): LeafPane | null {
  if (layout.type === 'leaf') {
    return layout.paneId === paneId ? layout : null
  }
  return findLeafById(layout.children[0], paneId) ?? findLeafById(layout.children[1], paneId)
}

/**
 * Replace a leaf pane (by id) with a new layout subtree.
 * Immutable — returns a new tree.
 */
export function replaceLeafById(layout: PaneLayout, paneId: string, replacement: PaneLayout): PaneLayout {
  if (layout.type === 'leaf') {
    return layout.paneId === paneId ? replacement : layout
  }
  return {
    ...layout,
    children: [
      replaceLeafById(layout.children[0], paneId, replacement),
      replaceLeafById(layout.children[1], paneId, replacement)
    ]
  }
}

/**
 * Remove a leaf pane. When a split loses one child, the remaining sibling
 * replaces the split (auto-collapse). Returns null if the whole tree disappears.
 */
export function removeLeafById(layout: PaneLayout, paneId: string): PaneLayout | null {
  if (layout.type === 'leaf') {
    return layout.paneId === paneId ? null : layout
  }

  const left = removeLeafById(layout.children[0], paneId)
  const right = removeLeafById(layout.children[1], paneId)

  if (left === null && right === null) return null
  if (left === null) return right
  if (right === null) return left

  return { ...layout, children: [left, right] }
}

/**
 * Apply an updater to a specific leaf pane. No-op if the leaf isn't found.
 */
export function updateLeafById(layout: PaneLayout, paneId: string, updater: (leaf: LeafPane) => LeafPane): PaneLayout {
  if (layout.type === 'leaf') {
    return layout.paneId === paneId ? updater(layout) : layout
  }
  return {
    ...layout,
    children: [updateLeafById(layout.children[0], paneId, updater), updateLeafById(layout.children[1], paneId, updater)]
  }
}

/**
 * Update the resize ratio at a given tree path.
 * Path is an array of indices (0 or 1) navigating through split children.
 * Empty path updates the current node's ratio.
 */
export function updateRatioAtPath(layout: PaneLayout, path: number[], ratio: number): PaneLayout {
  if (layout.type === 'leaf') return layout

  if (path.length === 0) {
    return { ...layout, ratio }
  }

  const [head, ...rest] = path
  const newChildren: [PaneLayout, PaneLayout] = [...layout.children]
  newChildren[head] = updateRatioAtPath(layout.children[head], rest, ratio)
  return { ...layout, children: newChildren }
}

/**
 * Collect all leaf paneIds in tree order (depth-first, left-to-right).
 */
export function collectAllLeafIds(layout: PaneLayout): string[] {
  if (layout.type === 'leaf') {
    return [layout.paneId]
  }
  return [...collectAllLeafIds(layout.children[0]), ...collectAllLeafIds(layout.children[1])]
}

/**
 * Collect every (paneId, tab) pair across the whole tree.
 * Used by LRU to run a cross-pane hibernation pass.
 */
export function collectAllTabs(layout: PaneLayout): Array<{ paneId: string; tab: PaneTab }> {
  if (layout.type === 'leaf') {
    return layout.tabs.map((tab) => ({ paneId: layout.paneId, tab }))
  }
  return [...collectAllTabs(layout.children[0]), ...collectAllTabs(layout.children[1])]
}

/**
 * First (leftmost, deepest) leaf of the tree. Used as a fallback for
 * activePaneId after removals.
 */
export function firstLeaf(layout: PaneLayout): LeafPane {
  if (layout.type === 'leaf') return layout
  return firstLeaf(layout.children[0])
}

/**
 * Split a specific leaf by wrapping it in a new split node with a sibling.
 * The existing leaf stays at `before` position (placement='after' puts the
 * new leaf after it; 'before' puts it before it).
 */
export function splitLeaf(
  layout: PaneLayout,
  paneId: string,
  direction: PaneDirection,
  newLeaf: LeafPane,
  placement: 'after' | 'before' = 'after'
): PaneLayout {
  const existing = findLeafById(layout, paneId)
  if (!existing) return layout

  const children: [PaneLayout, PaneLayout] = placement === 'after' ? [existing, newLeaf] : [newLeaf, existing]

  const splitNode: PaneLayout = {
    type: 'split',
    direction,
    ratio: 50,
    children
  }

  return replaceLeafById(layout, paneId, splitNode)
}

/**
 * Locate a tab by id anywhere in the tree.
 */
export function findTabInTree(layout: PaneLayout, tabId: string): { paneId: string; tab: PaneTab } | null {
  if (layout.type === 'leaf') {
    const tab = layout.tabs.find((t) => t.id === tabId)
    return tab ? { paneId: layout.paneId, tab } : null
  }
  return findTabInTree(layout.children[0], tabId) ?? findTabInTree(layout.children[1], tabId)
}
