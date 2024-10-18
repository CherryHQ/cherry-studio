import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import DragableList from '@renderer/components/DragableList'
import { HStack } from '@renderer/components/Layout'
import { useAgents } from '@renderer/hooks/useAgents'
import { Agent } from '@renderer/types'
import { Button, Popconfirm, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AddAgentPopup from './AddAgentPopup'

const { Title } = Typography

interface Props {
  onEdit: (agent: Agent) => void
  onClick: (agent: Agent) => void
}

const MyAssistants: React.FC<Props> = ({ onClick, onEdit }) => {
  const { t } = useTranslation()
  const { agents, removeAgent, updateAgents } = useAgents()
  const [dragging, setDragging] = useState(false)

  return (
    <Container style={{ paddingBottom: dragging ? 30 : 0 }}>
      <Title level={5} style={{ marginLeft: 10 }}>
        {t('agents.my_agents')}
      </Title>
      {agents.length > 0 && (
        <DragableList
          list={agents}
          onUpdate={updateAgents}
          onDragStart={() => setDragging(true)}
          onDragEnd={() => setDragging(false)}>
          {(agent) => (
            <AgentItem onClick={() => onClick(agent)}>
              <AgentName>
                {agent.emoji} {agent.name}
              </AgentName>
              <HStack gap="10px" onClick={(e) => e.stopPropagation()}>
                <Popconfirm
                  title={t('agents.delete.popup.content')}
                  placement="bottom"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => removeAgent(agent)}>
                  <DeleteOutlined style={{ color: 'var(--color-error)' }} />
                </Popconfirm>
                <EditOutlined style={{ cursor: 'pointer' }} onClick={() => onEdit(agent)} />
              </HStack>
            </AgentItem>
          )}
        </DragableList>
      )}
      {!dragging && (
        <Button
          type="dashed"
          icon={<PlusOutlined />}
          onClick={() => AddAgentPopup.show()}
          style={{ borderRadius: 20, height: 34 }}>
          {t('agents.add.title')}
        </Button>
      )}
    </Container>
  )
}

const Container = styled.div`
  padding: 15px 10px;
  display: flex;
  flex-direction: column;
  width: var(--assistants-width);
  height: calc(100vh - var(--navbar-height));
  border-right: 0.5px solid var(--color-border);
  overflow-y: scroll;
`

const AgentItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 20px;
  user-select: none;
  background-color: var(--color-background-soft);
  margin-bottom: 8px;
  .anticon {
    font-size: 16px;
    color: var(--color-icon);
  }
  &:hover {
    background-color: var(--color-background-mute);
  }
`

const AgentName = styled.div`
  max-width: 200px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-right: 8px;
`

export default MyAssistants
