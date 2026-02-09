import { Tooltip } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { useKnowledgeUrls } from '@renderer/hooks/useKnowledges'
import type { KnowledgeItem, UrlItemData } from '@shared/data/types/knowledge'
import { Link } from 'lucide-react'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ItemDeleteAction,
  ItemEditAction,
  ItemRefreshAction,
  ItemStatusAction,
  KnowledgeItemActions
} from '../components/KnowledgeItemActions'
import { KnowledgeItemList } from '../components/KnowledgeItemList'
import { KnowledgeItemRow } from '../components/KnowledgeItemRow'
import { useKnowledgeBaseCtx } from '../context'
import { formatKnowledgeItemTime } from '../utils/time'

const logger = loggerService.withContext('KnowledgeUrls')

const KnowledgeUrls: FC = () => {
  const { t } = useTranslation()
  const { selectedBase } = useKnowledgeBaseCtx()
  const { urlItems, deleteItem, refreshItem } = useKnowledgeUrls(selectedBase?.id ?? '')

  const invalidateCache = useInvalidateCache()
  const itemsRefreshKey = selectedBase?.id ? `/knowledge-bases/${selectedBase.id}/items` : ''

  const updateItem = useCallback(
    async (item: KnowledgeItem, name: string) => {
      const data = item.data as UrlItemData
      try {
        await dataApiService.patch(`/knowledge-items/${item.id}`, {
          body: {
            data: {
              url: data.url,
              name
            } satisfies UrlItemData
          }
        })
        logger.info('URL remark updated', { itemId: item.id })
        if (itemsRefreshKey) {
          await invalidateCache(itemsRefreshKey)
        }
      } catch (error) {
        logger.error('Failed to update URL remark', error as Error, { itemId: item.id })
        throw error
      }
    },
    [invalidateCache, itemsRefreshKey]
  )

  const disabled = !selectedBase?.embeddingModelId

  const handleEditRemark = async (item: KnowledgeItem) => {
    if (disabled) return

    const data = item.data as UrlItemData
    const defaultName = data.name !== data.url ? data.name : ''
    const editedRemark: string | undefined = await PromptPopup.show({
      title: t('knowledge.edit_remark'),
      message: '',
      inputPlaceholder: t('knowledge.edit_remark_placeholder'),
      defaultValue: defaultName,
      inputProps: { maxLength: 100, rows: 1 }
    })

    if (editedRemark !== undefined && editedRemark !== null) {
      const nextName = editedRemark.trim() ? editedRemark.trim() : data.url
      updateItem(item, nextName)
    }
  }

  if (!selectedBase) {
    return null
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 px-4 py-5">
        <KnowledgeItemList items={urlItems}>
          {(item) => {
            const data = item.data as UrlItemData
            const displayName = data.name && data.name !== data.url ? data.name : data.url
            return (
              <KnowledgeItemRow
                icon={<Link size={18} className="text-foreground" />}
                content={
                  <Tooltip content={data.url}>
                    <a href={data.url} target="_blank" rel="noopener noreferrer">
                      {displayName}
                    </a>
                  </Tooltip>
                }
                metadata={formatKnowledgeItemTime(item)}
                actions={
                  <KnowledgeItemActions>
                    <ItemStatusAction item={item} />
                    <ItemEditAction onClick={() => handleEditRemark(item)} />
                    <ItemRefreshAction item={item} onRefresh={refreshItem} />
                    <ItemDeleteAction itemId={item.id} onDelete={deleteItem} />
                  </KnowledgeItemActions>
                }
              />
            )
          }}
        </KnowledgeItemList>
      </div>
    </div>
  )
}

export default KnowledgeUrls
