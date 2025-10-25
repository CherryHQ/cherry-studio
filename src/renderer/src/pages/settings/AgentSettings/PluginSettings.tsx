import { Card, CardBody, Tab, Tabs } from '@heroui/react'
import { useAvailablePlugins, useInstalledPlugins, usePluginActions } from '@renderer/hooks/usePlugins'
import { GetAgentResponse, GetAgentSessionResponse, UpdateAgentBaseForm } from '@renderer/types/agent'
import { FC, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { InstalledPluginsList } from './components/InstalledPluginsList'
import { PluginBrowser } from './components/PluginBrowser'
import { SettingsContainer } from './shared'

interface PluginSettingsProps {
  agentBase: GetAgentResponse | GetAgentSessionResponse
  update: (partial: UpdateAgentBaseForm) => Promise<void>
}

const PluginSettings: FC<PluginSettingsProps> = ({ agentBase }) => {
  const { t } = useTranslation()

  // Fetch available plugins
  const { agents, commands, skills, loading: loadingAvailable, error: errorAvailable } = useAvailablePlugins()

  // Fetch installed plugins
  const { plugins, loading: loadingInstalled, error: errorInstalled, refresh } = useInstalledPlugins(agentBase.id)

  // Plugin actions
  const { install, uninstall, installing, uninstalling } = usePluginActions(agentBase.id, refresh)

  // Handle install action
  const handleInstall = useCallback(
    async (sourcePath: string, type: 'agent' | 'command' | 'skill') => {
      const result = await install(sourcePath, type)

      if (result.success) {
        window.toast.success(t('agent.settings.plugins.success.install'))
      } else {
        window.toast.error(t('agent.settings.plugins.error.install') + (result.error ? ': ' + result.error : ''))
      }
    },
    [install, t]
  )

  // Handle uninstall action
  const handleUninstall = useCallback(
    async (filename: string, type: 'agent' | 'command' | 'skill') => {
      const result = await uninstall(filename, type)

      if (result.success) {
        window.toast.success(t('agent.settings.plugins.success.uninstall'))
      } else {
        window.toast.error(t('agent.settings.plugins.error.uninstall') + (result.error ? ': ' + result.error : ''))
      }
    },
    [uninstall, t]
  )

  return (
    <SettingsContainer>
      <Tabs
        aria-label="Plugin settings tabs"
        classNames={{
          base: 'w-full',
          tabList: 'w-full',
          panel: 'w-full flex-1 overflow-hidden'
        }}>
        <Tab key="available" title={t('agent.settings.plugins.available.title')}>
          <div className="flex h-full flex-col overflow-y-auto pt-4">
            {errorAvailable ? (
              <Card className="bg-danger-50 dark:bg-danger-900/20">
                <CardBody>
                  <p className="text-danger">
                    {t('agent.settings.plugins.error.load')}: {errorAvailable}
                  </p>
                </CardBody>
              </Card>
            ) : (
              <PluginBrowser
                agentId={agentBase.id}
                agents={agents}
                commands={commands}
                skills={skills}
                installedPlugins={plugins}
                onInstall={handleInstall}
                onUninstall={handleUninstall}
                loading={loadingAvailable || installing || uninstalling}
              />
            )}
          </div>
        </Tab>

        <Tab key="installed" title={t('agent.settings.plugins.installed.title')}>
          <div className="flex h-full flex-col overflow-y-auto pt-4">
            {errorInstalled ? (
              <Card className="bg-danger-50 dark:bg-danger-900/20">
                <CardBody>
                  <p className="text-danger">
                    {t('agent.settings.plugins.error.load')}: {errorInstalled}
                  </p>
                </CardBody>
              </Card>
            ) : (
              <InstalledPluginsList
                plugins={plugins}
                onUninstall={handleUninstall}
                loading={loadingInstalled || uninstalling}
              />
            )}
          </div>
        </Tab>
      </Tabs>
    </SettingsContainer>
  )
}

export default PluginSettings
