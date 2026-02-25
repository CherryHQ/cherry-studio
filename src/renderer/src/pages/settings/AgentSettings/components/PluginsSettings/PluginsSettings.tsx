import Scrollbar from '@renderer/components/Scrollbar'
import { useInstalledPlugins, usePluginActions } from '@renderer/hooks/usePlugins'
import type { GetAgentResponse, GetAgentSessionResponse, UpdateAgentFunctionUnion } from '@renderer/types/agent'
import { Card } from 'antd'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsContainer } from '../../shared'
import { InstalledPluginsList } from './components/InstalledPluginsList'
import { PluginBrowser } from './components/PluginBrowser'
import { PluginUploader } from './components/PluginUploader'

interface PluginSettingsProps {
  agentBase: GetAgentResponse | GetAgentSessionResponse
  update: UpdateAgentFunctionUnion
}

/**
 * Plugin Browser Settings - shows the marketplace browser for plugins and skills
 */
export const PluginBrowserSettings: FC<PluginSettingsProps> = ({ agentBase }) => {
  const { t } = useTranslation()

  // Fetch installed plugins for checking installation status
  const { plugins, refresh } = useInstalledPlugins(agentBase.id)

  // Plugin actions
  const { install, uninstall } = usePluginActions(agentBase.id, refresh)

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
    <div className="flex h-full flex-col overflow-hidden p-[16px]">
      <div className="min-h-0 flex-1">
        <PluginBrowser installedPlugins={plugins} onInstall={handleInstall} onUninstall={handleUninstall} />
      </div>
    </div>
  )
}

/**
 * Installed Plugins Settings - shows the list of installed plugins with upload capability
 */
export const InstalledPluginsSettings: FC<PluginSettingsProps> = ({ agentBase }) => {
  const { t } = useTranslation()

  // Fetch installed plugins
  const { plugins, loading: loadingInstalled, error: errorInstalled, refresh } = useInstalledPlugins(agentBase.id)

  // Plugin actions
  const { uninstall, uninstallPackage, installing, uninstalling, uninstallingPackage } = usePluginActions(
    agentBase.id,
    refresh
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

  return (
    <SettingsContainer>
      <PluginUploader agentId={agentBase.id} onUploadSuccess={refresh} disabled={installing} />
      {errorInstalled ? (
        <Card className="bg-danger-50 dark:bg-danger-900/20">
          <p className="text-danger">
            {t('agent.settings.plugins.error.load')}: {errorInstalled}
          </p>
        </Card>
      ) : (
        <Scrollbar className="min-h-0 flex-1 pr-1">
          <InstalledPluginsList
            plugins={plugins}
            onUninstall={handleUninstall}
            onUninstallPackage={handleUninstallPackage}
            loading={loadingInstalled || uninstalling}
            uninstallingPackage={uninstallingPackage}
          />
        </Scrollbar>
      )}
    </SettingsContainer>
  )
}
