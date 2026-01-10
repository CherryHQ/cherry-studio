import Scrollbar from '@renderer/components/Scrollbar'
import { useAvailablePlugins, useInstalledPlugins, usePluginActions } from '@renderer/hooks/usePlugins'
import type { GetAgentResponse, GetAgentSessionResponse, UpdateAgentFunctionUnion } from '@renderer/types/agent'
import { Card, Segmented } from 'antd'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { InstalledPluginsList } from './components/InstalledPluginsList'
import { PluginBrowser } from './components/PluginBrowser'
import { PluginZipUploader } from './components/PluginZipUploader'

interface PluginSettingsProps {
  agentBase: GetAgentResponse | GetAgentSessionResponse
  update: UpdateAgentFunctionUnion
}

const PluginSettings: FC<PluginSettingsProps> = ({ agentBase }) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<string>('available')

  // Fetch available plugins
  const { agents, commands, skills, loading: loadingAvailable, error: errorAvailable } = useAvailablePlugins()

  // Fetch installed plugins
  const { plugins, loading: loadingInstalled, error: errorInstalled, refresh } = useInstalledPlugins(agentBase.id)

  // Plugin actions
  const { install, uninstall, uninstallPackage, installing, uninstalling, uninstallingPackage } = usePluginActions(
    agentBase.id,
    refresh
  )

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

  // Handle package uninstall action
  const handleUninstallPackage = useCallback(
    async (packageName: string) => {
      const result = await uninstallPackage(packageName)

      if (result.success) {
        window.toast.success(
          t('agent.settings.plugins.success.uninstall_package', { name: packageName }) ||
            `Package "${packageName}" uninstalled successfully`
        )
      } else {
        window.toast.error(t('agent.settings.plugins.error.uninstall') + (result.error ? ': ' + result.error : ''))
      }
    },
    [uninstallPackage, t]
  )

  const segmentOptions = useMemo(() => {
    return [
      {
        value: 'available',
        label: t('agent.settings.plugins.available.title')
      },
      {
        value: 'installed',
        label: t('agent.settings.plugins.installed.title')
      }
    ]
  }, [t])

  const renderContent = useMemo(() => {
    if (activeTab === 'available') {
      return (
        <div className="flex h-full flex-col overflow-y-auto pt-4 pr-2">
          <PluginZipUploader
            agentId={agentBase.id}
            onUploadSuccess={refresh}
            disabled={loadingAvailable || installing}
          />
          {errorAvailable ? (
            <Card variant="borderless">
              <p className="text-danger">
                {t('agent.settings.plugins.error.load')}: {errorAvailable}
              </p>
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
      )
    }

    return (
      <div className="flex h-full flex-col overflow-y-auto pt-4 pr-2">
        {errorInstalled ? (
          <Card className="bg-danger-50 dark:bg-danger-900/20">
            <p className="text-danger">
              {t('agent.settings.plugins.error.load')}: {errorInstalled}
            </p>
          </Card>
        ) : (
          <InstalledPluginsList
            plugins={plugins}
            onUninstall={handleUninstall}
            onUninstallPackage={handleUninstallPackage}
            loading={loadingInstalled || uninstalling}
            uninstallingPackage={uninstallingPackage}
          />
        )}
      </div>
    )
  }, [
    activeTab,
    agentBase.id,
    agents,
    commands,
    errorAvailable,
    errorInstalled,
    handleInstall,
    handleUninstall,
    handleUninstallPackage,
    installing,
    loadingAvailable,
    loadingInstalled,
    plugins,
    refresh,
    skills,
    t,
    uninstalling,
    uninstallingPackage
  ])

  return (
    <Scrollbar>
      <div className="flex flex-col gap-2">
        <div className="flex justify-center">
          <Segmented options={segmentOptions} value={activeTab} onChange={(value) => setActiveTab(value as string)} />
        </div>
        {renderContent}
      </div>
    </Scrollbar>
  )
}

export default PluginSettings
