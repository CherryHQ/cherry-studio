import { CollisionPriority } from '@dnd-kit/abstract'
import { useSortable } from '@dnd-kit/react/sortable'

import { AccordionContent, AccordionItem, BUTTON_HANDLE_DRAG_SENSORS } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ROW_STEP_SORTABLE_PLUGINS } from '@renderer/utils/dragDrop'

import BaseNavigatorSectionTrigger from './BaseNavigatorSectionTrigger'
import KnowledgeGroupRow from './KnowledgeGroupRow'
import SortableKnowledgeBaseRow from './SortableKnowledgeBaseRow'
import type { BaseNavigatorGroupSectionProps, NavigatorDragData } from './types'
import { UNGROUPED_SECTION_VALUE } from './types'

const BaseNavigatorGroupSection = ({
  dragDisabled = true,
  index,
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

  const id = `group:${groupValue}`
  const data: NavigatorDragData = { type: 'group', groupId: section.groupId }
  const { ref, handleRef, isDragSource, isDropTarget } = useSortable({
    id,
    index,
    group: 'sections',
    type: 'group',
    // Groups reorder among themselves; the ungrouped section only takes bases.
    accept: section.groupId ? ['base', 'group'] : 'base',
    collisionPriority: CollisionPriority.Low,
    data,
    disabled: { draggable: dragDisabled || !group, droppable: dragDisabled },
    sensors: BUTTON_HANDLE_DRAG_SENSORS,
    plugins: ROW_STEP_SORTABLE_PLUGINS,
    transition: null
  })

  return (
    <AccordionItem
      ref={ref}
      value={groupValue}
      data-knowledge-group-id={groupValue}
      className={cn(
        'relative border-none',
        isDragSource && 'opacity-30',
        isDropTarget && !isDragSource && 'ring-1 ring-inset ring-primary'
      )}>
      {group ? (
        <KnowledgeGroupRow
          group={group}
          dragProps={{ ref: handleRef }}
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
          {section.items.map((base, baseIndex) => (
            <SortableKnowledgeBaseRow
              key={base.id}
              index={baseIndex}
              sectionValue={groupValue}
              disabled={dragDisabled}
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
      </AccordionContent>
    </AccordionItem>
  )
}

export default BaseNavigatorGroupSection
