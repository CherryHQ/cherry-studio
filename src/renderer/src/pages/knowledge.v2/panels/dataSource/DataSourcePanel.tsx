import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { useState } from 'react'

import DataSourcePanelHeader from './DataSourcePanelHeader'
import KnowledgeItemList from './KnowledgeItemList'
import type { DataSourceFilter } from './utils/models'
import { getReadyCount, getVisibleItems } from './utils/selectors'

export interface DataSourcePanelProps {
  items: KnowledgeItem[]
  isLoading: boolean
}

const DataSourcePanel = ({ items, isLoading }: DataSourcePanelProps) => {
  const [activeFilter, setActiveFilter] = useState<DataSourceFilter>('all')
  const readyCount = getReadyCount(items)
  const visibleItems = getVisibleItems(items, activeFilter)
  const handleAdd = () => undefined
  const handleItemClick = () => undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DataSourcePanelHeader
        activeFilter={activeFilter}
        readyCount={readyCount}
        totalCount={items.length}
        onFilterChange={setActiveFilter}
        onAdd={handleAdd}
      />
      <KnowledgeItemList items={visibleItems} isLoading={isLoading} onItemClick={handleItemClick} />
    </div>
  )
}

export default DataSourcePanel
