import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useKnowledgeUrls } from '@renderer/hooks/useKnowledge.v2'
import FileItem from '@renderer/pages/files/FileItem'
import { getProviderName } from '@renderer/services/ProviderService'
import type { KnowledgeBase } from '@renderer/types'
import type { KnowledgeItem as KnowledgeItemV2, UrlItemData } from '@shared/data/types/knowledge'
import { Dropdown } from 'antd'
import { Copy, Pencil, RotateCw, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import StatusIcon from '../components/StatusIcon'
import { formatKnowledgeItemTime } from '../utils/time'

const logger = loggerService.withContext('KnowledgeUrls')

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const KnowledgeUrls: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { t } = useTranslation()

  // v2 Data API hook for URL items
  const { urlItems, deleteItem, refreshItem } = useKnowledgeUrls(selectedBase.id || '')

  // v2 Data API hook for updating item remark
  const itemsRefreshKey = selectedBase.id ? `/knowledges/${selectedBase.id}/items` : ''
  const { trigger: updateItemApi } = useMutation('PATCH', `/knowledge-items/:id` as any, {
    refresh: itemsRefreshKey ? [itemsRefreshKey] : []
  })

  const updateItem = useCallback(
    async (item: KnowledgeItemV2, name: string) => {
      const data = item.data as UrlItemData
      try {
        await updateItemApi({
          params: { id: item.id },
          body: {
            data: {
              url: data.url,
              name
            } satisfies UrlItemData
          }
        } as any)
        logger.info('URL remark updated', { itemId: item.id })
      } catch (error) {
        logger.error('Failed to update URL remark', error as Error, { itemId: item.id })
        throw error
      }
    },
    [updateItemApi]
  )

  const providerName = getProviderName(selectedBase?.model)
  const disabled = !selectedBase?.version || !providerName

  const reversedItems = [...urlItems].reverse()
  const estimateSize = useCallback(() => 75, [])

  if (!selectedBase) {
    return null
  }

  const handleEditRemark = async (item: KnowledgeItemV2) => {
    if (disabled) {
      return
    }

    const data = item.data as UrlItemData
    const defaultName = data.name !== data.url ? data.name : ''
    const editedRemark: string | undefined = await PromptPopup.show({
      title: t('knowledge.edit_remark'),
      message: '',
      inputPlaceholder: t('knowledge.edit_remark_placeholder'),
      defaultValue: defaultName,
      inputProps: {
        maxLength: 100,
        rows: 1
      }
    })

    if (editedRemark !== undefined && editedRemark !== null) {
      const nextName = editedRemark.trim() ? editedRemark.trim() : data.url
      updateItem(item, nextName)
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 px-4 py-5">
        {urlItems.length === 0 && <div className="text-center text-foreground-muted">{t('common.no_results')}</div>}
        <DynamicVirtualList
          list={reversedItems}
          estimateSize={estimateSize}
          overscan={2}
          scrollerStyle={{ paddingRight: 2 }}
          itemContainerStyle={{ paddingBottom: 10 }}
          autoHideScrollbar>
          {(item) => {
            const data = item.data as UrlItemData
            const displayName = data.name && data.name !== data.url ? data.name : data.url
            return (
              <FileItem
                key={item.id}
                fileInfo={{
                  name: (
                    <Dropdown
                      menu={{
                        items: [
                          {
                            key: 'edit',
                            icon: <Pencil size={14} />,
                            label: t('knowledge.edit_remark'),
                            onClick: () => handleEditRemark(item)
                          },
                          {
                            key: 'copy',
                            icon: <Copy size={14} />,
                            label: t('common.copy'),
                            onClick: () => {
                              navigator.clipboard.writeText(data.url)
                              window.toast.success(t('message.copied'))
                            }
                          }
                        ]
                      }}
                      trigger={['contextMenu']}>
                      <Tooltip content={data.url}>
                        <a href={data.url} target="_blank" rel="noopener noreferrer">
                          {displayName}
                        </a>
                      </Tooltip>
                    </Dropdown>
                  ),
                  ext: '.url',
                  extra: formatKnowledgeItemTime(item),
                  actions: (
                    <div className="flex items-center">
                      {item.status === 'completed' && (
                        <Button size="icon-sm" variant="ghost" onClick={() => refreshItem(item.id)}>
                          <RotateCw size={16} className="text-foreground" />
                        </Button>
                      )}
                      <Button size="icon-sm" variant="ghost">
                        <StatusIcon sourceId={item.id} item={item} type="url" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => deleteItem(item.id)}>
                        <Trash2 size={16} className="text-red-600" />
                      </Button>
                    </div>
                  )
                }}
              />
            )
          }}
        </DynamicVirtualList>
      </div>
    </div>
  )
}

export default KnowledgeUrls
