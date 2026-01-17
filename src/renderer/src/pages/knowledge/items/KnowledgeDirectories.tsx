import { Button, Tooltip } from '@cherrystudio/ui'
import { useKnowledgeDirectories } from '@renderer/hooks/useKnowledge.v2'
import FileItem from '@renderer/pages/files/FileItem'
import type { KnowledgeBase } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import type { DirectoryItemData, ItemStatus, KnowledgeItem as KnowledgeItemV2 } from '@shared/data/types/knowledge'
import { Collapse } from 'antd'
import { RotateCw, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import StatusIcon from '../components/StatusIcon'
import { formatKnowledgeItemTime, formatKnowledgeTimestamp } from '../utils/time'

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
  return formatKnowledgeTimestamp(latest)
}

const computeAggregateStatus = (items: KnowledgeItemV2[]): ItemStatus => {
  const priority: ItemStatus[] = ['failed', 'pending', 'ocr', 'read', 'embed', 'completed', 'idle']
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

  const { directoryItems, deleteItem, refreshItem, deleteGroup, refreshGroup } = useKnowledgeDirectories(
    selectedBase.id || ''
  )

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

  const collapseItems = reversedGroups.map((group) => ({
    key: group.groupId,
    label: (
      <DirectoryHeaderWrapper>
        <FileItem
          fileInfo={{
            name: (
              <div
                onClick={(e) => {
                  e.stopPropagation()
                  window.api.file.openPath(group.groupName)
                }}>
                <Tooltip content={group.groupName}>{group.groupName}</Tooltip>
              </div>
            ),
            ext: '.folder',
            extra: `${group.fileCount} ${t('knowledge.files')} · ${group.latestUpdate}`,
            actions: (
              <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                {group.aggregateStatus === 'completed' && (
                  <Button size="icon-sm" variant="ghost" onClick={() => refreshGroup(group.groupId)}>
                    <RotateCw size={16} className="text-foreground" />
                  </Button>
                )}
                <Button size="icon-sm" variant="ghost">
                  <StatusIcon
                    sourceId={group.groupId}
                    item={{ status: group.aggregateStatus, progress: group.aggregateProgress } as KnowledgeItemV2}
                    progress={group.aggregateProgress}
                    type="directory"
                  />
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={() => deleteGroup(group.groupId)}>
                  <Trash2 size={16} className="text-red-600" />
                </Button>
              </div>
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
                    <div onClick={() => window.api.file.openFileWithRelativePath(file)}>
                      <Tooltip content={file.origin_name}>{file.origin_name}</Tooltip>
                    </div>
                  ),
                  ext: file.ext,
                  extra: `${formatKnowledgeItemTime(item)} · ${formatFileSize(file.size)}`,
                  actions: (
                    <div className="flex items-center">
                      {item.status === 'completed' && (
                        <Button size="icon-sm" variant="ghost" onClick={() => refreshItem(item.id)}>
                          <RotateCw size={16} className="text-foreground" />
                        </Button>
                      )}
                      <Button size="icon-sm" variant="ghost">
                        <StatusIcon sourceId={item.id} item={item} progress={progressMap.get(item.id)} type="file" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => deleteItem(item.id)}>
                        <Trash2 size={16} className="text-red-600" />
                      </Button>
                    </div>
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
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 px-4 py-5">
        {groupedDirectories.length === 0 && (
          <div className="text-center text-foreground-muted">{t('common.no_results')}</div>
        )}
        {groupedDirectories.length > 0 && (
          <CollapseContainer>
            <Collapse bordered={false} defaultActiveKey={reversedGroups.map((g) => g.groupId)} items={collapseItems} />
          </CollapseContainer>
        )}
      </div>
    </div>
  )
}

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
