import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { cn } from '@cherrystudio/ui/lib/utils'

import KnowledgeBaseRow from './KnowledgeBaseRow'
import type { KnowledgeBaseRowProps } from './types'

interface SortableKnowledgeBaseRowProps extends KnowledgeBaseRowProps {
  disabled: boolean
  indicator?: 'before' | 'after'
}

const SortableKnowledgeBaseRow = ({ disabled, indicator, ...props }: SortableKnowledgeBaseRowProps) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: `base:${props.base.id}`,
    data: { type: 'base', base: props.base, groupId: props.base.groupId },
    disabled
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-knowledge-base-id={props.base.id}
      className={cn(
        'relative',
        isDragging && 'opacity-30',
        indicator === 'before' && 'before:absolute before:inset-x-2 before:top-0 before:h-0.5 before:bg-primary',
        indicator === 'after' && 'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-primary'
      )}>
      <KnowledgeBaseRow {...props} dragProps={{ ...attributes, ...listeners, ref: setActivatorNodeRef }} />
    </div>
  )
}

export default SortableKnowledgeBaseRow
