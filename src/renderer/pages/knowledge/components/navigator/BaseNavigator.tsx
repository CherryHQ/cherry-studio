import { Plus } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ResourceList } from '@renderer/components/chat/resourceList/base'
import {
  buildKnowledgeBaseGroupSections,
  DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY
} from '@renderer/pages/knowledge/utils/group'
import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'
import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import BaseNavigatorBulkBar from './BaseNavigatorBulkBar'
import BaseNavigatorContent from './BaseNavigatorContent'
import BaseNavigatorResizeHandle from './BaseNavigatorResizeHandle'

interface BaseNavigatorProps {
  bases: KnowledgeBaseListItem[]
  groups: Group[]
  isLoading: boolean
  width: number
  selectedBaseId: string
  onSelectBase: (baseId: string) => void
  onCreateGroup: (baseId: string) => void
  onCreateBase: (groupId?: string) => void
  onMoveBase: (baseId: string, groupId: string | null) => Promise<void> | void
  onMoveBases: (baseIds: string[], groupId: string | null) => Promise<void> | void
  onRenameBase: (base: Pick<KnowledgeBase, 'id' | 'name'>) => void
  onRenameGroup: (group: Pick<Group, 'id' | 'name'>) => void
  onDeleteGroup: (groupId: string) => Promise<void> | void
  onDeleteBase: (baseId: string) => Promise<void> | void
  onDeleteBases: (baseIds: string[]) => Promise<void> | void
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
}

const BaseNavigator = ({
  bases,
  groups,
  isLoading,
  width,
  selectedBaseId,
  onSelectBase,
  onCreateGroup,
  onCreateBase,
  onMoveBase,
  onMoveBases,
  onRenameBase,
  onRenameGroup,
  onDeleteGroup,
  onDeleteBase,
  onDeleteBases,
  onResizeStart
}: BaseNavigatorProps) => {
  const { t } = useTranslation()
  const [checkedBaseIds, setCheckedBaseIds] = useState<Set<string>>(() => new Set())

  const knowledgeBaseGroupSections = useMemo(() => buildKnowledgeBaseGroupSections(bases, groups, ''), [bases, groups])

  const groupById = useMemo(() => {
    return new Map(groups.map((group) => [group.id, group]))
  }, [groups])

  const getGroupLabel = useCallback(
    (groupId: string | null) => {
      if (groupId == null) {
        return t(DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY)
      }

      return groupById.get(groupId)?.name ?? groupId
    },
    [groupById, t]
  )

  useEffect(() => {
    const baseIds = new Set(bases.map((base) => base.id))
    setCheckedBaseIds((prev) => {
      const next = new Set([...prev].filter((baseId) => baseIds.has(baseId)))
      return next.size === prev.size ? prev : next
    })
  }, [bases])

  const handleToggleBaseChecked = useCallback((baseId: string, next: boolean) => {
    setCheckedBaseIds((prev) => {
      const updated = new Set(prev)
      if (next) {
        updated.add(baseId)
      } else {
        updated.delete(baseId)
      }
      return updated
    })
  }, [])

  const handleToggleAllChecked = useCallback(
    (next: boolean) => {
      setCheckedBaseIds(next ? new Set(bases.map((base) => base.id)) : new Set())
    },
    [bases]
  )

  const selectedBases = useMemo(() => bases.filter((base) => checkedBaseIds.has(base.id)), [bases, checkedBaseIds])
  const canMoveToUngrouped = selectedBases.some((base) => base.groupId !== null)
  // Hide groups that every selected base already belongs to — moving there would be a no-op.
  const moveTargetGroups = useMemo(() => {
    if (selectedBases.length === 0) return groups
    return groups.filter((group) => selectedBases.some((base) => base.groupId !== group.id))
  }, [groups, selectedBases])

  // A second click before this settles would resubmit the same selection.
  const bulkActionInFlightRef = useRef(false)

  const runBulkAction = useCallback(async (baseIds: string[], action: () => Promise<void> | void) => {
    if (bulkActionInFlightRef.current || baseIds.length === 0) return
    bulkActionInFlightRef.current = true
    try {
      await action()
      setCheckedBaseIds(new Set())
    } catch {
      return
    } finally {
      bulkActionInFlightRef.current = false
    }
  }, [])

  const handleBulkMove = useCallback(
    (groupId: string | null) => {
      const baseIds = selectedBases.map((base) => base.id)
      return runBulkAction(baseIds, () => onMoveBases(baseIds, groupId))
    },
    [onMoveBases, runBulkAction, selectedBases]
  )

  const handleBulkDelete = useCallback(() => {
    const baseIds = selectedBases.map((base) => base.id)
    return runBulkAction(baseIds, () => onDeleteBases(baseIds))
  }, [onDeleteBases, runBulkAction, selectedBases])

  return (
    <div data-ui="knowledge.navigation" style={{ width }} className="relative h-full min-h-0 shrink-0">
      {/* `p-1.5` and the padding-free rows below match the assistant and agent rails'
          `ResourceList.Frame`, so the three sidebars indent identically. */}
      <aside className="flex size-full min-h-0 flex-col border-r-[0.5px] border-border p-1.5">
        <div className="flex shrink-0 flex-col gap-2">
          {checkedBaseIds.size > 0 ? (
            <BaseNavigatorBulkBar
              selectedCount={checkedBaseIds.size}
              groups={moveTargetGroups}
              canMoveToUngrouped={canMoveToUngrouped}
              onMove={(groupId) => void handleBulkMove(groupId)}
              onDelete={handleBulkDelete}
            />
          ) : (
            // Same borderless header item the assistant and agent rails use, so the three
            // sidebars read as one family.
            <ResourceList.HeaderItem
              type="button"
              icon={<Plus />}
              label={t('knowledge.add.title')}
              aria-label={t('knowledge.add.title')}
              onClick={() => onCreateBase()}
            />
          )}
        </div>

        <BaseNavigatorContent
          isLoading={isLoading}
          sections={knowledgeBaseGroupSections}
          groups={groups}
          groupById={groupById}
          selectedBaseId={selectedBaseId}
          checkedBaseIds={checkedBaseIds}
          getGroupLabel={getGroupLabel}
          onSelectBase={onSelectBase}
          onToggleBaseChecked={handleToggleBaseChecked}
          onToggleAllChecked={handleToggleAllChecked}
          onMoveBase={onMoveBase}
          onRenameBase={onRenameBase}
          onRenameGroup={onRenameGroup}
          onCreateBaseInGroup={onCreateBase}
          onCreateGroup={onCreateGroup}
          onDeleteGroup={onDeleteGroup}
          onDeleteBase={onDeleteBase}
        />
      </aside>

      <BaseNavigatorResizeHandle onResizeStart={onResizeStart} />
    </div>
  )
}

export default BaseNavigator
