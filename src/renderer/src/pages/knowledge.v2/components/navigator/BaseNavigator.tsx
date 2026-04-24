import { buildKnowledgeBaseGroupSections } from '@renderer/pages/knowledge.v2/utils'
import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BaseNavigatorContent from './BaseNavigatorContent'
import BaseNavigatorFooter from './BaseNavigatorFooter'
import BaseNavigatorHeader from './BaseNavigatorHeader'
import BaseNavigatorResizeHandle from './BaseNavigatorResizeHandle'
import BaseNavigatorSearch from './BaseNavigatorSearch'

interface BaseNavigatorProps {
  bases: KnowledgeBase[]
  groups: Group[]
  width: number
  selectedBaseId: string
  onSelectBase: (baseId: string) => void
  onCreateGroup: () => void
  onCreateBase: (groupId?: string) => void
  onMoveBase: (baseId: string, groupId: string) => Promise<void> | void
  onRenameBase: (base: Pick<KnowledgeBase, 'id' | 'name'>) => void
  onRenameGroup: (group: Pick<Group, 'id' | 'name'>) => void
  onDeleteGroup: (groupId: string) => Promise<void> | void
  onDeleteBase: (baseId: string) => Promise<void> | void
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
}

const BaseNavigator = ({
  bases,
  groups,
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
  const [searchValue, setSearchValue] = useState('')

  const knowledgeBaseGroupSections = useMemo(
    () => buildKnowledgeBaseGroupSections(bases, groups, searchValue),
    [bases, groups, searchValue]
  )

  const groupById = useMemo(() => {
    return new Map(groups.map((group) => [group.id, group]))
  }, [groups])

  const getGroupLabel = useCallback(
    (groupId: string | null) => {
      if (groupId == null) {
        return t('knowledge_v2.groups.ungrouped')
      }

      return groupById.get(groupId)?.name ?? groupId
    },
    [groupById, t]
  )

  return (
    <div style={{ width }} className="relative h-full min-h-0 shrink-0">
      <aside className="flex size-full min-h-0 flex-col border-border/20 border-r bg-muted/[0.15]">
        <div className="border-border/20 border-b">
          <BaseNavigatorHeader baseCount={bases.length} onCreateGroup={onCreateGroup} onCreateBase={onCreateBase} />
          <BaseNavigatorSearch value={searchValue} onValueChange={setSearchValue} />
        </div>

        <BaseNavigatorContent
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
          onDeleteGroup={onDeleteGroup}
          onDeleteBase={onDeleteBase}
        />

        <BaseNavigatorFooter onCreateBase={onCreateBase} />
      </aside>

      <BaseNavigatorResizeHandle onResizeStart={onResizeStart} />
    </div>
  )
}

export default BaseNavigator
