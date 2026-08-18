import { isEqual } from 'es-toolkit/compat'
import { useMemo, useRef } from 'react'

/** Preserve unchanged item references across paginated query refreshes. */
export function useStructurallySharedItems<TItem extends { id: string }>(items: readonly TItem[]): TItem[] {
  const previousItemsRef = useRef<TItem[]>([])

  return useMemo(() => {
    const previousItems = previousItemsRef.current
    const previousById = new Map(previousItems.map((item) => [item.id, item] as const))
    let arrayChanged = previousItems.length !== items.length

    const nextItems = items.map((item, index) => {
      const previous = previousById.get(item.id)
      const next = previous && isEqual(previous, item) ? previous : item
      if (next !== previousItems[index]) arrayChanged = true
      return next
    })
    const sharedItems = arrayChanged ? nextItems : previousItems
    previousItemsRef.current = sharedItems
    return sharedItems
  }, [items])
}
