import type { ProjectionLayoutNode, ProjectionLayoutSlot, ProjectionRowReader } from '@renderer/types/message'

export type Range<T> =
  | { key: string; size: 1; item: T }
  | { key: string; size: number; left: Range<T>; right: Range<T> }
export const single = <T>(key: string, item: T): Range<T> => ({ key, size: 1, item })
export function concat<T>(left?: Range<T>, right?: Range<T>): Range<T> | undefined {
  return left && right ? { key: left.key, size: left.size + right.size, left, right } : (left ?? right)
}
export function collect<T>(range: Range<T> | undefined): T[] {
  const items: T[] = []
  function visit(node: Range<T>) {
    if ('item' in node) items.push(node.item)
    else {
      visit(node.left)
      visit(node.right)
    }
  }
  if (range) visit(range)
  return items
}

export function foldLayout<T>(
  admit: (slot: ProjectionLayoutSlot) => T,
  join: (left: T, right: T) => T,
  empty: T
): (node: ProjectionLayoutNode) => T {
  const cache = new WeakMap<ProjectionLayoutNode | ProjectionLayoutSlot, T>()
  function fold(node: ProjectionLayoutNode | ProjectionLayoutSlot): T {
    const known = cache.get(node)
    if (known !== undefined) return known
    let result = empty
    if ('partId' in node) result = admit(node)
    else for (const child of 'children' in node ? node.children : node.slots) result = join(result, fold(child))
    cache.set(node, result)
    return result
  }
  return fold
}

/** A segment reads the same addressed leaves while retaining its own membership. */
export function filterProjectionRow(row: ProjectionRowReader, partIds: readonly string[]): ProjectionRowReader {
  const ids = new Set(partIds)
  const empty: ProjectionLayoutNode = { slots: [] }
  const select = foldLayout<ProjectionLayoutNode | null>(
    (slot) => (ids.has(slot.partId) ? { slots: [slot] } : null),
    (left, right) => (left && right ? { children: [left, right] } : (left ?? right)),
    null
  )
  return {
    getSnapshot: () => select(row.getSnapshot()) ?? empty,
    subscribe: (listener) => row.subscribe(listener)
  }
}
