import { Accordion, Scrollbar } from '@cherrystudio/ui'
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
    <Scrollbar className="min-h-0 flex-1 px-1.5 [scrollbar-gutter:auto]">
      {sections.length === 0 ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-muted-foreground/60 text-sm">
          {t('knowledge.empty')}
        </div>
      ) : (
        <Accordion
          type="multiple"
          defaultValue={sections.map(({ groupId }) => groupId ?? UNGROUPED_SECTION_VALUE)}
          className="space-y-1.5">
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
