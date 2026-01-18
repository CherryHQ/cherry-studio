import { DynamicVirtualList } from '@renderer/components/VirtualList'
import type { ReactNode } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useWindowHeight } from '../hooks/useWindowHeight'

interface KnowledgeItemListProps<T> {
  items: T[]
  emptyText?: string
  renderItem: (item: T) => ReactNode
  estimateSize?: number
  heightOffset?: number
}

export function KnowledgeItemList<T>({
  items,
  emptyText,
  renderItem,
  estimateSize = 75,
  heightOffset = 270
}: KnowledgeItemListProps<T>) {
  const { t } = useTranslation()
  const windowHeight = useWindowHeight()

  const reversedItems = useMemo(() => [...items].reverse(), [items])
  const getEstimateSize = useCallback(() => estimateSize, [estimateSize])

  if (items.length === 0) {
    return <div className="text-center text-foreground-muted">{emptyText ?? t('common.no_results')}</div>
  }

  return (
    <DynamicVirtualList
      list={reversedItems}
      estimateSize={getEstimateSize}
      overscan={2}
      scrollerStyle={{ height: windowHeight - heightOffset }}
      autoHideScrollbar>
      {(item) => renderItem(item)}
    </DynamicVirtualList>
  )
}
