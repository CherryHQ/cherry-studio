import { DraggableList } from '@renderer/components/DraggableList'
import { Assistant, AssistantsSortType } from '@renderer/types'
import { FC, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { UnifiedItem } from '../hooks/useUnifiedItems'
import AgentItem from './AgentItem'
import AssistantItem from './AssistantItem'
import { TagGroup } from './TagGroup'

interface GroupedItems {
  tag: string
  items: UnifiedItem[]
}

interface UnifiedTagGroupsProps {
  groupedItems: GroupedItems[]
  activeAssistantId: string
  activeAgentId: string | null
  sortBy: AssistantsSortType
  collapsedTags: Record<string, boolean>
  onGroupReorder: (tag: string, newList: UnifiedItem[]) => void
  onDragStart: () => void
  onDragEnd: () => void
  onToggleTagCollapse: (tag: string) => void
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

export const UnifiedTagGroups: FC<UnifiedTagGroupsProps> = (props) => {
  const {
    groupedItems,
    activeAssistantId,
    activeAgentId,
    sortBy,
    collapsedTags,
    onGroupReorder,
    onDragStart,
    onDragEnd,
    onToggleTagCollapse,
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

  const { t } = useTranslation()

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
    <div>
      {groupedItems.map((group) => (
        <TagGroup
          key={group.tag}
          tag={group.tag}
          isCollapsed={collapsedTags[group.tag]}
          onToggle={onToggleTagCollapse}
          showTitle={group.tag !== t('assistants.tags.untagged')}>
          <DraggableList
            list={group.items}
            itemKey={(item) => `${item.type}-${item.data.id}`}
            onUpdate={(newList) => onGroupReorder(group.tag, newList)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}>
            {renderUnifiedItem}
          </DraggableList>
        </TagGroup>
      ))}
    </div>
  )
}
