import { Button, Divider } from '@heroui/react'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { AgentSettingsPopup } from '@renderer/pages/settings/AgentSettings'
import AdvancedSettings from '@renderer/pages/settings/AgentSettings/AdvancedSettings'
import AgentEssentialSettings from '@renderer/pages/settings/AgentSettings/AgentEssentialSettings'
import { GetAgentResponse } from '@renderer/types/agent'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  agent: GetAgentResponse | undefined | null
  update: ReturnType<typeof useUpdateAgent>['updateAgent']
}

const AgentSettingsTab: FC<Props> = ({ agent, update }) => {
  const { t } = useTranslation()

  const onMoreSetting = () => {
    if (agent?.id) {
      AgentSettingsPopup.show({ agentId: agent.id! })
    }
  }

  if (!agent) {
    return null
  }

  return (
    <div className="w-[var(--assistants-width)] p-2 px-3 pt-4">
      <AgentEssentialSettings agent={agent} update={update} showModelSetting={false} />
      <AdvancedSettings agentBase={agent} update={update} />
      <Divider className="my-2" />
      <Button size="sm" fullWidth onPress={onMoreSetting}>
        {t('settings.moresetting.label')}
      </Button>
    </div>
  )
}

export default AgentSettingsTab
