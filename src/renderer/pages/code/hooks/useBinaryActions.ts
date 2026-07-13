import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { CLI_TOOL_PRESET_MAP } from '@renderer/pages/code/constants/codeCliTools'
import { toast } from '@renderer/services/toast'
import type { BinaryManifestEntry } from '@shared/data/preference/preferenceTypes'
import { CLI_BINARY_NAMES } from '@shared/data/presets/codeCliTools'
import type { CodeCli } from '@shared/types/codeCli'
import { type Dispatch, type SetStateAction, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  // request; they differ only in the busy Set, the success toast, and the log
  // label. Failures are not toasted here: the main process tracks them in the
  // install-state map and the version card renders a persistent failure row.
  const runInstallTool = useCallback(
    async (
      toolId: CodeCli,
      setBusy: Dispatch<SetStateAction<Set<string>>>,
      messages: { successKey: string; logLabel: string },
      intent?: BinaryManifestEntry,
      targetVersion?: string
    ) => {
      try {
        setBusy((prev) => new Set(prev).add(toolId))
        const cliPreset = CLI_TOOL_PRESET_MAP[toolId]
        if (cliPreset) {
          await ipcApi.request('binary.install_tool', {
            intent: intent ?? {
              name: CLI_BINARY_NAMES[toolId],
              tool: cliPreset.miseTool
            },
            ...(targetVersion ? { targetVersion } : {})
          })
          toast.success(t(messages.successKey))
        }
      } catch (error) {
        logger.error(messages.logLabel, error as Error)
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
    (toolId: CodeCli, intent?: BinaryManifestEntry) =>
      runInstallTool(
        toolId,
        setInstallingTools,
        {
          successKey: 'code.install_success',
          logLabel: 'Failed to install:'
        },
        intent
      ),
    [runInstallTool]
  )

  const upgrade = useCallback(
    (toolId: CodeCli, latestVersion?: string, intent?: BinaryManifestEntry) =>
      runInstallTool(
        toolId,
        setUpgradingTools,
        {
          successKey: 'code.upgrade_success',
          logLabel: 'Failed to upgrade:'
        },
        intent,
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
