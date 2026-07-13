import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { CLI_TOOL_PRESET_MAP } from '@renderer/pages/code/constants/codeCliTools'
import { toast } from '@renderer/services/toast'
import type { CodeCli } from '@shared/types/codeCli'
import { type Dispatch, type SetStateAction, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CLI_BINARY_NAMES } from '../constants/cliTools'

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

  // install and upgrade share one body — both run the same `binary.install_tool`
  // request; they differ only in the busy Set, the toast keys, and the log label.
  const runInstallTool = useCallback(
    async (
      toolId: CodeCli,
      setBusy: Dispatch<SetStateAction<Set<string>>>,
      messages: { successKey: string; errorKey: string; logLabel: string },
      version?: string
    ) => {
      try {
        setBusy((prev) => new Set(prev).add(toolId))
        const cliPreset = CLI_TOOL_PRESET_MAP[toolId]
        if (cliPreset) {
          await ipcApi.request('binary.install_tool', {
            name: CLI_BINARY_NAMES[toolId],
            tool: cliPreset.miseTool,
            ...(version ? { version } : {})
          })
          toast.success(t(messages.successKey))
        }
      } catch (error) {
        logger.error(messages.logLabel, error as Error)
        toast.error(t(messages.errorKey))
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

  const install = useCallback(
    (toolId: CodeCli) =>
      runInstallTool(toolId, setInstallingTools, {
        successKey: 'code.install_success',
        errorKey: 'code.install_error',
        logLabel: 'Failed to install:'
      }),
    [runInstallTool]
  )

  const upgrade = useCallback(
    (toolId: CodeCli, latestVersion?: string) =>
      runInstallTool(
        toolId,
        setUpgradingTools,
        {
          successKey: 'code.upgrade_success',
          errorKey: 'code.upgrade_error',
          logLabel: 'Failed to upgrade:'
        },
        latestVersion
      ),
    [runInstallTool]
  )

  const remove = useCallback(
    async (toolId: CodeCli): Promise<boolean> => {
      try {
        await ipcApi.request('binary.remove_tool', CLI_BINARY_NAMES[toolId])
        toast.success(t('common.delete_success'))
        return true
      } catch (error) {
        logger.error('Failed to remove:', error as Error)
        toast.error(t('common.delete_failed'))
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
