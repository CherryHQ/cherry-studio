import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { AccordionContent, AccordionItem } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

import BaseNavigatorSectionTrigger from './BaseNavigatorSectionTrigger'
import KnowledgeGroupRow from './KnowledgeGroupRow'
import SortableKnowledgeBaseRow from './SortableKnowledgeBaseRow'
import type { BaseNavigatorGroupSectionProps } from './types'
import { UNGROUPED_SECTION_VALUE } from './types'

const BaseNavigatorGroupSection = ({
  dragDisabled = true,
  indicator,
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
  onDeleteBase,
  onToggleSidebar,
  sidebarPinnedBaseIds
}: BaseNavigatorGroupSectionProps) => {
  const groupValue = section.groupId ?? UNGROUPED_SECTION_VALUE

  const { setNodeRef, attributes, listeners, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: `group:${groupValue}`,
    data: { type: 'group', groupId: section.groupId },
    disabled: { draggable: dragDisabled || !group, droppable: dragDisabled }
  })

  return (
    <AccordionItem
      ref={setNodeRef}
      value={groupValue}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-knowledge-group-id={groupValue}
      className={cn(
        'relative border-none',
        isDragging && 'opacity-30',
        indicator?.id === `group:${groupValue}` && 'ring-1 ring-inset ring-primary'
      )}>
      {group ? (
        <KnowledgeGroupRow
          group={group}
          dragProps={{ ...attributes, ...listeners, ref: setActivatorNodeRef }}
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
        <SortableContext items={section.items.map((base) => `base:${base.id}`)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1">
            {section.items.map((base) => (
              <SortableKnowledgeBaseRow
                key={base.id}
                disabled={dragDisabled}
                indicator={indicator?.id === `base:${base.id}` ? indicator.position : undefined}
                base={base}
                groups={groups}
                selected={base.id === selectedBaseId}
                onSelectBase={onSelectBase}
                onMoveBase={onMoveBase}
                onRenameBase={onRenameBase}
                onCreateGroup={onCreateGroup}
                onDeleteBase={onDeleteBase}
                onToggleSidebar={onToggleSidebar}
                sidebarPinned={sidebarPinnedBaseIds.has(base.id)}
              />
            ))}
          </div>
        </SortableContext>
      </AccordionContent>
    </AccordionItem>
  )
}

export default BaseNavigatorGroupSection
