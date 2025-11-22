import { useAgents } from '@renderer/hooks/agents/useAgents'
import type { GetAgentResponse, GetAgentSessionResponse, UpdateAgentFunctionUnion } from '@renderer/types'
import { Form, Select, Spin } from 'antd'
import { useTranslation } from 'react-i18next'

interface SubAgentsSettingsProps {
  agentBase: GetAgentResponse | GetAgentSessionResponse | undefined | null
  update: UpdateAgentFunctionUnion
}

const SubAgentsSettings: React.FC<SubAgentsSettingsProps> = ({ agentBase, update }) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const { agents, isLoading } = useAgents()

  if (!agentBase) return

  const handleValuesChange = (changedValues: { sub_agents: string[] }) => {
    update({
      id: agentBase.id,
      ...changedValues
    })
  }

  if (isLoading) {
    return <Spin />
  }

  const availableAgents = agents?.filter((agent) => agent.id !== agentBase.id) || []

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{ sub_agents: agentBase.sub_agents || [] }}
      onValuesChange={handleValuesChange}
      style={{ maxWidth: 600 }}>
      <Form.Item
        name="sub_agents"
        label={t('agent.settings.sub_agents.title')}
        tooltip={t('agent.settings.sub_agents.tooltip')}>
        <Select
          mode="multiple"
          placeholder={t('agent.settings.sub_agents.placeholder')}
          loading={isLoading}
          options={availableAgents.map((agent) => ({
            label: agent.name,
            value: agent.id
          }))}
          filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
        />
      </Form.Item>
    </Form>
  )
}

export default SubAgentsSettings
