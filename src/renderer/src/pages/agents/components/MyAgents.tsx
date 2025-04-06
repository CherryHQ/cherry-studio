import { DeleteOutlined, EditOutlined, PlusOutlined, SortAscendingOutlined } from '@ant-design/icons'
import { useAgents } from '@renderer/hooks/useAgents'
import AssistantSettingsPopup from '@renderer/pages/settings/AssistantSettings'
import { createAssistantFromAgent } from '@renderer/services/AssistantService'
import type { Agent } from '@renderer/types'
import { Col, Row } from 'antd'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import AddAgentCard from './AddAgentCard'
import AddAgentPopup from './AddAgentPopup'
import AgentCard from './AgentCard'
import ManageAgentsPopup from './ManageAgentsPopup'

interface Props {
  onClick?: (agent: Agent) => void
  search?: string
}

const MyAgents: React.FC<Props> = ({ onClick, search }) => {
  const { t } = useTranslation()
  const { agents, removeAgent } = useAgents()

  const filteredAgents = useMemo(() => {
    if (!search?.trim()) return agents

    return agents.filter(
      (agent) =>
        agent.name.toLowerCase().includes(search.toLowerCase()) ||
        agent.description?.toLowerCase().includes(search.toLowerCase())
    )
  }, [agents, search])

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

  return (
    <Row gutter={[20, 20]}>
      {filteredAgents.map((agent) => {
        const menuItems = [
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
            key: 'sort',
            label: t('agents.sorting.title'),
            icon: <SortAscendingOutlined />,
            onClick: () => ManageAgentsPopup.show()
          },
          {
            key: 'delete',
            label: t('common.delete'),
            icon: <DeleteOutlined />,
            danger: true,
            onClick: () => handleDelete(agent)
          }
        ]

        return (
          <Col span={6} key={agent.id}>
            <AgentCard agent={agent} onClick={() => onClick?.(agent)} contextMenu={menuItems} menuItems={menuItems} />
          </Col>
        )
      })}
      <Col span={6}>
        <AddAgentCard onClick={() => AddAgentPopup.show()} />
      </Col>
    </Row>
  )
}

export default MyAgents
