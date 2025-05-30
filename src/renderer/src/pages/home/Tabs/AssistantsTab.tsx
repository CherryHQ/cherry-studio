import { PlusOutlined } from '@ant-design/icons'
import DragableList from '@renderer/components/DragableList'
import Scrollbar from '@renderer/components/Scrollbar'
import { useAgents } from '@renderer/hooks/useAgents'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useAssistantsTabSortType } from '@renderer/hooks/useStore'
import { useTags } from '@renderer/hooks/useTags'
import { Assistant, AssistantsSortType } from '@renderer/types'
import { Divider, Tooltip } from 'antd'
import { FC, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AssistantItem from './components/AssistantItem'

interface AssistantsTabProps {
  activeAssistant: Assistant
  setActiveAssistant: (assistant: Assistant) => void
  onCreateAssistant: () => void
  onCreateDefaultAssistant: () => void
}
const Assistants: FC<AssistantsTabProps> = ({
  activeAssistant,
  setActiveAssistant,
  onCreateAssistant,
  onCreateDefaultAssistant
}) => {
  const { assistants, removeAssistant, addAssistant, updateAssistants } = useAssistants()
  const [dragging, setDragging] = useState(false)
  const { addAgent } = useAgents()
  const { t } = useTranslation()
  const { getGroupedAssistants } = useTags()
  const { assistantsTabSortType = 'list', setAssistantsTabSortType } = useAssistantsTabSortType()
  const containerRef = useRef<HTMLDivElement>(null)

  const onDelete = useCallback(
    (assistant: Assistant) => {
      const remaining = assistants.filter((a) => a.id !== assistant.id)
      if (assistant.id === activeAssistant?.id) {
        const newActive = remaining[remaining.length - 1]
        newActive ? setActiveAssistant(newActive) : onCreateDefaultAssistant()
      }
      removeAssistant(assistant.id)
    },
    [activeAssistant, assistants, removeAssistant, setActiveAssistant, onCreateDefaultAssistant]
  )

  const handleSortByChange = useCallback(
    (sortType: AssistantsSortType) => {
      setAssistantsTabSortType(sortType)
    },
    [setAssistantsTabSortType]
  )

  if (assistantsTabSortType === 'tags') {
    return (
      <Container className="assistants-tab" ref={containerRef}>
        <div style={{ marginBottom: '8px' }}>
          {getGroupedAssistants.map((group) => (
            <TagsContainer key={group.tag}>
              <GroupTitle>
                <Tooltip title={group.tag}>
                  <GroupTitleName>{group.tag}</GroupTitleName>
                </Tooltip>
                <Divider style={{ margin: '12px 0' }}></Divider>
              </GroupTitle>
              {group.assistants.map((assistant) => (
                <AssistantItem
                  key={assistant.id}
                  assistant={assistant}
                  isActive={assistant.id === activeAssistant.id}
                  sortBy={assistantsTabSortType}
                  onSwitch={setActiveAssistant}
                  onDelete={onDelete}
                  addAgent={addAgent}
                  addAssistant={addAssistant}
                  onCreateDefaultAssistant={onCreateDefaultAssistant}
                  handleSortByChange={handleSortByChange}
                />
              ))}
            </TagsContainer>
          ))}
        </div>
        <AssistantAddItem onClick={onCreateAssistant}>
          <AssistantName>
            <PlusOutlined style={{ color: 'var(--color-text-2)', marginRight: 4 }} />
            {t('chat.add.assistant.title')}
          </AssistantName>
        </AssistantAddItem>
      </Container>
    )
  }

  return (
    <Container className="assistants-tab" ref={containerRef}>
      <DragableList
        list={assistants}
        onUpdate={updateAssistants}
        style={{ paddingBottom: dragging ? '34px' : 0 }}
        onDragStart={() => setDragging(true)}
        onDragEnd={() => setDragging(false)}>
        {(assistant) => (
          <AssistantItem
            key={assistant.id}
            assistant={assistant}
            isActive={assistant.id === activeAssistant.id}
            sortBy={assistantsTabSortType}
            onSwitch={setActiveAssistant}
            onDelete={onDelete}
            addAgent={addAgent}
            addAssistant={addAssistant}
            onCreateDefaultAssistant={onCreateDefaultAssistant}
            handleSortByChange={handleSortByChange}
          />
        )}
      </DragableList>
      {!dragging && (
        <AssistantAddItem onClick={onCreateAssistant}>
          <AssistantName>
            <PlusOutlined style={{ color: 'var(--color-text-2)', marginRight: 4 }} />
            {t('chat.add.assistant.title')}
          </AssistantName>
        </AssistantAddItem>
      )}
      <div style={{ minHeight: 10 }}></div>
    </Container>
  )
}

// 样式组件
const Container = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  padding: 10px;
`

const TagsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const AssistantAddItem = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 7px 12px;
  position: relative;
  padding-right: 35px;
  border-radius: var(--list-item-border-radius);
  border: 0.5px solid transparent;
  cursor: pointer;

  &:hover {
    background-color: var(--color-background-soft);
  }

  &.active {
    background-color: var(--color-background-soft);
    border: 0.5px solid var(--color-border);
  }
`

const GroupTitle = styled.div`
  padding: 8px 0px;
  position: relative;
  color: var(--color-text-2);
  font-size: 12px;
  font-weight: 500;
  margin-bottom: -8px;
`

const GroupTitleName = styled.div`
  max-width: 50%;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  background-color: var(--color-background);
  box-sizing: border-box;
  padding: 0 4px;
  color: var(--color-text);
  position: absolute;
  transform: translateY(2px);
  font-size: 13px;
`

const AssistantName = styled.div`
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
`

export default Assistants
