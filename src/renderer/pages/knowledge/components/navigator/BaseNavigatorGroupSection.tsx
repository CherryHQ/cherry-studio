import { AccordionContent, AccordionItem } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useDroppable } from '@dnd-kit/core'

import BaseNavigatorSectionTrigger from './BaseNavigatorSectionTrigger'
import KnowledgeBaseRow from './KnowledgeBaseRow'
import KnowledgeGroupRow from './KnowledgeGroupRow'
import type { BaseNavigatorGroupSectionProps, KnowledgeGroupDropData } from './types'
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
  onCreateGroup,
  onDeleteGroup,
  onDeleteBase
}: BaseNavigatorGroupSectionProps) => {
  const groupValue = section.groupId ?? UNGROUPED_SECTION_VALUE
  const { isOver, setNodeRef } = useDroppable({
    id: section.groupId === null ? 'knowledge-group:ungrouped' : `knowledge-group:id:${section.groupId}`,
    data: {
      type: 'knowledge-group',
      groupId: section.groupId
    } satisfies KnowledgeGroupDropData,
    disabled: section.groupId !== null && !group
  })

  return (
    <AccordionItem
      ref={setNodeRef}
      value={groupValue}
      className={cn('rounded-[10px] border-none transition-colors', isOver && 'bg-accent ring-1 ring-ring/50')}>
      {group ? (
        <KnowledgeGroupRow
          group={group}
          onRenameGroup={onRenameGroup}
          onCreateBase={onCreateBaseInGroup}
          onDeleteGroup={onDeleteGroup}
        />
      ) : (
        <BaseNavigatorSectionTrigger label={groupLabel} />
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
              onCreateGroup={onCreateGroup}
              onDeleteBase={onDeleteBase}
            />
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

export default BaseNavigatorGroupSection
