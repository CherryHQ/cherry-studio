import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import AssistantSettingsPopup from '@renderer/components/AssistantSettings'
import DragableList from '@renderer/components/DragableList'
import { useAgents } from '@renderer/hooks/useAgents'
import { createAssistantFromAgent } from '@renderer/services/AssistantService'
import { Agent } from '@renderer/types'
import { Button, Col, Typography } from 'antd'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AddAgentPopup from './components/AddAgentPopup'
import AgentCard from './components/AgentCard'

interface Props {
  onClick?: (agent: Agent) => void
  cardStyle?: 'new' | 'old'
}

const Agents: React.FC<Props> = ({ onClick, cardStyle = 'old' }) => {
  const { t } = useTranslation()
  const { agents, removeAgent, updateAgents } = useAgents()
  const [dragging, setDragging] = useState(false)

  const handleDelete = useCallback(
    (agent: Agent) => {
      window.modal.confirm({
        centered: true,
        content: t('agents.delete.popup.content'),
        onOk: () => removeAgent(agent.id)
      })
    },
    [removeAgent, t]
  )

  if (cardStyle === 'new') {
    return (
      <>
        {agents.map((agent) => {
          const dropdownMenuItems = [
            {
              key: 'edit',
              label: t('agents.edit.title'),
              icon: <EditOutlined />,
              onClick: () => AssistantSettingsPopup.show({ assistant: agent })
            },
            {
              key: 'create',
              label: t('agents.add.button'),
              icon: <PlusOutlined />,
              onClick: () => createAssistantFromAgent(agent)
            },
            {
              key: 'delete',
              label: t('common.delete'),
              icon: <DeleteOutlined />,
              danger: true,
              onClick: () => handleDelete(agent)
            }
          ]

          const contextMenuItems = [
            {
              label: t('agents.edit.title'),
              onClick: () => AssistantSettingsPopup.show({ assistant: agent })
            },
            {
              label: t('agents.add.button'),
              onClick: () => createAssistantFromAgent(agent)
            },
            {
              label: t('common.delete'),
              onClick: () => handleDelete(agent)
            }
          ]

          return (
            <Col span={8} key={agent.id}>
              <AgentCard
                agent={agent}
                onClick={() => onClick?.(agent)}
                contextMenu={contextMenuItems}
                menuItems={dropdownMenuItems}
              />
            </Col>
          )
        })}
      </>
    )
  }

  return (
    <Container>
      <div style={{ paddingBottom: dragging ? 30 : 0 }}>
        <Typography.Title level={5} style={{ marginBottom: 16 }}>
          {t('agents.my_agents')}
        </Typography.Title>
        {agents.length > 0 && (
          <DragableList
            list={agents}
            onUpdate={updateAgents}
            onDragStart={() => setDragging(true)}
            onDragEnd={() => setDragging(false)}>
            {(agent: Agent) => {
              const dropdownMenuItems = [
                {
                  key: 'edit',
                  label: t('agents.edit.title'),
                  icon: <EditOutlined />,
                  onClick: () => AssistantSettingsPopup.show({ assistant: agent })
                },
                {
                  key: 'create',
                  label: t('agents.add.button'),
                  icon: <PlusOutlined />,
                  onClick: () => createAssistantFromAgent(agent)
                },
                {
                  key: 'delete',
                  label: t('common.delete'),
                  icon: <DeleteOutlined />,
                  danger: true,
                  onClick: () => handleDelete(agent)
                }
              ]

              const contextMenuItems = [
                {
                  label: t('agents.edit.title'),
                  onClick: () => AssistantSettingsPopup.show({ assistant: agent })
                },
                {
                  label: t('agents.add.button'),
                  onClick: () => createAssistantFromAgent(agent)
                },
                {
                  label: t('common.delete'),
                  onClick: () => handleDelete(agent)
                }
              ]

              return (
                <AgentCard
                  agent={agent}
                  onClick={() => onClick?.(agent)}
                  contextMenu={contextMenuItems}
                  menuItems={dropdownMenuItems}
                />
              )
            }}
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
        <div style={{ height: 10 }} />
      </div>
    </Container>
  )
}

const Container = styled.div`
  padding: 10px 15px;
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - var(--navbar-height));
  min-width: var(--assistants-width);
  max-width: var(--assistants-width);
  overflow-y: auto;
  overflow-x: hidden;

  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-track {
    border-radius: 3px;
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 3px;
    background: var(--color-scrollbar-thumb);
    transition: all 0.2s ease-in-out;
  }

  &:hover::-webkit-scrollbar-thumb {
    background: var(--color-scrollbar-thumb);
  }
`

export default Agents
