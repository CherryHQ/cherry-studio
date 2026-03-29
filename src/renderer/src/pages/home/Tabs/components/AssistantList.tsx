import { DraggableList } from '@renderer/components/DraggableList'
import type { Assistant } from '@renderer/types'
import type { AssistantTabSortType } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'
import { useCallback } from 'react'

import AssistantItem from './AssistantItem'

interface AssistantListProps {
  items: Assistant[]
  activeAssistantId: string
  sortBy: AssistantTabSortType
  onReorder: (newList: Assistant[]) => void
  onDragStart: () => void
  onDragEnd: () => void
  onAssistantSwitch: (assistant: Assistant) => void
  onAssistantDelete: (assistant: Assistant) => void
  addPreset: (assistant: Assistant) => void
  copyAssistant: (assistant: Assistant) => void
  onCreateDefaultAssistant: () => void
  handleSortByChange: (sortType: AssistantTabSortType) => void
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
    (assistant: Assistant) => {
      return (
        <AssistantItem
          key={`assistant-${assistant.id}`}
          assistant={assistant}
          isActive={assistant.id === activeAssistantId}
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
      itemKey={(assistant) => `assistant-${assistant.id}`}
      onUpdate={onReorder}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}>
      {renderAssistantItem}
    </DraggableList>
  )
}
