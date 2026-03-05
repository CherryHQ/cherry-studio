import { TopView } from '@renderer/components/TopView'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useUpdateAgent } from '@renderer/hooks/agents/useUpdateAgent'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseSettingsPopup, type SettingsMenuItem, type SettingsPopupTab } from './BaseSettingsPopup'
import AdvancedSettings from './components/AdvancedSettings'
import EssentialSettings from './components/EssentialSettings'
import PermissionModeSettings from './components/PermissionModeSettings'
import { InstalledPluginsSettings, PluginBrowserSettings } from './components/PluginsSettings/PluginsSettings'
import PromptSettings from './components/PromptSettings'
import ToolsSettings from './components/ToolsSettings'
import { AgentLabel } from './shared'

interface AgentSettingPopupShowParams {
  agentId: string
  tab?: SettingsPopupTab
}

interface AgentSettingPopupParams extends AgentSettingPopupShowParams {
  resolve: () => void
}

const AgentSettingPopupContainer: React.FC<AgentSettingPopupParams> = ({ tab, agentId, resolve }) => {
  const { t } = useTranslation()
  const { agent, isLoading, error } = useAgent(agentId)
  const { updateAgent } = useUpdateAgent()

  const menuItems: SettingsMenuItem[] = useMemo(
    () => [
      { key: 'essential', label: t('agent.settings.essential') },
      { key: 'prompt', label: t('agent.settings.prompt') },
      { key: 'permission-mode', label: t('agent.settings.permissionMode.tab', 'Permission Mode') },
      { key: 'tools-mcp', label: t('agent.settings.toolsMcp.tab', 'Tools & MCP') },
      { key: 'plugins', label: t('agent.settings.plugins.available.title', 'Available Plugins') },
      { key: 'installed', label: t('agent.settings.plugins.installed.title', 'Installed Plugins') },
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
      case 'plugins':
        return <PluginBrowserSettings agentBase={agent} update={updateAgent} />
      case 'installed':
        return <InstalledPluginsSettings agentBase={agent} update={updateAgent} />
      case 'advanced':
        return <AdvancedSettings agentBase={agent} update={updateAgent} />
      default:
        return null
    }
  }

  return (
    <BaseSettingsPopup
      isLoading={isLoading}
      error={error}
      initialTab={tab}
      onClose={resolve}
      titleContent={<AgentLabel agent={agent} />}
      menuItems={menuItems}
      renderTabContent={renderTabContent}
    />
  )
}

export default class AgentSettingsPopup {
  static show(props: AgentSettingPopupShowParams) {
    return new Promise<void>((resolve) => {
      TopView.show(
        <AgentSettingPopupContainer
          {...props}
          resolve={() => {
            resolve()
            TopView.hide('AgentSettingsPopup')
          }}
        />,
        'AgentSettingsPopup'
      )
    })
  }
}
