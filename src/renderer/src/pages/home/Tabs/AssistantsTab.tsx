import Scrollbar from '@renderer/components/Scrollbar'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useAssistantPresets } from '@renderer/hooks/useAssistantPresets'
import { useAssistantsTabSortType } from '@renderer/hooks/useStore'
import { useTags } from '@renderer/hooks/useTags'
import type { Assistant, AssistantsSortType } from '@renderer/types'
import type { FC } from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AssistantAddButton from './components/AssistantAddButton'
import { AssistantList } from './components/AssistantList'
import { AssistantTagGroups } from './components/AssistantTagGroups'
import { useAssistantListGrouping } from './hooks/useAssistantListGrouping'
import { useAssistantListItems } from './hooks/useAssistantListItems'
import { useAssistantListSorting } from './hooks/useAssistantListSorting'

interface AssistantsTabProps {
  activeAssistant: Assistant
  setActiveAssistant: (assistant: Assistant) => void
  onCreateAssistant: () => void
  onCreateDefaultAssistant: () => void
}

const AssistantsTab: FC<AssistantsTabProps> = (props) => {
  const { activeAssistant, setActiveAssistant, onCreateAssistant, onCreateDefaultAssistant } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  // Assistant related hooks
  const { assistants, removeAssistant, copyAssistant, updateAssistants } = useAssistants()
  const { addAssistantPreset } = useAssistantPresets()
  const { collapsedTags, toggleTagCollapse } = useTags()
  const { assistantsTabSortType = 'list', setAssistantsTabSortType } = useAssistantsTabSortType()
  const [dragging, setDragging] = useState(false)

  // Assistant list items management
  const { assistantItems, handleAssistantListReorder } = useAssistantListItems({
    assistants,
    updateAssistants
  })

  // Sorting
  const { sortByPinyinAsc, sortByPinyinDesc } = useAssistantListSorting({
    assistantItems,
    updateAssistants
  })

  // Grouping
  const { groupedAssistantItems, handleAssistantGroupReorder } = useAssistantListGrouping({
    assistantItems,
    assistants,
    updateAssistants
  })

  const onDeleteAssistant = useCallback(
    (assistant: Assistant) => {
      const remaining = assistants.filter((a) => a.id !== assistant.id)
      if (remaining.length === 0) {
        window.toast.error(t('assistants.delete.error.remain_one'))
        return
      }

      if (assistant.id === activeAssistant?.id) {
        const newActive = remaining[remaining.length - 1]
        setActiveAssistant(newActive)
      }
      removeAssistant(assistant.id)
    },
    [assistants, activeAssistant?.id, removeAssistant, t, setActiveAssistant]
  )

  const handleSortByChange = useCallback(
    (sortType: AssistantsSortType) => {
      setAssistantsTabSortType(sortType)
    },
    [setAssistantsTabSortType]
  )

  return (
    <Container className="assistants-tab" ref={containerRef}>
      <AssistantAddButton onCreateAssistant={onCreateAssistant} />

      {assistantsTabSortType === 'tags' ? (
        <AssistantTagGroups
          groupedItems={groupedAssistantItems}
          activeAssistantId={activeAssistant.id}
          sortBy={assistantsTabSortType}
          collapsedTags={collapsedTags}
          onGroupReorder={handleAssistantGroupReorder}
          onDragStart={() => setDragging(true)}
          onDragEnd={() => setDragging(false)}
          onToggleTagCollapse={toggleTagCollapse}
          onAssistantSwitch={setActiveAssistant}
          onAssistantDelete={onDeleteAssistant}
          addPreset={addAssistantPreset}
          copyAssistant={copyAssistant}
          onCreateDefaultAssistant={onCreateDefaultAssistant}
          handleSortByChange={handleSortByChange}
          sortByPinyinAsc={sortByPinyinAsc}
          sortByPinyinDesc={sortByPinyinDesc}
        />
      ) : (
        <AssistantList
          items={assistantItems}
          activeAssistantId={activeAssistant.id}
          sortBy={assistantsTabSortType}
          onReorder={handleAssistantListReorder}
          onDragStart={() => setDragging(true)}
          onDragEnd={() => setDragging(false)}
          onAssistantSwitch={setActiveAssistant}
          onAssistantDelete={onDeleteAssistant}
          addPreset={addAssistantPreset}
          copyAssistant={copyAssistant}
          onCreateDefaultAssistant={onCreateDefaultAssistant}
          handleSortByChange={handleSortByChange}
          sortByPinyinAsc={sortByPinyinAsc}
          sortByPinyinDesc={sortByPinyinDesc}
        />
      )}

      {!dragging && <div style={{ minHeight: 10 }}></div>}
    </Container>
  )
}

const Container = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  padding: 12px 10px;
`

export default AssistantsTab
