import { isEqual } from 'es-toolkit/compat'
import { useRef } from 'react'

function areStructurallyEqual<TItem>(previous: TItem, next: TItem): boolean {
  return isEqual(previous, next)
}

/**
 * Reuses item references across refreshed list snapshots while their data is unchanged.
 * The array reference also stays stable when the ordered contents are unchanged.
 */
export function useStableListItems<TItem extends { id: string }>(
  items: readonly TItem[],
  areEqual: (previous: TItem, next: TItem) => boolean = areStructurallyEqual
): TItem[] {
  // The input is never mutated, so adopting it as the initial mutable snapshot is safe.
  const stableRef = useRef(items as TItem[])
  const previousById = new Map(stableRef.current.map((item) => [item.id, item]))
  const next = items.map((item) => {
    const previous = previousById.get(item.id)
    return previous && (previous === item || areEqual(previous, item)) ? previous : item
  })

  if (
    stableRef.current.length === next.length &&
    stableRef.current.every((previous, index) => previous === next[index])
  ) {
    return stableRef.current
  }

  stableRef.current = next
  return stableRef.current
}
