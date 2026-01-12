import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import Ellipsis from '@renderer/components/Ellipsis'
import { DeleteIcon } from '@renderer/components/Icons'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useKnowledgeDirectories } from '@renderer/hooks/useKnowledge.v2'
import FileItem from '@renderer/pages/files/FileItem'
import { getProviderName } from '@renderer/services/ProviderService'
import type { KnowledgeBase } from '@renderer/types'
import type { DirectoryItemData, KnowledgeItem as KnowledgeItemV2 } from '@shared/data/types/knowledge'
import dayjs from 'dayjs'
import { PlusIcon } from 'lucide-react'
import type { FC } from 'react'
import { useCallback } from 'react'
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

const logger = loggerService.withContext('KnowledgeDirectories')

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
  progressMap: Map<string, number>
}

const getDisplayTime = (item: KnowledgeItemV2) => {
  const createdAt = Date.parse(item.createdAt)
  const updatedAt = Date.parse(item.updatedAt)
  const timestamp = updatedAt > createdAt ? updatedAt : createdAt
  return dayjs(timestamp).format('MM-DD HH:mm')
}

const KnowledgeDirectories: FC<KnowledgeContentProps> = ({ selectedBase, progressMap }) => {
  const { t } = useTranslation()

  // v2 Data API hook for directory items
  const { directoryItems, hasProcessingItems, addDirectory, isAddingDirectory, deleteItem, refreshItem } =
    useKnowledgeDirectories(selectedBase.id || '')

  const providerName = getProviderName(selectedBase?.model)
  const disabled = !selectedBase?.version || !providerName

  const reversedItems = [...directoryItems].reverse()
  const estimateSize = useCallback(() => 75, [])

  if (!selectedBase) {
    return null
  }

  const handleAddDirectory = async () => {
    if (disabled || isAddingDirectory) {
      return
    }

    const path = await window.api.file.selectFolder()
    logger.info('Selected directory:', { path })
    path && addDirectory(path)
  }

  return (
    <ItemContainer>
      <ItemHeader>
        <ResponsiveButton variant="default" onClick={handleAddDirectory} disabled={disabled || isAddingDirectory}>
          <PlusIcon size={16} />
          {t('knowledge.add_directory')}
        </ResponsiveButton>
        {hasProcessingItems && <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>同步中...</span>}
      </ItemHeader>
      <ItemFlexColumn>
        {directoryItems.length === 0 && <KnowledgeEmptyView />}
        <DynamicVirtualList
          list={reversedItems}
          estimateSize={estimateSize}
          overscan={2}
          scrollerStyle={{ paddingRight: 2 }}
          itemContainerStyle={{ paddingBottom: 10 }}
          autoHideScrollbar>
          {(item) => {
            const data = item.data as DirectoryItemData
            return (
              <FileItem
                key={item.id}
                fileInfo={{
                  name: (
                    <ClickableSpan onClick={() => window.api.file.openPath(data.path)}>
                      <Ellipsis>
                        <Tooltip content={data.path}>{data.path}</Tooltip>
                      </Ellipsis>
                    </ClickableSpan>
                  ),
                  ext: '.folder',
                  extra: getDisplayTime(item),
                  actions: (
                    <FlexAlignCenter>
                      {item.status === 'completed' && (
                        <Button variant="ghost" onClick={() => refreshItem(item.id)}>
                          <RefreshIcon />
                        </Button>
                      )}
                      <StatusIconWrapper>
                        <StatusIcon
                          sourceId={item.id}
                          item={item}
                          progress={progressMap.get(item.id)}
                          type="directory"
                        />
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

export default KnowledgeDirectories
