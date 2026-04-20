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

/**
 * Move a tab from one leaf to another (or reorder within a single leaf).
 *
 * - Same-leaf case: splice within `tabs`, applying insertion-index math that
 *   accounts for the removal (if inserting after the removal point, shift back
 *   by one).
 * - Cross-leaf case: remove from source, insert at `insertIndex` in target;
 *   if the source leaf ends up empty, it is auto-collapsed via `removeLeafById`.
 *
 * `insertIndex` is clamped to the valid range [0, target.tabs.length]. The
 * moved tab becomes the target leaf's `activeTabId`. If the source leaf
 * retained tabs, its `activeTabId` is updated to a neighbour when the moved
 * tab was the previously active one.
 *
 * If `fromPaneId` doesn't exist, the tab isn't in the source, or `toPaneId`
 * doesn't exist, the tree is returned unchanged.
 */
export function moveTabBetweenLeaves(
  root: PaneLayout,
  fromPaneId: string,
  tabId: string,
  toPaneId: string,
  insertIndex: number
): PaneLayout {
  const source = findLeafById(root, fromPaneId)
  if (!source) return root
  const movingIndex = source.tabs.findIndex((t) => t.id === tabId)
  if (movingIndex === -1) return root
  const movingTab = source.tabs[movingIndex]

  // Same-leaf reorder — splice directly to avoid the collapse path.
  if (fromPaneId === toPaneId) {
    const tabs = [...source.tabs]
    tabs.splice(movingIndex, 1)
    const clamped = Math.max(0, Math.min(insertIndex, tabs.length))
    // If insertIndex was past the removal, the already-spliced array needs no shift.
    // If insertIndex <= movingIndex, insert at the original position.
    const finalIndex = insertIndex > movingIndex ? clamped : Math.min(insertIndex, tabs.length)
    tabs.splice(finalIndex, 0, movingTab)
    return updateLeafById(root, fromPaneId, (l) => ({
      ...l,
      tabs,
      activeTabId: movingTab.id
    }))
  }

  // Cross-leaf move — verify destination exists before mutating source.
  const target = findLeafById(root, toPaneId)
  if (!target) return root

  // 1. Remove from source (may result in empty source).
  const afterRemove = updateLeafById(root, fromPaneId, (l) => {
    const nextTabs = l.tabs.filter((t) => t.id !== tabId)
    const nextActive =
      l.activeTabId === tabId ? (nextTabs[movingIndex - 1]?.id ?? nextTabs[0]?.id ?? '') : l.activeTabId
    return { ...l, tabs: nextTabs, activeTabId: nextActive }
  })

  // 2. If source is now empty, collapse it so `toPaneId` still resolves in the compacted tree.
  let afterCollapse: PaneLayout = afterRemove
  const sourceAfter = findLeafById(afterRemove, fromPaneId)
  if (sourceAfter && sourceAfter.tabs.length === 0) {
    const collapsed = removeLeafById(afterRemove, fromPaneId)
    if (collapsed) afterCollapse = collapsed
  }

  // 3. Insert into target leaf.
  const targetAfter = findLeafById(afterCollapse, toPaneId)
  if (!targetAfter) return afterCollapse // safety net; shouldn't happen for valid input
  const clamped = Math.max(0, Math.min(insertIndex, targetAfter.tabs.length))
  return updateLeafById(afterCollapse, toPaneId, (l) => {
    const tabs = [...l.tabs]
    tabs.splice(clamped, 0, movingTab)
    return { ...l, tabs, activeTabId: movingTab.id }
  })
}
