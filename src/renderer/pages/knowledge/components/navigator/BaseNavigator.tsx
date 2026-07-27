import { Button, PageHeader } from '@cherrystudio/ui'
import {
  buildKnowledgeBaseGroupSections,
  DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY
} from '@renderer/pages/knowledge/utils/group'
import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'
import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { Plus } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BaseNavigatorContent from './BaseNavigatorContent'
import BaseNavigatorResizeHandle from './BaseNavigatorResizeHandle'
import BaseNavigatorSearch from './BaseNavigatorSearch'

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
        return t(DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY)
      }

      return groupById.get(groupId)?.name ?? groupId
    },
    [groupById, t]
  )

  return (
    <div style={{ width }} className="relative h-full min-h-0 shrink-0">
      <aside className="flex size-full min-h-0 flex-col border-border border-r-[0.5px]">
        <PageHeader title={t('knowledge.title')} />
        <div className="flex shrink-0 flex-col gap-2 px-2.5 pb-2">
          <Button
            type="button"
            variant="outline"
            className="h-8 w-full justify-start rounded-[10px]"
            onClick={() => onCreateBase()}>
            <Plus className="size-3.5" />
            {t('knowledge.add.title')}
          </Button>
          <BaseNavigatorSearch value={searchValue} onValueChange={setSearchValue} />
        </div>

        <BaseNavigatorContent
          isLoading={isLoading}
          hasBases={bases.length > 0}
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
