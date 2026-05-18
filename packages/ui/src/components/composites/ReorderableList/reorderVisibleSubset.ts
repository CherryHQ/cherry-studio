export interface ReorderVisibleSubsetParams<T> {
  items: T[]
  visibleItems?: T[]
  fromIndex: number
  toIndex: number
  getId: (item: T) => string | number
}

export function reorderVisibleSubset<T>({
  items,
  visibleItems = items,
  fromIndex,
  toIndex,
  getId
}: ReorderVisibleSubsetParams<T>): T[] {
  if (fromIndex === toIndex) {
    return items
  }

  const sourceItem = visibleItems[fromIndex]
  const targetItem = visibleItems[toIndex]

  if (!sourceItem || !targetItem) {
    return items
  }

  const indexById = new Map(items.map((item, index) => [getId(item), index]))
  const sourceIndex = indexById.get(getId(sourceItem))
  const targetIndex = indexById.get(getId(targetItem))

  if (sourceIndex === undefined || targetIndex === undefined || sourceIndex === targetIndex) {
    return items
  }

  const nextItems = [...items]
  const [movedItem] = nextItems.splice(sourceIndex, 1)

  if (!movedItem) {
    return items
  }

  nextItems.splice(targetIndex, 0, movedItem)
  return nextItems
}
