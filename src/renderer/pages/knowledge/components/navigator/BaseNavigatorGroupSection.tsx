import { AccordionContent, AccordionItem } from '@cherrystudio/ui'

import BaseNavigatorSectionTrigger from './BaseNavigatorSectionTrigger'
import KnowledgeBaseRow from './KnowledgeBaseRow'
import KnowledgeGroupRow from './KnowledgeGroupRow'
import type { BaseNavigatorGroupSectionProps } from './types'
import { UNGROUPED_SECTION_VALUE } from './types'

const BaseNavigatorGroupSection = ({
  section,
  group,
  groupLabel,
  groups,
  selectedBaseId,
  onSelectBase,
  onMoveBase,
  onRenameBase,
  onRenameGroup,
  onCreateBaseInGroup,
  onDeleteGroup,
  onDeleteBase
}: BaseNavigatorGroupSectionProps) => {
  const groupValue = section.groupId ?? UNGROUPED_SECTION_VALUE

  return (
    <AccordionItem value={groupValue} className="border-none">
      {group ? (
        <KnowledgeGroupRow
          group={group}
          itemCount={section.items.length}
          onRenameGroup={onRenameGroup}
          onCreateBase={onCreateBaseInGroup}
          onDeleteGroup={onDeleteGroup}
        />
      ) : section.groupId !== null ? (
        <BaseNavigatorSectionTrigger label={groupLabel} itemCount={section.items.length} />
      ) : null}

      <AccordionContent className="pt-0 pb-0">
        <div className="space-y-px">
          {section.items.map((base) => (
            <KnowledgeBaseRow
              key={base.id}
              base={base}
              groups={groups}
              selected={base.id === selectedBaseId}
              onSelectBase={onSelectBase}
              onMoveBase={onMoveBase}
              onRenameBase={onRenameBase}
              onDeleteBase={onDeleteBase}
            />
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

export default BaseNavigatorGroupSection
