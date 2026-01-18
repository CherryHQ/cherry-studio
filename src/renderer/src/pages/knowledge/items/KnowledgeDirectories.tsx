import { Button } from '@cherrystudio/ui'
import { useKnowledgeDirectories } from '@renderer/hooks/useKnowledge.v2'
import { formatFileSize } from '@renderer/utils'
import type {
  DirectoryItemData,
  ItemStatus,
  KnowledgeBase,
  KnowledgeItem as KnowledgeItemV2
} from '@shared/data/types/knowledge'
import { Book, CheckCircle2, ChevronDown, ChevronRight, Folder, FolderOpen, RotateCw, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KnowledgeItemActions } from '../components/KnowledgeItemActions'
import { KnowledgeItemRow } from '../components/KnowledgeItemRow'
import { formatKnowledgeTimestamp } from '../utils/time'

interface KnowledgeContentProps {
  selectedBase: KnowledgeBase
}

interface DirectoryGroup {
  groupId: string
  groupName: string
  items: KnowledgeItemV2[]
  aggregateStatus: ItemStatus
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
  const activeItem = items.find((item) => item.status !== 'completed' && item.status !== 'idle')
  return activeItem?.status ?? 'completed'
}

interface DirectoryGroupCardProps {
  group: DirectoryGroup
  isExpanded: boolean
  onToggle: () => void
  onRefreshGroup: (groupId: string) => void
  onDeleteGroup: (groupId: string) => void
  onRefreshItem: (itemId: string) => void
  onDeleteItem: (itemId: string) => void
  t: (key: string) => string
}

const DirectoryGroupCard: FC<DirectoryGroupCardProps> = ({
  group,
  isExpanded,
  onToggle,
  onRefreshGroup,
  onDeleteGroup,
  onRefreshItem,
  onDeleteItem,
  t
}) => {
  return (
    <div>
      {/* Header */}
      <div
        className="flex cursor-pointer items-center justify-between border-border border-b px-4 py-2"
        onClick={onToggle}>
        <div className="flex flex-1 items-center gap-2">
          {isExpanded ? (
            <ChevronDown size={16} className="shrink-0 text-foreground" />
          ) : (
            <ChevronRight size={16} className="shrink-0 text-foreground" />
          )}
          {isExpanded ? (
            <FolderOpen size={18} className="shrink-0 text-foreground" />
          ) : (
            <Folder size={18} className="shrink-0 text-foreground" />
          )}
          <span
            className="cursor-pointer truncate"
            onClick={(e) => {
              e.stopPropagation()
              window.api.file.openPath(group.groupName)
            }}>
            {group.groupName}
          </span>
          <span className="text-foreground-muted">|</span>
          <span className="shrink-0 text-foreground-muted">
            {group.fileCount} {t('knowledge.files')} · {group.latestUpdate}
          </span>
        </div>
        <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
          {!isExpanded && group.aggregateStatus === 'completed' && (
            <Button size="icon-sm" variant="ghost">
              <CheckCircle2 size={16} className="text-primary" />
            </Button>
          )}
          {(group.aggregateStatus === 'completed' || group.aggregateStatus === 'failed') && (
            <Button size="icon-sm" variant="ghost" onClick={() => onRefreshGroup(group.groupId)}>
              <RotateCw size={16} className="text-foreground" />
            </Button>
          )}
          <Button size="icon-sm" variant="ghost" onClick={() => onDeleteGroup(group.groupId)}>
            <Trash2 size={16} className="text-red-600" />
          </Button>
        </div>
      </div>

      {/* Collapsible content */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}>
            <div className="flex flex-col gap-2 px-4 pb-2 pl-10">
              {group.items.map((item) => {
                const file = (item.data as DirectoryItemData).file
                return (
                  <KnowledgeItemRow
                    key={item.id}
                    icon={<Book size={18} className="text-foreground" />}
                    content={
                      <span onClick={() => window.api.file.openFileWithRelativePath(file)}>{file.origin_name}</span>
                    }
                    metadata={formatFileSize(file.size)}
                    actions={<KnowledgeItemActions item={item} onRefresh={onRefreshItem} onDelete={onDeleteItem} />}
                  />
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const KnowledgeDirectories: FC<KnowledgeContentProps> = ({ selectedBase }) => {
  const { t } = useTranslation()
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const { directoryItems, deleteItem, refreshItem, deleteGroup, refreshGroup } = useKnowledgeDirectories(
    selectedBase.id || ''
  )

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
        fileCount: items.length,
        latestUpdate: getLatestUpdateTime(items)
      }
    })
  }, [directoryItems])

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  if (!selectedBase) {
    return null
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 px-4 py-5">
        {groupedDirectories.length === 0 && (
          <div className="text-center text-foreground-muted">{t('common.no_results')}</div>
        )}
        {groupedDirectories.map((group) => (
          <DirectoryGroupCard
            key={group.groupId}
            group={group}
            isExpanded={expandedGroups.has(group.groupId)}
            onToggle={() => toggleGroup(group.groupId)}
            onRefreshGroup={refreshGroup}
            onDeleteGroup={deleteGroup}
            onRefreshItem={refreshItem}
            onDeleteItem={deleteItem}
            t={t}
          />
        ))}
      </div>
    </div>
  )
}

export default KnowledgeDirectories
