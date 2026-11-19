import { CollisionPriority } from '@dnd-kit/abstract'
import { useDragDropManager } from '@dnd-kit/react'
import { useComputed } from '@dnd-kit/react/hooks'
import { useSortable } from '@dnd-kit/react/sortable'

import { BUTTON_HANDLE_DRAG_SENSORS } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { getInsertionSide, ROW_STEP_SORTABLE_PLUGINS } from '@renderer/utils/dragDrop'

import KnowledgeBaseRow from './KnowledgeBaseRow'
import type { KnowledgeBaseRowProps, NavigatorDragData } from './types'

interface SortableKnowledgeBaseRowProps extends KnowledgeBaseRowProps {
  disabled: boolean
  index: number
  sectionValue: string
}

const SortableKnowledgeBaseRow = ({ disabled, index, sectionValue, ...props }: SortableKnowledgeBaseRowProps) => {
  const id = `base:${props.base.id}`
  const data: NavigatorDragData = { type: 'base', base: props.base, groupId: props.base.groupId }
  // A base row wins over the group section that contains it.
  const { ref, handleRef, isDragSource } = useSortable({
    id,
    index,
    group: sectionValue,
    type: 'base',
    accept: 'base',
    collisionPriority: CollisionPriority.High,
    data,
    disabled,
    sensors: BUTTON_HANDLE_DRAG_SENSORS,
    plugins: ROW_STEP_SORTABLE_PLUGINS,
    transition: null
  })
  const manager = useDragDropManager()
  // Only the target row reads the moving shape, so moves re-render one row.
  const dropSide = useComputed(() => {
    const operation = manager?.dragOperation
    return operation?.target?.id === id ? getInsertionSide(operation) : null
  }, [manager, id]).value

  return (
    <div
      ref={ref}
      data-knowledge-base-id={props.base.id}
      className={cn(
        'relative',
        isDragSource && 'opacity-30',
        dropSide === 'before' && 'before:absolute before:inset-x-2 before:top-0 before:h-0.5 before:bg-primary',
        dropSide === 'after' && 'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-primary'
      )}>
      <KnowledgeBaseRow {...props} dragProps={{ ref: handleRef }} />
    </div>
  )
}

export default SortableKnowledgeBaseRow
