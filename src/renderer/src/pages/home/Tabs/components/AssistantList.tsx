import { DraggableList } from '@renderer/components/DraggableList'
import type { Assistant, AssistantsSortType } from '@renderer/types'
import type { FC } from 'react'
import { useCallback } from 'react'

import type { AssistantListItem } from '../hooks/useAssistantListItems'
import AssistantItem from './AssistantItem'

interface AssistantListProps {
  items: AssistantListItem[]
  activeAssistantId: string
  sortBy: AssistantsSortType
  onReorder: (newList: AssistantListItem[]) => void
  onDragStart: () => void
  onDragEnd: () => void
  onAssistantSwitch: (assistant: Assistant) => void
  onAssistantDelete: (assistant: Assistant) => void
  addPreset: (assistant: Assistant) => void
  copyAssistant: (assistant: Assistant) => void
  onCreateDefaultAssistant: () => void
  handleSortByChange: (sortType: AssistantsSortType) => void
  sortByPinyinAsc: () => void
  sortByPinyinDesc: () => void
}

export const AssistantList: FC<AssistantListProps> = (props) => {
  const {
    items,
    activeAssistantId,
    sortBy,
    onReorder,
    onDragStart,
    onDragEnd,
    onAssistantSwitch,
    onAssistantDelete,
    addPreset,
    copyAssistant,
    onCreateDefaultAssistant,
    handleSortByChange,
    sortByPinyinAsc,
    sortByPinyinDesc
  } = props

  const renderAssistantItem = useCallback(
    (item: AssistantListItem) => {
      return (
        <AssistantItem
          key={`assistant-${item.data.id}`}
          assistant={item.data}
          isActive={item.data.id === activeAssistantId}
          sortBy={sortBy}
          onSwitch={onAssistantSwitch}
          onDelete={onAssistantDelete}
          addPreset={addPreset}
          copyAssistant={copyAssistant}
          onCreateDefaultAssistant={onCreateDefaultAssistant}
          handleSortByChange={handleSortByChange}
          sortByPinyinAsc={sortByPinyinAsc}
          sortByPinyinDesc={sortByPinyinDesc}
        />
      )
    },
    [
      activeAssistantId,
      sortBy,
      onAssistantSwitch,
      onAssistantDelete,
      addPreset,
      copyAssistant,
      onCreateDefaultAssistant,
      handleSortByChange,
      sortByPinyinAsc,
      sortByPinyinDesc
    ]
  )

  return (
    <DraggableList
      list={items}
      itemKey={(item) => `assistant-${item.data.id}`}
      onUpdate={onReorder}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}>
      {renderAssistantItem}
    </DraggableList>
  )
}
