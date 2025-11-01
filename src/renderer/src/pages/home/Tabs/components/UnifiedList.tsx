import { DraggableList } from '@renderer/components/DraggableList'
import type { Assistant, AssistantsSortType } from '@renderer/types'
import type { FC } from 'react'
import { useCallback } from 'react'

import type { UnifiedItem } from '../hooks/useUnifiedItems'
import AgentItem from './AgentItem'
import AssistantItem from './AssistantItem'

interface UnifiedListProps {
  items: UnifiedItem[]
  activeAssistantId: string
  activeAgentId: string | null
  sortBy: AssistantsSortType
  onReorder: (newList: UnifiedItem[]) => void
  onDragStart: () => void
  onDragEnd: () => void
  onAssistantSwitch: (assistant: Assistant) => void
  onAssistantDelete: (assistant: Assistant) => void
  onAgentDelete: (agentId: string) => void
  onAgentPress: (agentId: string) => void
  addPreset: (assistant: Assistant) => void
  copyAssistant: (assistant: Assistant) => void
  onCreateDefaultAssistant: () => void
  handleSortByChange: (sortType: AssistantsSortType) => void
  sortByPinyinAsc: () => void
  sortByPinyinDesc: () => void
}

export const UnifiedList: FC<UnifiedListProps> = (props) => {
  const {
    items,
    activeAssistantId,
    activeAgentId,
    sortBy,
    onReorder,
    onDragStart,
    onDragEnd,
    onAssistantSwitch,
    onAssistantDelete,
    onAgentDelete,
    onAgentPress,
    addPreset,
    copyAssistant,
    onCreateDefaultAssistant,
    handleSortByChange,
    sortByPinyinAsc,
    sortByPinyinDesc
  } = props

  const renderUnifiedItem = useCallback(
    (item: UnifiedItem) => {
      if (item.type === 'agent') {
        return (
          <AgentItem
            key={`agent-${item.data.id}`}
            agent={item.data}
            isActive={item.data.id === activeAgentId}
            onDelete={() => onAgentDelete(item.data.id)}
            onPress={() => onAgentPress(item.data.id)}
          />
        )
      } else {
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
      }
    },
    [
      activeAgentId,
      activeAssistantId,
      sortBy,
      onAssistantSwitch,
      onAssistantDelete,
      onAgentDelete,
      onAgentPress,
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
      itemKey={(item) => `${item.type}-${item.data.id}`}
      onUpdate={onReorder}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}>
      {renderUnifiedItem}
    </DraggableList>
  )
}
