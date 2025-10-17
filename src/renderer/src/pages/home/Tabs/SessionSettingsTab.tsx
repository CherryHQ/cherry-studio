import { Button, Divider } from '@heroui/react'
import { useUpdateSession } from '@renderer/hooks/agents/useUpdateSession'
import { SessionSettingsPopup } from '@renderer/pages/settings/AgentSettings'
import AdvancedSettings from '@renderer/pages/settings/AgentSettings/AdvancedSettings'
import EssentialSettings from '@renderer/pages/settings/AgentSettings/EssentialSettings'
import { GetAgentSessionResponse } from '@renderer/types'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  session: GetAgentSessionResponse | undefined | null
  update: ReturnType<typeof useUpdateSession>['updateSession']
}

const SessionSettingsTab: FC<Props> = ({ session, update }) => {
  const { t } = useTranslation()

  const onMoreSetting = () => {
    if (session?.id) {
      SessionSettingsPopup.show({
        agentId: session.agent_id,
        sessionId: session.id
      })
    }
  }

  if (!session) {
    return null
  }

  return (
    <div className="w-[var(--assistants-width)] p-2 px-3 pt-4">
      <EssentialSettings agentBase={session} update={update} showModelSetting={false} />
      <AdvancedSettings agentBase={session} update={update} />
      <Divider className="my-2" />
      <Button size="sm" fullWidth onPress={onMoreSetting}>
        {t('settings.moresetting.label')}
      </Button>
    </div>
  )
}

export default SessionSettingsTab
