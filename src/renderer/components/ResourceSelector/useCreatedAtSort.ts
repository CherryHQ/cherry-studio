import type { TFunction } from 'i18next'
import { useMemo } from 'react'

import type { ResourceSelectorShellItem, ResourceSelectorShellSortOption } from './ResourceSelectorShell'

type CreatedAtSource = {
  id: string
  createdAt: string
}

export function useCreatedAtSort<T extends ResourceSelectorShellItem>(
  items: readonly CreatedAtSource[] | undefined,
  t: TFunction
): ResourceSelectorShellSortOption<T>[] {
  return useMemo(() => {
    const createdAtById = new Map<string, number>(
      (items ?? []).map((item) => [item.id, Date.parse(item.createdAt) || 0])
    )
    const at = (id: string) => createdAtById.get(id) ?? 0

    return [
      { id: 'desc', label: t('selector.common.sort.desc'), comparator: (a, b) => at(b.id) - at(a.id) },
      { id: 'asc', label: t('selector.common.sort.asc'), comparator: (a, b) => at(a.id) - at(b.id) }
    ]
  }, [items, t])
}
