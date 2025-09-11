import {
  DragDropContext,
  Draggable,
  Droppable,
  DroppableProps,
  DropResult,
  OnDragEndResponder,
  OnDragStartResponder,
  ResponderProvided
} from '@hello-pangea/dnd'
import { droppableReorder } from '@renderer/utils'
import { HTMLAttributes, Key, useCallback } from 'react'

interface Props<T> {
  list: T[]
  style?: React.CSSProperties
  listStyle?: React.CSSProperties
  listProps?: HTMLAttributes<HTMLDivElement>
  children: (item: T, index: number) => React.ReactNode
  itemKey?: keyof T | ((item: T) => Key)
  onUpdate: (list: T[]) => void
  onDragStart?: OnDragStartResponder
  onDragEnd?: OnDragEndResponder
  droppableProps?: Partial<DroppableProps>
}

function DraggableList<T>({
  children,
  list,
  style,
  listStyle,
  listProps,
  itemKey,
  droppableProps,
  onDragStart,
  onUpdate,
  onDragEnd
}: Props<T>) {
  const _onDragEnd = (result: DropResult, provided: ResponderProvided) => {
    onDragEnd?.(result, provided)
    if (result.destination) {
      const sourceIndex = result.source.index
      const destIndex = result.destination.index
      if (sourceIndex !== destIndex) {
        const reorderAgents = droppableReorder(list, sourceIndex, destIndex)
        onUpdate(reorderAgents)
      }
    }
  }

  const getId = useCallback(
    (item: T) => {
      if (typeof itemKey === 'function') return itemKey(item)
      if (itemKey) return item[itemKey] as Key
      if (typeof item === 'string') return item as Key
      if (item && typeof item === 'object' && 'id' in item) return item.id as Key
      return undefined
    },
    [itemKey]
  )

  return (
    <DragDropContext onDragStart={onDragStart} onDragEnd={_onDragEnd}>
      <Droppable droppableId="droppable" {...droppableProps}>
        {(provided) => (
          <div {...provided.droppableProps} ref={provided.innerRef} style={style}>
            <div {...listProps} className="draggable-list-container">
              {list.map((item, index) => {
                const draggableId = String(getId(item) ?? index)
                return (
                  <Draggable key={`draggable_${draggableId}`} draggableId={draggableId} index={index}>
                    {(provided) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                        style={{
                          ...listStyle,
                          ...provided.draggableProps.style,
                          marginBottom: 8
                        }}>
                        {children(item, index)}
                      </div>
                    )}
                  </Draggable>
                )
              })}
            </div>
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  )
}

export default DraggableList
