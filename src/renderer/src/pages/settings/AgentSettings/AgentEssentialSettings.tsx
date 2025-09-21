import { Avatar } from '@heroui/react'
import { Box, HStack } from '@renderer/components/Layout'
import { getAgentAvatar } from '@renderer/config/agent'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { AgentEntity, UpdateAgentForm } from '@renderer/types'
import { Input } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface AgentEssentialSettingsProps {
  agent: AgentEntity | undefined | null
  update: ReturnType<typeof useUpdateAgent>
}

const AgentEssentialSettings: FC<AgentEssentialSettingsProps> = ({ agent, update }) => {
  const { t } = useTranslation()
  const [name, setName] = useState<string>((agent?.name ?? '').trim())

  const onUpdate = () => {
    if (!agent) return
    const _agent = { ...agent, type: undefined, name: name.trim() } satisfies UpdateAgentForm
    update(_agent)
  }

  if (!agent) return null

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Box mb={8} style={{ fontWeight: 'bold' }}>
        {t('common.name')}
      </Box>
      <HStack gap={8} alignItems="center">
        <Avatar src={getAgentAvatar(agent.type)} title={agent.type} className="h-5 w-5" />
        <Input
          placeholder={t('common.assistant') + t('common.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name !== agent.name) {
              onUpdate()
            }
          }}
          style={{ flex: 1 }}
        />
      </HStack>
    </div>
  )
}

export default AgentEssentialSettings
