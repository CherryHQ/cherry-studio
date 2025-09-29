import { Button, Tooltip } from '@cherrystudio/ui'
import Ellipsis from '@renderer/components/Ellipsis'
import { CopyIcon, DeleteIcon, EditIcon } from '@renderer/components/Icons'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import FileItem from '@renderer/pages/files/FileItem'
import { getProviderName } from '@renderer/services/ProviderService'
import type { KnowledgeBase, KnowledgeItem } from '@renderer/types'
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

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

const getDisplayTime = (item: KnowledgeItem) => {
  const timestamp = item.updated_at && item.updated_at > item.created_at ? item.updated_at : item.created_at
  return dayjs(timestamp).format('MM-DD HH:mm')
}

const KnowledgeUrls: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { t } = useTranslation()

  const { base, urlItems, refreshItem, addUrl, removeItem, getProcessingStatus, updateItem } = useKnowledge(
    selectedBase.id || ''
  )

  const providerName = getProviderName(base?.model)
  const disabled = !base?.version || !providerName

  const reversedItems = useMemo(() => [...urlItems].reverse(), [urlItems])
  const estimateSize = useCallback(() => 75, [])

  if (!base) {
    return null
  }

  const handleAddUrl = async () => {
    if (disabled) {
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
        <ResponsiveButton
          variant="solid"
          color="primary"
          startContent={<PlusIcon size={16} />}
          onPress={handleAddUrl}
          isDisabled={disabled}>
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
                      <Tooltip placement="top" content={item.content as string}>
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
                      <Button variant="light" isIconOnly onPress={() => refreshItem(item)}>
                        <RefreshIcon />
                      </Button>
                    )}
                    <StatusIconWrapper>
                      <StatusIcon sourceId={item.id} base={base} getProcessingStatus={getProcessingStatus} type="url" />
                    </StatusIconWrapper>
                    <Button variant="light" color="danger" isIconOnly onPress={() => removeItem(item)}>
                      <DeleteIcon size={14} className="lucide-custom" />
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
