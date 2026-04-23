import type { DroppableProvided } from '@hello-pangea/dnd'
import { Draggable, Droppable } from '@hello-pangea/dnd'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { memo } from 'react'

import ActionsListItemComponent from './ActionsListItem'

interface ActionListProps {
  droppableId: 'enabled' | 'disabled'
  items: SelectionActionItem[]
  isLastEnabledItem: boolean
  onEdit: (item: SelectionActionItem) => void
  onDelete: (id: string) => void
  getSearchEngineInfo: (engine: string) => { icon: any; name: string } | null
}

const ActionsList = memo(
  ({ droppableId, items, isLastEnabledItem, onEdit, onDelete, getSearchEngineInfo }: ActionListProps) => {
    return (
      <Droppable droppableId={droppableId}>
        {(provided: DroppableProvided) => (
          <div ref={provided.innerRef} className="mb-4 rounded pb-px" {...provided.droppableProps}>
            <div className="p-2.5">
              {items.map((item, index) => (
                <Draggable key={item.id} draggableId={item.id} index={index}>
                  {(provided) => (
                    <ActionsListItemComponent
                      item={item}
                      provided={provided}
                      listType={droppableId}
                      isLastEnabledItem={isLastEnabledItem}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      getSearchEngineInfo={getSearchEngineInfo}
                    />
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          </div>
        )}
      </Droppable>
    )
  }
)

export default ActionsList
