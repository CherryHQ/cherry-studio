import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { CLI_TOOL_PRESET_MAP } from '@shared/data/presets/codeCliTools'
import type { codeCLI } from '@shared/types/codeCli'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CLI_BINARY_NAMES } from './cliTools'

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

  const install = useCallback(
    async (toolId: codeCLI) => {
      try {
        setInstallingTools((prev) => new Set(prev).add(toolId))
        const cliPreset = CLI_TOOL_PRESET_MAP[toolId]
        if (cliPreset) {
          await ipcApi.request('binary.install_tool', {
            name: CLI_BINARY_NAMES[toolId],
            tool: cliPreset.miseTool
          })
          window.toast.success(t('code.install_success'))
        }
      } catch (error) {
        logger.error('Failed to install:', error as Error)
        window.toast.error(t('code.install_error'))
      } finally {
        setInstallingTools((prev) => {
          const next = new Set(prev)
          next.delete(toolId)
          return next
        })
      }
    },
    [t]
  )

  const upgrade = useCallback(
    async (toolId: codeCLI) => {
      try {
        setUpgradingTools((prev) => new Set(prev).add(toolId))
        const cliPreset = CLI_TOOL_PRESET_MAP[toolId]
        if (cliPreset) {
          await ipcApi.request('binary.install_tool', {
            name: CLI_BINARY_NAMES[toolId],
            tool: cliPreset.miseTool
          })
          window.toast.success(t('code.upgrade_success'))
        }
      } catch (error) {
        logger.error('Failed to upgrade:', error as Error)
        window.toast.error(t('code.upgrade_error'))
      } finally {
        setUpgradingTools((prev) => {
          const next = new Set(prev)
          next.delete(toolId)
          return next
        })
      }
    },
    [t]
  )

  const remove = useCallback(
    async (toolId: codeCLI) => {
      try {
        await ipcApi.request('binary.remove_tool', CLI_BINARY_NAMES[toolId])
        window.toast.success(t('common.delete_success'))
      } catch (error) {
        logger.error('Failed to remove:', error as Error)
        window.toast.error(t('common.delete_failed'))
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
