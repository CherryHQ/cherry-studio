import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import Ellipsis from '@renderer/components/Ellipsis'
import { CopyIcon, DeleteIcon, EditIcon } from '@renderer/components/Icons'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useKnowledgeItems } from '@renderer/data/hooks/useKnowledges'
import { useKnowledgeItemDelete, useKnowledgeUrls } from '@renderer/hooks/useKnowledge.v2'
import FileItem from '@renderer/pages/files/FileItem'
import { getProviderName } from '@renderer/services/ProviderService'
import type { KnowledgeBase, KnowledgeItem, ProcessingStatus } from '@renderer/types'
import type { ItemStatus, KnowledgeItem as KnowledgeItemV2, UrlItemData } from '@shared/data/types/knowledge'
import { Dropdown } from 'antd'
import dayjs from 'dayjs'
import { PlusIcon } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import StatusIcon from '../components/StatusIcon'
import {
  ClickableSpan,
  FlexAlignCenter,
  ItemContainer,
  ItemHeader,
  KnowledgeEmptyView,
  RefreshIcon,
  ResponsiveButton,
  StatusIconWrapper
} from '../KnowledgeContent'

const logger = loggerService.withContext('KnowledgeUrls')

/**
 * Map v2 ItemStatus to v1 ProcessingStatus
 */
const mapV2StatusToV1 = (status: ItemStatus): ProcessingStatus => {
  const statusMap: Record<ItemStatus, ProcessingStatus> = {
    idle: 'pending',
    pending: 'pending',
    preprocessing: 'processing',
    embedding: 'processing',
    completed: 'completed',
    failed: 'failed'
  }
  return statusMap[status] ?? 'pending'
}

/**
 * Convert v2 KnowledgeItem (url type) to v1 format for UI compatibility
 */
const toV1UrlItem = (item: KnowledgeItemV2): KnowledgeItem => {
  const data = item.data as UrlItemData
  return {
    id: item.id,
    type: item.type,
    content: data.url,
    remark: data.name !== data.url ? data.name : undefined,
    created_at: Date.parse(item.createdAt),
    updated_at: Date.parse(item.updatedAt),
    processingStatus: mapV2StatusToV1(item.status),
    processingProgress: 0,
    processingError: item.error ?? '',
    retryCount: 0,
    uniqueId: item.status === 'completed' ? item.id : undefined
  }
}

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const getDisplayTime = (item: KnowledgeItem) => {
  const timestamp = item.updated_at && item.updated_at > item.created_at ? item.updated_at : item.created_at
  return dayjs(timestamp).format('MM-DD HH:mm')
}

const KnowledgeUrls: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { t } = useTranslation()

  // v2 Data API: Fetch items with smart polling
  const {
    items: v2Items,
    hasProcessingItems,
    mutate
  } = useKnowledgeItems(selectedBase.id || '', {
    enabled: !!selectedBase.id
  })

  // Convert v2 items to v1 format and filter by type 'url'
  const urlItems = useMemo(() => {
    return v2Items.filter((item) => item.type === 'url').map(toV1UrlItem)
  }, [v2Items])

  // Create a map of item statuses for getProcessingStatus
  const statusMap = useMemo(() => {
    const map = new Map<string, ProcessingStatus>()
    v2Items.forEach((item) => {
      const v1Status = mapV2StatusToV1(item.status)
      if (item.status !== 'completed') {
        map.set(item.id, v1Status)
      }
    })
    return map
  }, [v2Items])

  // Create a fake base object with items for StatusIcon compatibility
  const baseWithItems = useMemo(() => {
    return {
      ...selectedBase,
      items: urlItems
    }
  }, [selectedBase, urlItems])

  // getProcessingStatus function for StatusIcon
  const getProcessingStatus = useCallback(
    (sourceId: string): ProcessingStatus | undefined => {
      return statusMap.get(sourceId)
    },
    [statusMap]
  )

  // v2 Data API hook for adding URLs
  const { addUrl, isAddingUrl } = useKnowledgeUrls(selectedBase.id || '')

  // v2 Data API hook for deleting items
  const { deleteItem } = useKnowledgeItemDelete()

  // v2 Data API hook for refreshing items
  const { trigger: triggerRefresh } = useMutation('POST', `/knowledges/:id/refresh` as any)

  const refreshItem = useCallback(
    async (item: KnowledgeItem) => {
      try {
        await triggerRefresh({ params: { id: item.id } } as any)
        logger.info('Item refresh triggered', { itemId: item.id })
      } catch (error) {
        logger.error('Failed to refresh item', error as Error, { itemId: item.id })
      }
    },
    [triggerRefresh]
  )

  // v2 Data API hook for updating item remark
  const { trigger: updateItemApi } = useMutation('PATCH', `/knowledges/:id` as any)

  const updateItem = useCallback(
    async (item: KnowledgeItem) => {
      try {
        await updateItemApi({
          params: { id: item.id },
          body: {
            data: {
              type: 'url',
              url: item.content as string,
              name: item.remark || (item.content as string)
            } satisfies UrlItemData
          }
        } as any)
        // Refresh the items list
        mutate()
        logger.info('URL remark updated', { itemId: item.id })
      } catch (error) {
        logger.error('Failed to update URL remark', error as Error, { itemId: item.id })
        throw error
      }
    },
    [updateItemApi, mutate]
  )

  const providerName = getProviderName(selectedBase?.model)
  const disabled = !selectedBase?.version || !providerName

  const reversedItems = useMemo(() => [...urlItems].reverse(), [urlItems])
  const estimateSize = useCallback(() => 75, [])

  if (!selectedBase) {
    return null
  }

  const handleAddUrl = async () => {
    if (disabled || isAddingUrl) {
      return
    }

    const urlInput = await PromptPopup.show({
      title: t('knowledge.add_url'),
      message: '',
      inputPlaceholder: t('knowledge.url_placeholder'),
      inputProps: {
        rows: 10,
        onPressEnter: () => {}
      }
    })

    if (urlInput) {
      // Split input by newlines and filter out empty lines
      const urls = urlInput.split('\n').filter((url) => url.trim())

      for (const url of urls) {
        try {
          new URL(url.trim())
          if (!urlItems.find((item) => item.content === url.trim())) {
            addUrl(url.trim())
          } else {
            window.toast.success(t('knowledge.url_added'))
          }
        } catch (e) {
          // Skip invalid URLs silently
          continue
        }
      }
    }
  }

  const handleEditRemark = async (item: KnowledgeItem) => {
    if (disabled) {
      return
    }

    const editedRemark: string | undefined = await PromptPopup.show({
      title: t('knowledge.edit_remark'),
      message: '',
      inputPlaceholder: t('knowledge.edit_remark_placeholder'),
      defaultValue: item.remark || '',
      inputProps: {
        maxLength: 100,
        rows: 1
      }
    })

    if (editedRemark !== undefined && editedRemark !== null) {
      updateItem({
        ...item,
        remark: editedRemark,
        updated_at: Date.now()
      })
    }
  }

  return (
    <ItemContainer>
      <ItemHeader>
        <ResponsiveButton variant="default" onClick={handleAddUrl} disabled={disabled || isAddingUrl}>
          <PlusIcon size={16} />
          {t('knowledge.add_url')}
        </ResponsiveButton>
        {hasProcessingItems && <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>同步中...</span>}
      </ItemHeader>
      <ItemFlexColumn>
        {urlItems.length === 0 && <KnowledgeEmptyView />}
        <DynamicVirtualList
          list={reversedItems}
          estimateSize={estimateSize}
          overscan={2}
          scrollerStyle={{ paddingRight: 2 }}
          itemContainerStyle={{ paddingBottom: 10 }}
          autoHideScrollbar>
          {(item) => (
            <FileItem
              key={item.id}
              fileInfo={{
                name: (
                  <Dropdown
                    menu={{
                      items: [
                        {
                          key: 'edit',
                          icon: <EditIcon size={14} />,
                          label: t('knowledge.edit_remark'),
                          onClick: () => handleEditRemark(item)
                        },
                        {
                          key: 'copy',
                          icon: <CopyIcon size={14} />,
                          label: t('common.copy'),
                          onClick: () => {
                            navigator.clipboard.writeText(item.content as string)
                            window.toast.success(t('message.copied'))
                          }
                        }
                      ]
                    }}
                    trigger={['contextMenu']}>
                    <ClickableSpan>
                      <Tooltip content={item.content as string}>
                        <Ellipsis>
                          <a href={item.content as string} target="_blank" rel="noopener noreferrer">
                            {item.remark || (item.content as string)}
                          </a>
                        </Ellipsis>
                      </Tooltip>
                    </ClickableSpan>
                  </Dropdown>
                ),
                ext: '.url',
                extra: getDisplayTime(item),
                actions: (
                  <FlexAlignCenter>
                    {item.uniqueId && (
                      <Button variant="ghost" onClick={() => refreshItem(item)}>
                        <RefreshIcon />
                      </Button>
                    )}
                    <StatusIconWrapper>
                      <StatusIcon
                        sourceId={item.id}
                        base={baseWithItems}
                        getProcessingStatus={getProcessingStatus}
                        type="url"
                      />
                    </StatusIconWrapper>
                    <Button variant="ghost" onClick={() => deleteItem(selectedBase.id, item.id)}>
                      <DeleteIcon size={14} className="lucide-custom" style={{ color: 'var(--color-error)' }} />
                    </Button>
                  </FlexAlignCenter>
                )
              }}
            />
          )}
        </DynamicVirtualList>
      </ItemFlexColumn>
    </ItemContainer>
  )
}

const ItemFlexColumn = styled.div`
  padding: 20px 16px;
  height: calc(100vh - 135px);
`

export default KnowledgeUrls
