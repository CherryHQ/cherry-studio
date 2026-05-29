import { ConfirmDialog } from '@cherrystudio/ui'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePreviewKnowledgeSource } from '../../hooks/usePreviewKnowledgeSource'
import DataSourcePanelHeader from './DataSourcePanelHeader'
import KnowledgeItemList from './KnowledgeItemList'
import type { DataSourceFilter } from './utils/models'
import { getReadyCount, getVisibleItems } from './utils/selectors'

export interface DataSourcePanelProps {
  items: KnowledgeItem[]
  isLoading: boolean
  onAdd: () => void
  onItemClick?: (itemId: string) => void
  onDelete: (item: KnowledgeItem) => void | Promise<unknown>
  onReindex: (item: KnowledgeItem) => void | Promise<unknown>
}

const DataSourcePanel = ({ items, isLoading, onAdd, onItemClick, onDelete, onReindex }: DataSourcePanelProps) => {
  const { t } = useTranslation()
  const { previewSource } = usePreviewKnowledgeSource()
  const [activeFilter, setActiveFilter] = useState<DataSourceFilter>('all')
  const [pendingDeleteItem, setPendingDeleteItem] = useState<KnowledgeItem | null>(null)
  const readyCount = getReadyCount(items)
  const visibleItems = getVisibleItems(items, activeFilter)
  const handleItemClick = (itemId: string) => onItemClick?.(itemId)

  const handleConfirmDelete = async () => {
    if (!pendingDeleteItem) {
      return
    }

    try {
      await onDelete(pendingDeleteItem)
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.delete_failed')))
      return
    }

    setPendingDeleteItem(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DataSourcePanelHeader
        activeFilter={activeFilter}
        readyCount={readyCount}
        totalCount={items.length}
        onFilterChange={setActiveFilter}
        onAdd={onAdd}
      />
      <KnowledgeItemList
        items={visibleItems}
        isLoading={isLoading}
        onItemClick={handleItemClick}
        onDelete={setPendingDeleteItem}
        onPreviewSource={previewSource}
        onReindex={onReindex}
        onViewChunks={handleItemClick}
      />
      <ConfirmDialog
        open={Boolean(pendingDeleteItem)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteItem(null)
          }
        }}
        title={t('knowledge.data_source.delete_confirm_title')}
        description={t('knowledge.data_source.delete_confirm_description')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}

export default DataSourcePanel
