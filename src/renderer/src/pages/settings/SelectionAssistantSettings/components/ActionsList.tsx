import type { DroppableProvided } from '@hello-pangea/dnd'
import { Draggable, Droppable } from '@hello-pangea/dnd'
import type { ActionItem as ActionItemType } from '@renderer/types/selectionTypes'
import { memo } from 'react'
import styled from 'styled-components'

import ActionsListItemComponent from './ActionsListItem'

interface ActionListProps {
  droppableId: 'enabled' | 'disabled'
  items: ActionItemType[]
  isLastEnabledItem: boolean
  onEdit: (item: ActionItemType) => void
  onDelete: (id: string) => void
  getSearchEngineInfo: (engine: string) => { icon: any; name: string } | null
}

const ActionsList = memo(
  ({ droppableId, items, isLastEnabledItem, onEdit, onDelete, getSearchEngineInfo }: ActionListProps) => {
    return (
      <Droppable droppableId={droppableId}>
        {(provided: DroppableProvided) => (
          <List ref={provided.innerRef} {...provided.droppableProps}>
            <ActionsListContent>
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
            </ActionsListContent>
          </List>
        )}
      </Droppable>
    )
  }
)

const List = styled.div`
  background: var(--color-bg-1);
  border-radius: 4px;
  margin-bottom: 16px;
  padding-bottom: 1px;
`

const ActionsListContent = styled.div`
  padding: 10px;
`

export default ActionsList
