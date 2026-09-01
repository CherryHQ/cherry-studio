import { Plus } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { ResourceList } from '@renderer/components/chat/resourceList/base'
import {
  buildKnowledgeBaseGroupSections,
  DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY
} from '@renderer/pages/knowledge/utils/group'
import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'
import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

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
  onRenameBase: (base: Pick<KnowledgeBase, 'id' | 'name'>) => void
  onRenameGroup: (group: Pick<Group, 'id' | 'name'>) => void
  onDeleteGroup: (groupId: string) => Promise<void> | void
  onDeleteBase: (baseId: string) => Promise<void> | void
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
  onRenameBase,
  onRenameGroup,
  onDeleteGroup,
  onDeleteBase,
  onResizeStart
}: BaseNavigatorProps) => {
  const { t } = useTranslation()

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

  return (
    <div data-ui="knowledge.navigation" style={{ width }} className="relative h-full min-h-0 shrink-0">
      {/* `p-1.5` and the padding-free rows below match the assistant and agent rails'
          `ResourceList.Frame`, so the three sidebars indent identically. */}
      <aside className="flex size-full min-h-0 flex-col border-r-[0.5px] border-border p-1.5">
        <div className="flex shrink-0 flex-col gap-2">
          {/* Same borderless header item the assistant and agent rails use, so the three
              sidebars read as one family. */}
          <ResourceList.HeaderItem
            type="button"
            icon={<Plus />}
            label={t('knowledge.add.title')}
            aria-label={t('knowledge.add.title')}
            onClick={() => onCreateBase()}
          />
        </div>

        <BaseNavigatorContent
          isLoading={isLoading}
          sections={knowledgeBaseGroupSections}
          groups={groups}
          groupById={groupById}
          selectedBaseId={selectedBaseId}
          getGroupLabel={getGroupLabel}
          onSelectBase={onSelectBase}
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
