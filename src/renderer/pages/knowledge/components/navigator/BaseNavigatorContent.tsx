import { Accordion, EmptyState, Scrollbar } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

import BaseNavigatorGroupSection from './BaseNavigatorGroupSection'
import type { BaseNavigatorContentProps } from './types'
import { UNGROUPED_SECTION_VALUE } from './types'

const BaseNavigatorContent = ({
  sections,
  groups,
  groupById,
  selectedBaseId,
  getGroupLabel,
  onSelectBase,
  onMoveBase,
  onRenameBase,
  onRenameGroup,
  onCreateBaseInGroup,
  onDeleteGroup,
  onDeleteBase
}: BaseNavigatorContentProps) => {
  const { t } = useTranslation()

  return (
    <Scrollbar className="min-h-0 flex-1 overflow-x-hidden px-3 pb-3">
      {sections.length === 0 ? (
        <EmptyState preset="no-knowledge" title={t('knowledge.empty')} compact className="h-full" />
      ) : (
        <Accordion
          type="multiple"
          defaultValue={sections.map(({ groupId }) => groupId ?? UNGROUPED_SECTION_VALUE)}
          className="space-y-3">
          {sections.map((section) => {
            const groupValue = section.groupId ?? UNGROUPED_SECTION_VALUE
            const group = section.groupId ? groupById.get(section.groupId) : undefined

            return (
              <BaseNavigatorGroupSection
                key={groupValue}
                section={section}
                group={group}
                groupLabel={group?.name ?? getGroupLabel(section.groupId)}
                groups={groups}
                selectedBaseId={selectedBaseId}
                onSelectBase={onSelectBase}
                onMoveBase={onMoveBase}
                onRenameBase={onRenameBase}
                onRenameGroup={onRenameGroup}
                onCreateBaseInGroup={onCreateBaseInGroup}
                onDeleteGroup={onDeleteGroup}
                onDeleteBase={onDeleteBase}
              />
            )
          })}
        </Accordion>
      )}
    </Scrollbar>
  )
}

export default BaseNavigatorContent
