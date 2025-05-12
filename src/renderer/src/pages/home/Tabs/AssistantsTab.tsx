import { AlignLeftOutlined, MenuOutlined, PlusOutlined } from '@ant-design/icons'
import DragableList from '@renderer/components/DragableList'
import Scrollbar from '@renderer/components/Scrollbar'
import { useAgents } from '@renderer/hooks/useAgents'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import { setAssistantTabDefaultMode } from '@renderer/store/settings'
import { Assistant } from '@renderer/types'
import { Tooltip } from 'antd'
import { FC, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AssistantItem from './AssistantItem'
import GroupedAssistants from './GroupedAssistants'

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
  const dispatch = useAppDispatch()
  const { assistantTabDefaultMode } = useSettings()
  const { assistants, removeAssistant, addAssistant, updateAssistants } = useAssistants()
  const [dragging, setDragging] = useState(false)
  const [groupMode, setGroupMode] = useState(assistantTabDefaultMode || 'assitants')
  const { addAgent } = useAgents()
  const { t } = useTranslation()
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

  // 防止反复渲染，只有助手变化的时候 才有必要重新渲染组助手
  const GroupTab = useMemo(() => {
    return (
      <GroupedAssistants
        assistants={assistants}
        activeAssistant={activeAssistant}
        onDelete={onDelete}
        setActiveAssistant={setActiveAssistant}
        addAgent={addAgent}
        addAssistant={addAssistant}
        onCreateDefaultAssistant={onCreateDefaultAssistant}
      />
    )
  }, [assistants, activeAssistant, onDelete, setActiveAssistant, addAgent, addAssistant, onCreateDefaultAssistant])

  return (
    <Container className="assistants-tab" ref={containerRef}>
      <ModeSwitch>
        <Tooltip title={t('assistants.title')}>
          <IconButton
            active={groupMode === 'assitants'}
            onClick={() => {
              dispatch(setAssistantTabDefaultMode('assitants'))
              setGroupMode('assitants')
            }}>
            <MenuOutlined style={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t(t('assistants.group.title'))}>
          <IconButton
            active={groupMode === 'groups'}
            onClick={() => {
              dispatch(setAssistantTabDefaultMode('groups'))
              setGroupMode('groups')
            }}>
            <AlignLeftOutlined style={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </ModeSwitch>

      {groupMode === 'groups' ? (
        GroupTab
      ) : (
        <>
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
          {!dragging && (
            <AssistantAddItem onClick={onCreateAssistant}>
              <AssistantName>
                <PlusOutlined style={{ color: 'var(--color-text-2)', marginRight: 4 }} />
                {t('chat.add.assistant.title')}
              </AssistantName>
            </AssistantAddItem>
          )}
        </>
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

const ModeSwitch = styled.div`
  margin-bottom: 10px;
  display: flex;
  justify-content: flex-start;
`

const IconButton = styled.div<{ active: boolean }>`
  border: 1px solid var(--color-border);
  cursor: pointer;
  padding: 4px;
  color: ${(props) => (props.active ? 'var(--color-primary)' : 'var(--color-text-2)')};
  background: ${(props) => (props.active ? 'unset' : 'var(--color-background-soft)')};
  &:first-child {
    border-radius: 4px 0 0 4px;
    border-right: none;
  }
  &:last-child {
    border-radius: 0 4px 4px 0;
  }
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

const AssistantName = styled.div`
  color: var(--color-text);
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
`

export default Assistants
