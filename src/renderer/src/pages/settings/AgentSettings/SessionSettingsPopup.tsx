import { TopView } from '@renderer/components/TopView'
import { useAgent } from '@renderer/hooks/agents/useAgentDataApi'
import { useUpdateAgent } from '@renderer/hooks/agents/useAgentDataApi'
import { useSession } from '@renderer/hooks/agents/useSessionDataApi'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseSettingsPopup, type SettingsMenuItem, type SettingsPopupTab } from './BaseSettingsPopup'
import AdvancedSettings from './components/AdvancedSettings'
import EssentialSettings from './components/EssentialSettings'
import PermissionModeSettings from './components/PermissionModeSettings'
import PromptSettings from './components/PromptSettings'
import ToolsSettings from './components/ToolsSettings'
import { SessionLabel } from './shared'

interface SessionSettingPopupShowParams {
  agentId: string
  sessionId: string
  tab?: SettingsPopupTab
}

interface SessionSettingPopupParams extends SessionSettingPopupShowParams {
  resolve: () => void
}

const SessionSettingPopupContainer: React.FC<SessionSettingPopupParams> = ({ tab, agentId, sessionId, resolve }) => {
  const { t } = useTranslation()
  const { session, isLoading: sessionLoading, error: sessionError } = useSession(agentId, sessionId)
  const { agent, isLoading: agentLoading, error: agentError } = useAgent(agentId)
  const { updateAgent } = useUpdateAgent()

  const menuItems: SettingsMenuItem[] = useMemo(
    () => [
      { key: 'essential', label: t('agent.settings.essential') },
      { key: 'prompt', label: t('agent.settings.prompt') },
      { key: 'permission-mode', label: t('agent.settings.permissionMode.tab', 'Permission Mode') },
      { key: 'tools-mcp', label: t('agent.settings.toolsMcp.tab', 'Tools & MCP') },
      { key: 'advanced', label: t('agent.settings.advance.title', 'Advanced Settings') }
    ],
    [t]
  )

  const renderTabContent = (currentTab: SettingsPopupTab) => {
    if (!agent) return null

    switch (currentTab) {
      case 'essential':
        return <EssentialSettings agentBase={agent} update={updateAgent} />
      case 'prompt':
        return <PromptSettings agentBase={agent} update={updateAgent} />
      case 'permission-mode':
        return <PermissionModeSettings agentBase={agent} update={updateAgent} />
      case 'tools-mcp':
        return <ToolsSettings agentBase={agent} update={updateAgent} />
      case 'advanced':
        return <AdvancedSettings agentBase={agent} update={updateAgent} />
      default:
        return null
    }
  }

  return (
    <BaseSettingsPopup
      isLoading={sessionLoading || agentLoading}
      error={sessionError ?? agentError ?? null}
      initialTab={tab}
      onClose={resolve}
      titleContent={<SessionLabel session={session} />}
      menuItems={menuItems}
      renderTabContent={renderTabContent}
    />
  )
}

export default class SessionSettingsPopup {
  static show(props: SessionSettingPopupShowParams) {
    return new Promise<void>((resolve) => {
      TopView.show(
        <SessionSettingPopupContainer
          {...props}
          resolve={() => {
            resolve()
            TopView.hide('SessionSettingsPopup')
          }}
        />,
        'SessionSettingsPopup'
      )
    })
  }
}
