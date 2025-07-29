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
import VirtualList from 'rc-virtual-list'
import { FC } from 'react'

interface Props<T> {
  list: T[]
  style?: React.CSSProperties
  listStyle?: React.CSSProperties
  children: (item: T, index: number) => React.ReactNode
  onUpdate: (list: T[]) => void
  onDragStart?: OnDragStartResponder
  onDragEnd?: OnDragEndResponder
  droppableProps?: Partial<DroppableProps>
}

const DraggableList: FC<Props<any>> = ({
  children,
  list,
  style,
  listStyle,
  droppableProps,
  onDragStart,
  onUpdate,
  onDragEnd
}) => {
  const _onDragEnd = (result: DropResult, provided: ResponderProvided) => {
    onDragEnd?.(result, provided)
    if (result.destination) {
      const sourceIndex = result.source.index
      const destIndex = result.destination.index
      const reorderAgents = droppableReorder(list, sourceIndex, destIndex)
      onUpdate(reorderAgents)
    }
  }

  return (
    <DragDropContext onDragStart={onDragStart} onDragEnd={_onDragEnd}>
      <Droppable droppableId="droppable" {...droppableProps}>
        {(provided) => (
          <div {...provided.droppableProps} ref={provided.innerRef} style={style}>
            <VirtualList data={list} itemKey="id">
              {(item, index) => {
                const id = item.id || item
                return (
                  <Draggable key={`draggable_${id}_${index}`} draggableId={id} index={index}>
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
              }}
            </VirtualList>
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  )
}

export default DraggableList
