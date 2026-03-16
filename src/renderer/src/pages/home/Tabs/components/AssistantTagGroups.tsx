import { DraggableList } from '@renderer/components/DraggableList'
import type { Assistant, AssistantsSortType } from '@renderer/types'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import AssistantItem from './AssistantItem'
import { TagGroup } from './TagGroup'

interface GroupedItems {
  tag: string
  items: Assistant[]
}

interface AssistantTagGroupsProps {
  groupedItems: GroupedItems[]
  activeAssistantId: string
  sortBy: AssistantsSortType
  collapsedTags: Record<string, boolean>
  onGroupReorder: (tag: string, newList: Assistant[]) => void
  onDragStart: () => void
  onDragEnd: () => void
  onToggleTagCollapse: (tag: string) => void
  onAssistantSwitch: (assistant: Assistant) => void
  onAssistantDelete: (assistant: Assistant) => void
  addPreset: (assistant: Assistant) => void
  copyAssistant: (assistant: Assistant) => void
  onCreateDefaultAssistant: () => void
  handleSortByChange: (sortType: AssistantsSortType) => void
  sortByPinyinAsc: () => void
  sortByPinyinDesc: () => void
}

export const AssistantTagGroups: FC<AssistantTagGroupsProps> = (props) => {
  const {
    groupedItems,
    activeAssistantId,
    sortBy,
    collapsedTags,
    onGroupReorder,
    onDragStart,
    onDragEnd,
    onToggleTagCollapse,
    onAssistantSwitch,
    onAssistantDelete,
    addPreset,
    copyAssistant,
    onCreateDefaultAssistant,
    handleSortByChange,
    sortByPinyinAsc,
    sortByPinyinDesc
  } = props

  const { t } = useTranslation()

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
            itemKey={(assistant) => `assistant-${assistant.id}`}
            onUpdate={(newList) => onGroupReorder(group.tag, newList)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}>
            {renderAssistantItem}
          </DraggableList>
        </TagGroup>
      ))}
    </div>
  )
}
