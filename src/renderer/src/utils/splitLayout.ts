import type { SplitLayout, SplitPane } from '@shared/data/cache/cacheValueTypes'

/**
 * Find a pane by its ID in the layout tree.
 */
export function findPaneById(layout: SplitLayout, paneId: string): SplitPane | null {
  if (layout.type === 'leaf') {
    return layout.paneId === paneId ? layout : null
  }
  return findPaneById(layout.children[0], paneId) ?? findPaneById(layout.children[1], paneId)
}

/**
 * Replace a pane by its ID with a new layout node.
 * Returns a new tree (immutable).
 */
export function replacePaneById(layout: SplitLayout, paneId: string, replacement: SplitLayout): SplitLayout {
  if (layout.type === 'leaf') {
    return layout.paneId === paneId ? replacement : layout
  }
  return {
    ...layout,
    children: [
      replacePaneById(layout.children[0], paneId, replacement),
      replacePaneById(layout.children[1], paneId, replacement)
    ]
  }
}

/**
 * Remove a pane by its ID from the layout tree.
 * When a split node loses one child, returns the remaining child (auto-collapse).
 * Returns null if the removed pane was the only node.
 */
export function removePaneById(layout: SplitLayout, paneId: string): SplitLayout | null {
  if (layout.type === 'leaf') {
    return layout.paneId === paneId ? null : layout
  }

  const left = removePaneById(layout.children[0], paneId)
  const right = removePaneById(layout.children[1], paneId)

  if (left === null && right === null) return null
  if (left === null) return right
  if (right === null) return left

  return { ...layout, children: [left, right] }
}

/**
 * Update the resize ratio at a given tree path.
 * Path is an array of indices (0 or 1) navigating through split node children.
 * An empty path means update the current node's ratio.
 */
export function updateRatioAtPath(layout: SplitLayout, path: number[], ratio: number): SplitLayout {
  if (layout.type === 'leaf') return layout

  if (path.length === 0) {
    return { ...layout, ratio }
  }

  const [head, ...rest] = path
  const newChildren: [SplitLayout, SplitLayout] = [...layout.children]
  newChildren[head] = updateRatioAtPath(layout.children[head], rest, ratio)
  return { ...layout, children: newChildren }
}

/**
 * Collect all pane IDs in the layout tree.
 */
export function collectAllPaneIds(layout: SplitLayout): string[] {
  if (layout.type === 'leaf') {
    return [layout.paneId]
  }
  return [...collectAllPaneIds(layout.children[0]), ...collectAllPaneIds(layout.children[1])]
}

/**
 * Update a specific pane's URL, title, or preview flag in the tree.
 */
export function updatePaneInLayout(
  layout: SplitLayout,
  paneId: string,
  updates: Partial<Pick<SplitPane, 'url' | 'title' | 'isPreview'>>
): SplitLayout {
  if (layout.type === 'leaf') {
    return layout.paneId === paneId ? { ...layout, ...updates } : layout
  }
  return {
    ...layout,
    children: [
      updatePaneInLayout(layout.children[0], paneId, updates),
      updatePaneInLayout(layout.children[1], paneId, updates)
    ]
  }
}

/**
 * Find the preview pane in the layout tree (if any).
 * Invariant: at most one preview pane per tree.
 */
export function findPreviewPane(layout: SplitLayout): SplitPane | null {
  if (layout.type === 'leaf') {
    return layout.isPreview ? layout : null
  }
  return findPreviewPane(layout.children[0]) ?? findPreviewPane(layout.children[1])
}
