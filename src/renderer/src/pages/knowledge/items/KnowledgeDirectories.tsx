import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import Ellipsis from '@renderer/components/Ellipsis'
import { DeleteIcon } from '@renderer/components/Icons'
import { useKnowledgeDirectories } from '@renderer/hooks/useKnowledge.v2'
import FileItem from '@renderer/pages/files/FileItem'
import { getProviderName } from '@renderer/services/ProviderService'
import type { KnowledgeBase } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import type { DirectoryItemData, ItemStatus, KnowledgeItem as KnowledgeItemV2 } from '@shared/data/types/knowledge'
import { Collapse } from 'antd'
import dayjs from 'dayjs'
import { PlusIcon } from 'lucide-react'
import type { FC } from 'react'
import { useMemo } from 'react'
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

interface DirectoryGroup {
  groupId: string
  groupName: string
  items: KnowledgeItemV2[]
  aggregateStatus: ItemStatus
  aggregateProgress: number
  fileCount: number
  latestUpdate: string
}

const getDisplayTime = (item: KnowledgeItemV2) => {
  const createdAt = Date.parse(item.createdAt)
  const updatedAt = Date.parse(item.updatedAt)
  const timestamp = updatedAt > createdAt ? updatedAt : createdAt
  return dayjs(timestamp).format('MM-DD HH:mm')
}

const getLatestUpdateTime = (items: KnowledgeItemV2[]): string => {
  let latest = 0
  for (const item of items) {
    const createdAt = Date.parse(item.createdAt)
    const updatedAt = Date.parse(item.updatedAt)
    const timestamp = Math.max(createdAt, updatedAt)
    if (timestamp > latest) {
      latest = timestamp
    }
  }
  return dayjs(latest).format('MM-DD HH:mm')
}

const computeAggregateStatus = (items: KnowledgeItemV2[]): ItemStatus => {
  const priority: ItemStatus[] = ['failed', 'pending', 'preprocessing', 'embedding', 'completed', 'idle']
  for (const status of priority) {
    if (items.some((item) => item.status === status)) {
      return status
    }
  }
  return 'idle'
}

const computeAggregateProgress = (items: KnowledgeItemV2[], progressMap: Map<string, number>): number => {
  if (items.length === 0) return 0
  const progresses = items.map((item) => progressMap.get(item.id) ?? item.progress ?? 0)
  return progresses.reduce((sum, p) => sum + p, 0) / progresses.length
}

const KnowledgeDirectories: FC<KnowledgeContentProps> = ({ selectedBase, progressMap }) => {
  const { t } = useTranslation()

  const { directoryItems, addDirectory, isAddingDirectory, deleteItem, refreshItem, deleteGroup, refreshGroup } =
    useKnowledgeDirectories(selectedBase.id || '')

  const providerName = getProviderName(selectedBase?.model)
  const disabled = !selectedBase?.version || !providerName

  // Group items by groupId
  const groupedDirectories = useMemo((): DirectoryGroup[] => {
    const groupMap = new Map<string, KnowledgeItemV2[]>()

    for (const item of directoryItems) {
      const data = item.data as DirectoryItemData
      const existing = groupMap.get(data.groupId) || []
      groupMap.set(data.groupId, [...existing, item])
    }

    return Array.from(groupMap.entries()).map(([groupId, items]) => {
      const data = items[0].data as DirectoryItemData
      return {
        groupId,
        groupName: data.groupName,
        items,
        aggregateStatus: computeAggregateStatus(items),
        aggregateProgress: computeAggregateProgress(items, progressMap),
        fileCount: items.length,
        latestUpdate: getLatestUpdateTime(items)
      }
    })
  }, [directoryItems, progressMap])

  // Reverse for display (newest first)
  const reversedGroups = useMemo(() => [...groupedDirectories].reverse(), [groupedDirectories])

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

  const collapseItems = reversedGroups.map((group) => ({
    key: group.groupId,
    label: (
      <DirectoryHeaderWrapper>
        <FileItem
          fileInfo={{
            name: (
              <ClickableSpan
                onClick={(e) => {
                  e.stopPropagation()
                  window.api.file.openPath(group.groupName)
                }}>
                <Ellipsis>
                  <Tooltip content={group.groupName}>{group.groupName}</Tooltip>
                </Ellipsis>
              </ClickableSpan>
            ),
            ext: '.folder',
            extra: `${group.fileCount} ${t('knowledge.files')} · ${group.latestUpdate}`,
            actions: (
              <FlexAlignCenter onClick={(e) => e.stopPropagation()}>
                {group.aggregateStatus === 'completed' && (
                  <Button variant="ghost" onClick={() => refreshGroup(group.groupId)}>
                    <RefreshIcon />
                  </Button>
                )}
                <StatusIconWrapper>
                  <StatusIcon
                    sourceId={group.groupId}
                    item={{ status: group.aggregateStatus, progress: group.aggregateProgress } as KnowledgeItemV2}
                    progress={group.aggregateProgress}
                    type="directory"
                  />
                </StatusIconWrapper>
                <Button variant="ghost" onClick={() => deleteGroup(group.groupId)}>
                  <DeleteIcon size={14} className="lucide-custom" style={{ color: 'var(--color-error)' }} />
                </Button>
              </FlexAlignCenter>
            )
          }}
        />
      </DirectoryHeaderWrapper>
    ),
    children: (
      <FileListContainer>
        {group.items.map((item) => {
          const file = (item.data as DirectoryItemData).file
          return (
            <FileItemWrapper key={item.id}>
              <FileItem
                fileInfo={{
                  name: (
                    <ClickableSpan onClick={() => window.api.file.openFileWithRelativePath(file)}>
                      <Ellipsis>
                        <Tooltip content={file.origin_name}>{file.origin_name}</Tooltip>
                      </Ellipsis>
                    </ClickableSpan>
                  ),
                  ext: file.ext,
                  extra: `${getDisplayTime(item)} · ${formatFileSize(file.size)}`,
                  actions: (
                    <FlexAlignCenter>
                      {item.status === 'completed' && (
                        <Button variant="ghost" onClick={() => refreshItem(item.id)}>
                          <RefreshIcon />
                        </Button>
                      )}
                      <StatusIconWrapper>
                        <StatusIcon sourceId={item.id} item={item} progress={progressMap.get(item.id)} type="file" />
                      </StatusIconWrapper>
                      <Button variant="ghost" onClick={() => deleteItem(item.id)}>
                        <DeleteIcon size={14} className="lucide-custom" style={{ color: 'var(--color-error)' }} />
                      </Button>
                    </FlexAlignCenter>
                  )
                }}
              />
            </FileItemWrapper>
          )
        })}
      </FileListContainer>
    ),
    styles: {
      header: {
        padding: '0',
        alignItems: 'center',
        background: 'transparent'
      },
      body: {
        padding: '0',
        borderTop: 'none'
      }
    }
  }))

  return (
    <ItemContainer>
      <ItemHeader>
        <ResponsiveButton variant="default" onClick={handleAddDirectory} disabled={disabled || isAddingDirectory}>
          <PlusIcon size={16} />
          {t('knowledge.add_directory')}
        </ResponsiveButton>
      </ItemHeader>
      <ItemFlexColumn>
        {groupedDirectories.length === 0 && <KnowledgeEmptyView />}
        {groupedDirectories.length > 0 && (
          <CollapseContainer>
            <Collapse bordered={false} defaultActiveKey={reversedGroups.map((g) => g.groupId)} items={collapseItems} />
          </CollapseContainer>
        )}
      </ItemFlexColumn>
    </ItemContainer>
  )
}

const ItemFlexColumn = styled.div`
  padding: 20px 16px;
  height: calc(100vh - 135px);
  overflow-y: auto;
`

const CollapseContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;

  .ant-collapse {
    background: transparent;
    border: none;
  }

  .ant-collapse-item {
    border: 0.5px solid var(--color-border);
    border-radius: 8px !important;
    overflow: hidden;
  }

  .ant-collapse-header {
    background: var(--color-background-soft);
    padding: 8px 16px !important;
  }

  .ant-collapse-expand-icon {
    padding-inline-start: 0 !important;
  }

  .ant-collapse-content {
    border-top: none;
    background: transparent;
  }

  .ant-collapse-content-box {
    padding: 0 16px 8px 16px;
  }
`

const DirectoryHeaderWrapper = styled.div`
  flex: 1;
  min-width: 0;
`

const FileListContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-left: 24px;
`

const FileItemWrapper = styled.div`
  height: 65px;
`

export default KnowledgeDirectories
