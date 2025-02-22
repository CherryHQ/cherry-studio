import { useCallback, useState, FC } from "react"
import { useTranslation } from "react-i18next"
import { PlusOutlined } from '@ant-design/icons'
import DragableList from "@renderer/components/DragableList"
import Scrollbar from "@renderer/components/Scrollbar"
import { useAgents } from "@renderer/hooks/useAgents"
import { useAssistants } from "@renderer/hooks/useAssistant"
import { Assistant } from "@renderer/types"
import styled from "styled-components"
import AssistantItemComponent from "@renderer/pages/home/Tabs/AssistantItemComponent"

// 类型定义
interface AssistantsProps {
  activeAssistant: Assistant
  setActiveAssistant: (assistant: Assistant) => void
  onCreateAssistant: () => void
  onCreateDefaultAssistant: () => void
}

// 样式组件（只定义一次）
const Container = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  padding-top: 11px;
  user-select: none;
`

const AssistantItem = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 7px 12px;
  position: relative;
  margin: 0 10px;
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

const Assistants: FC<AssistantsProps> = ({
  activeAssistant,
  setActiveAssistant,
  onCreateAssistant,
  onCreateDefaultAssistant
}) => {
  const { assistants, removeAssistant, addAssistant, updateAssistants } = useAssistants()
  const [dragging, setDragging] = useState(false)
  const { addAgent } = useAgents()
  const { t } = useTranslation()

  const onDelete = useCallback(
    (assistant: Assistant) => {
      const remaining = assistants.filter(a => a.id !== assistant.id)
      const newActive = remaining[remaining.length - 1]
      newActive ? setActiveAssistant(newActive) : onCreateDefaultAssistant()
      removeAssistant(assistant.id)
    },
    [assistants, removeAssistant, setActiveAssistant, onCreateDefaultAssistant]
  )

  return (
    <Container className="assistants-tab">
      <DragableList
        list={assistants}
        onUpdate={updateAssistants}
        style={{ paddingBottom: dragging ? '34px' : 0 }}
        onDragStart={() => setDragging(true)}
        onDragEnd={() => setDragging(false)}
      >
        {(assistant) => (
          <AssistantItemComponent
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
        <AssistantItem onClick={onCreateAssistant}>
          <AssistantName>
            <PlusOutlined style={{ color: 'var(--color-text-2)', marginRight: 4 }} />
            {t('chat.add.assistant.title')}
          </AssistantName>
        </AssistantItem>
      )}
      <div style={{ minHeight: 10 }}></div>
    </Container>
  )
}

export default Assistants
