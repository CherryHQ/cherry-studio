import type { InstalledPlugin, PluginError, PluginMetadata, UninstallPluginPackageResult } from '@renderer/types/plugin'
import { getPluginErrorMessage } from '@renderer/utils/pluginErrors'
import { useCallback, useEffect, useState } from 'react'

/**
 * Hook to fetch and cache available plugins from the resources directory
 * @returns Object containing available agents, commands, skills, loading state, and error
 */
export function useAvailablePlugins() {
  const [agents, setAgents] = useState<PluginMetadata[]>([])
  const [commands, setCommands] = useState<PluginMetadata[]>([])
  const [skills, setSkills] = useState<PluginMetadata[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchAvailablePlugins = async () => {
      setLoading(true)
      setError(null)

      try {
        const result = await window.api.claudeCodePlugin.listAvailable()

        if (result.success) {
          setAgents(result.data.agents)
          setCommands(result.data.commands)
          setSkills(result.data.skills)
        } else {
          setError(getPluginErrorMessage(result.error, 'Failed to load available plugins'))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error occurred')
      } finally {
        setLoading(false)
      }
    }

    fetchAvailablePlugins()
  }, [])

  return { agents, commands, skills, loading, error }
}

/**
 * Hook to fetch installed plugins for a specific agent
 * @param agentId - The ID of the agent to fetch plugins for
 * @returns Object containing installed plugins, loading state, error, and refresh function
 */
export function useInstalledPlugins(agentId: string | undefined) {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!agentId) {
      setPlugins([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await window.api.claudeCodePlugin.listInstalled(agentId)

      if (result.success) {
        setPlugins(result.data)
      } else {
        setError(getPluginErrorMessage(result.error, 'Failed to load installed plugins'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred')
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { plugins, loading, error, refresh }
}

/**
 * Hook to provide install and uninstall actions for plugins
 * @param agentId - The ID of the agent to perform actions for
 * @param onSuccess - Optional callback to be called on successful operations
 * @returns Object containing install, uninstall, uninstallPackage functions and their loading states
 */
export function usePluginActions(agentId: string, onSuccess?: () => void) {
  const [installing, setInstalling] = useState<boolean>(false)
  const [uninstalling, setUninstalling] = useState<boolean>(false)
  const [uninstallingPackage, setUninstallingPackage] = useState<boolean>(false)

  const executeAction = useCallback(
    async <TResult>(
      action: () => Promise<{ success: boolean; data?: TResult; error?: PluginError }>,
      setLoading: (loading: boolean) => void,
      errorPrefix: string
    ): Promise<{ success: true; data: TResult } | { success: false; error: string }> => {
      setLoading(true)
      try {
        const result = await action()
        if (result.success) {
          onSuccess?.()
          return { success: true, data: result.data as TResult }
        }
        return { success: false, error: getPluginErrorMessage(result.error, errorPrefix) }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error occurred' }
      } finally {
        setLoading(false)
      }
    },
    [onSuccess]
  )

  const install = useCallback(
    (sourcePath: string, type: 'agent' | 'command' | 'skill') =>
      executeAction(
        () => window.api.claudeCodePlugin.install({ agentId, sourcePath, type }),
        setInstalling,
        'Failed to install plugin'
      ),
    [agentId, executeAction]
  )

  const uninstall = useCallback(
    (filename: string, type: 'agent' | 'command' | 'skill') =>
      executeAction(
        () => window.api.claudeCodePlugin.uninstall({ agentId, filename, type }),
        setUninstalling,
        'Failed to uninstall plugin'
      ),
    [agentId, executeAction]
  )

  const uninstallPackage = useCallback(
    (
      packageName: string
    ): Promise<{ success: true; data: UninstallPluginPackageResult } | { success: false; error: string }> =>
      executeAction(
        () => window.api.claudeCodePlugin.uninstallPackage({ agentId, packageName }),
        setUninstallingPackage,
        'Failed to uninstall package'
      ),
    [agentId, executeAction]
  )

  return { install, uninstall, uninstallPackage, installing, uninstalling, uninstallingPackage }
}
