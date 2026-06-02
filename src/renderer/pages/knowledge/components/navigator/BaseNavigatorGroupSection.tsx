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
      ) : (
        <BaseNavigatorSectionTrigger label={groupLabel} itemCount={section.items.length} />
      )}

      <AccordionContent
        className="pt-1.5 pb-0"
        contentClassName="motion-safe:data-[state=open]:[animation-duration:180ms] motion-safe:data-[state=closed]:[animation-duration:120ms] motion-safe:[animation-timing-function:cubic-bezier(0.25,1,0.5,1)] motion-safe:data-[state=open]:[&>div]:animate-in motion-safe:data-[state=open]:[&>div]:fade-in-0 motion-safe:data-[state=open]:[&>div]:slide-in-from-top-1 motion-safe:data-[state=open]:[&>div]:delay-[16ms] motion-safe:data-[state=open]:[&>div]:duration-[120ms] motion-safe:data-[state=open]:[&>div]:ease-[cubic-bezier(0.25,1,0.5,1)] motion-safe:data-[state=closed]:[&>div]:animate-out motion-safe:data-[state=closed]:[&>div]:fade-out-0 motion-safe:data-[state=closed]:[&>div]:slide-out-to-top-1 motion-safe:data-[state=closed]:[&>div]:delay-0 motion-safe:data-[state=closed]:[&>div]:duration-[90ms] motion-safe:data-[state=closed]:[&>div]:ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:animate-none motion-reduce:[&>div]:animate-none">
        <div className="space-y-1">
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
