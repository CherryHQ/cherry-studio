import { Button } from '@cherrystudio/ui'
import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react'
import Ellipsis from '@renderer/components/Ellipsis'
import { CopyIcon, DeleteIcon, EditIcon } from '@renderer/components/Icons'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useKnowledge } from '@renderer/hooks/useKnowledge'
import FileItem from '@renderer/pages/files/FileItem'
import { getProviderName } from '@renderer/services/ProviderService'
import type { KnowledgeBase, KnowledgeItem } from '@renderer/types'
import dayjs from 'dayjs'
import { PlusIcon } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

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
          size="sm"
          variant="solid"
          color="primary"
          startContent={<PlusIcon size={16} />}
          onPress={handleAddUrl}
          isDisabled={disabled}>
          {t('knowledge.add_url')}
        </ResponsiveButton>
      </ItemHeader>
      <div className="h-[calc(100vh-135px)] px-4 py-5">
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
                  <Dropdown>
                    <DropdownTrigger>
                      <ClickableSpan>
                        <Ellipsis>
                          <a href={item.content as string} target="_blank" rel="noopener noreferrer">
                            {item.remark || (item.content as string)}
                          </a>
                        </Ellipsis>
                      </ClickableSpan>
                    </DropdownTrigger>
                    <DropdownMenu
                      aria-label="URL actions"
                      onAction={(key) => {
                        if (key === 'edit') {
                          handleEditRemark(item)
                        } else if (key === 'copy') {
                          navigator.clipboard.writeText(item.content as string)
                          window.toast.success(t('message.copied'))
                        }
                      }}>
                      <DropdownItem key="edit" startContent={<EditIcon size={14} />}>
                        {t('knowledge.edit_remark')}
                      </DropdownItem>
                      <DropdownItem key="copy" startContent={<CopyIcon size={14} />}>
                        {t('common.copy')}
                      </DropdownItem>
                    </DropdownMenu>
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
      </div>
    </ItemContainer>
  )
}

export default KnowledgeUrls
