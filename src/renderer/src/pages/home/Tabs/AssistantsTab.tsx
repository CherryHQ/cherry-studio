import { MenuOutlined, PlusOutlined, TagsFilled } from '@ant-design/icons'
import DragableList from '@renderer/components/DragableList'
import Scrollbar from '@renderer/components/Scrollbar'
import { useAgents } from '@renderer/hooks/useAgents'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useTags } from '@renderer/hooks/useTags'
import { Assistant } from '@renderer/types'
import { Divider, Tooltip } from 'antd'
import { FC, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AssistantItem from './AssistantItem'

interface AssistantsTabProps {
  activeAssistant: Assistant
  setActiveAssistant: (assistant: Assistant) => void
  onCreateAssistant: () => void
  onCreateDefaultAssistant: () => void
}
type SortType = '' | 'tags' | 'list'
const Assistants: FC<AssistantsTabProps> = ({
  activeAssistant,
  setActiveAssistant,
  onCreateAssistant,
  onCreateDefaultAssistant
}) => {
  const { assistants, removeAssistant, addAssistant, updateAssistants } = useAssistants()
  const [dragging, setDragging] = useState(false)
  const [sortBy, setSortBy] = useState<SortType>('list')
  const { addAgent } = useAgents()
  const { t } = useTranslation()
  const { getGroupedAssistants } = useTags()
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
    (sortType: SortType) => {
      setSortBy(sortType)
    },
    [setSortBy]
  )

  return (
    <Container className="assistants-tab" ref={containerRef}>
      <TopButtonGroup>
        <Tooltip title={t('assistants.list.showByList')}>
          <SwitchButton checked={sortBy === 'list'} onClick={() => handleSortByChange('list')}>
            <MenuOutlined />
          </SwitchButton>
        </Tooltip>
        <Tooltip title={t('assistants.list.showByTags')}>
          <SwitchButton checked={sortBy === 'tags'} onClick={() => handleSortByChange('tags')}>
            <TagsFilled />
          </SwitchButton>
        </Tooltip>
      </TopButtonGroup>
      {sortBy === 'tags' && (
        <div style={{ paddingBottom: dragging ? '34px' : 0 }}>
          {getGroupedAssistants.map((group) => (
            <div key={group.tag}>
              <GroupTitle>
                <GroupTitleName>{group.tag}</GroupTitleName>
                <Divider style={{ margin: '12px 0' }}></Divider>
              </GroupTitle>
              {group.assistants.map((assistant) => (
                <AssistantItem
                  key={assistant.id}
                  assistant={assistant}
                  isActive={assistant.id === activeAssistant.id}
                  onSwitch={setActiveAssistant}
                  onDelete={onDelete}
                  addAgent={addAgent}
                  addAssistant={addAssistant}
                  onCreateDefaultAssistant={onCreateDefaultAssistant}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      {sortBy === 'list' && (
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
              onSwitch={setActiveAssistant}
              onDelete={onDelete}
              addAgent={addAgent}
              addAssistant={addAssistant}
              onCreateDefaultAssistant={onCreateDefaultAssistant}
            />
          )}
        </DragableList>
      )}
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

const AssistantAddItem = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 7px 12px;
  position: relative;
  padding-right: 35px;
  font-family: Ubuntu;
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

const TopButtonGroup = styled.div`
  position: sticky;
  top: -10px;
  padding: 6px 0px;
  background-color: var(--color-background);
  z-index: 1;
  border-radius: 4px;
  color: var(--color-text-2);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
`

const SwitchButton = styled.button<{ checked: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  margin-right: 8px;
  border-radius: 4px;
  height: 24px;
  border: 1px solid var(--color-border);
  cursor: pointer;
  color: ${({ checked }) => (!checked ? 'var(--color-primary)' : 'var(--color-white)')};
  background-color: ${({ checked }) => (!checked ? 'var(--color-white)' : 'var(--color-primary)')};
`

const GroupTitle = styled.div`
  padding: 8px 0px;
  position: relative;
  color: var(--color-text-2);
  font-size: 12px;
  font-weight: 500;
`

const GroupTitleName = styled.div`
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
