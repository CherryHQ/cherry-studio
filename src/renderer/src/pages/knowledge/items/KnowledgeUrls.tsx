import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import Ellipsis from '@renderer/components/Ellipsis'
import { CopyIcon, DeleteIcon, EditIcon } from '@renderer/components/Icons'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useKnowledgeUrls } from '@renderer/hooks/useKnowledge.v2'
import FileItem from '@renderer/pages/files/FileItem'
import { getProviderName } from '@renderer/services/ProviderService'
import type { KnowledgeBase } from '@renderer/types'
import type { KnowledgeItem as KnowledgeItemV2, UrlItemData } from '@shared/data/types/knowledge'
import { Dropdown } from 'antd'
import { PlusIcon } from 'lucide-react'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  ClickableSpan,
  FlexAlignCenter,
  ItemContainer,
  ItemHeader,
  KnowledgeEmptyView,
  RefreshIcon,
  ResponsiveButton,
  StatusIconWrapper
} from '../components/KnowledgeItemLayout'
import StatusIcon from '../components/StatusIcon'
import { formatKnowledgeItemTime } from '../utils/time'

const logger = loggerService.withContext('KnowledgeUrls')

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const KnowledgeUrls: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { t } = useTranslation()

  // v2 Data API hook for URL items
  const { urlItems, addUrl, isAddingUrl, deleteItem, refreshItem } = useKnowledgeUrls(selectedBase.id || '')

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
          const trimmedUrl = url.trim()
          const hasUrl = urlItems.some((item) => (item.data as UrlItemData).url === trimmedUrl)
          if (!hasUrl) {
            addUrl(trimmedUrl)
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
    <ItemContainer>
      <ItemHeader>
        <ResponsiveButton variant="default" onClick={handleAddUrl} disabled={disabled || isAddingUrl}>
          <PlusIcon size={16} />
          {t('knowledge.add_url')}
        </ResponsiveButton>
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
                            icon: <EditIcon size={14} />,
                            label: t('knowledge.edit_remark'),
                            onClick: () => handleEditRemark(item)
                          },
                          {
                            key: 'copy',
                            icon: <CopyIcon size={14} />,
                            label: t('common.copy'),
                            onClick: () => {
                              navigator.clipboard.writeText(data.url)
                              window.toast.success(t('message.copied'))
                            }
                          }
                        ]
                      }}
                      trigger={['contextMenu']}>
                      <ClickableSpan>
                        <Tooltip content={data.url}>
                          <Ellipsis>
                            <a href={data.url} target="_blank" rel="noopener noreferrer">
                              {displayName}
                            </a>
                          </Ellipsis>
                        </Tooltip>
                      </ClickableSpan>
                    </Dropdown>
                  ),
                  ext: '.url',
                  extra: formatKnowledgeItemTime(item),
                  actions: (
                    <FlexAlignCenter>
                      {item.status === 'completed' && (
                        <Button variant="ghost" onClick={() => refreshItem(item.id)}>
                          <RefreshIcon />
                        </Button>
                      )}
                      <StatusIconWrapper>
                        <StatusIcon sourceId={item.id} item={item} type="url" />
                      </StatusIconWrapper>
                      <Button variant="ghost" onClick={() => deleteItem(item.id)}>
                        <DeleteIcon size={14} className="lucide-custom" style={{ color: 'var(--color-error)' }} />
                      </Button>
                    </FlexAlignCenter>
                  )
                }}
              />
            )
          }}
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
