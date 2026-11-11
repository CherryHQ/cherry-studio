import { type Dispatch, type SetStateAction, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { CODE_CLI_TOOL_PRESET_MAP } from '@shared/data/presets/codeCliTools'
import type { CodeCli } from '@shared/types/codeCli'

const logger = loggerService.withContext('useBinaryActions')

/**
 * Per-tool install/upgrade/remove actions. The busy Sets are global (not keyed
 * to the selected tool) so the sidebar can show every tool's install state
 * independently — installing codex must not make the claude-code card flash.
 */
export function useBinaryActions() {
  const { t } = useTranslation()
  const [installingTools, setInstallingTools] = useState<Set<string>>(() => new Set())
  const [upgradingTools, setUpgradingTools] = useState<Set<string>>(() => new Set())

  const runInstallTool = useCallback(
    async (
      toolId: CodeCli,
      setBusy: Dispatch<SetStateAction<Set<string>>>,
      messages: { successKey: string; logLabel: string },
      targetVersion?: string
    ) => {
      try {
        setBusy((prev) => new Set(prev).add(toolId))
        await ipcApi.request('binary.install_tool', {
          name: CODE_CLI_TOOL_PRESET_MAP[toolId].executable,
          ...(targetVersion ? { targetVersion } : {})
        })
        toast.success(t(messages.successKey))
      } catch (error) {
        logger.error(messages.logLabel, error as Error)
        toast.error(t('local_agents.install_error.failed'))
      } finally {
        setBusy((prev) => {
          const next = new Set(prev)
          next.delete(toolId)
          return next
        })
      }
    },
    [t]
  )

  // `targetVersion` is only supplied when retrying a failed one-shot update, so
  // the retry repeats the same targeted install instead of a name-only no-op.
  const install = useCallback(
    (toolId: CodeCli, targetVersion?: string) =>
      runInstallTool(
        toolId,
        setInstallingTools,
        {
          successKey: 'code.install_success',
          logLabel: 'Failed to install:'
        },
        targetVersion
      ),
    [runInstallTool]
  )

  const upgrade = useCallback(
    (toolId: CodeCli, latestVersion?: string) =>
      runInstallTool(
        toolId,
        setUpgradingTools,
        {
          successKey: 'code.upgrade_success',
          logLabel: 'Failed to upgrade:'
        },
        latestVersion
      ),
    [runInstallTool]
  )

  const remove = useCallback(
    async (toolId: CodeCli): Promise<boolean> => {
      try {
        const result = await ipcApi.request('binary.remove_tool', {
          name: CODE_CLI_TOOL_PRESET_MAP[toolId].executable
        })
        // A Code CLI is a fixed tool: it has no removable definition, so a
        // fail-closed cleanup_blocked has no definition-only fallback — surface it
        // as an error the user resolves (e.g. stop a dependent) before retrying.
        if (result.status === 'cleanup_blocked') {
          toast.error(result.message ?? t('settings.dependencies.uninstallFailed'))
          return false
        }
        toast.success(t('settings.dependencies.uninstallSuccess'))
        return true
      } catch (error) {
        logger.error('Failed to remove:', error as Error)
        toast.error(t('settings.dependencies.uninstallFailed'))
        return false
      }
    },
    [t]
  )

  return {
    install,
    upgrade,
    remove,
    installingTools,
    upgradingTools
  }
}
