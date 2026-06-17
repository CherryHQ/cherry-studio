import type { FlatTreeItem, TreeNodeAdapter } from './types'

/**
 * Walks a tree of nodes depth-first, producing a flat list with depth tags.
 * Children of nodes whose id is not in `expandedIds` are skipped.
 */
export function flattenTree<T>(
  data: readonly T[],
  adapter: TreeNodeAdapter<T>,
  expandedIds: ReadonlySet<string>
): FlatTreeItem<T>[] {
  const out: FlatTreeItem<T>[] = []
  const visitedIds = new Set<string>()
  const walk = (nodes: readonly T[], depth: number): void => {
    for (const node of nodes) {
      const id = adapter.getId(node)
      if (visitedIds.has(id)) continue
      visitedIds.add(id)
      out.push({ id, node, depth })
      if (expandedIds.has(id)) {
        const children = adapter.getChildren(node)
        if (children && children.length > 0) walk(children, depth + 1)
      }
    }
  }
  walk(data, 0)
  return out
}
