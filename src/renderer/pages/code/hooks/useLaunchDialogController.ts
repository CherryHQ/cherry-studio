import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import type { Provider } from '@shared/data/types/provider'
import type { CodeCli } from '@shared/types/codeCli'
import type { ComponentProps } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { resolveCliConfigApplyContext } from '../cliConfig/applyContext'
import type { LaunchDialog } from '../components/LaunchDialog'
import { PROVIDERLESS_CLI_TOOLS } from '../constants/cliTools'
import { useAvailableTerminals } from './useAvailableTerminals'

const logger = loggerService.withContext('useLaunchDialogController')

interface UseLaunchDialogControllerOptions {
  selectedCliTool: CodeCli
  toolName: string
  directory?: string
  enabledProvider?: Provider
  currentProviderConfig?: CliProviderConfig | null
  selectedTerminal?: string
  upsertProviderConfig: (
    providerId: string,
    partial: { modelId: string } & Partial<CliProviderConfig>
  ) => Promise<string>
  setCurrentProvider: (providerId: string | null) => Promise<void>
  setTerminal: (terminal: string) => Promise<void>
  selectFolder: () => Promise<string | null>
}

interface LaunchDialogController {
  launchDialogProps: ComponentProps<typeof LaunchDialog>
  launching: boolean
  openLaunchDialog: () => void
}

export function useLaunchDialogController({
  selectedCliTool,
  toolName,
  directory,
  enabledProvider,
  currentProviderConfig,
  selectedTerminal,
  upsertProviderConfig,
  setCurrentProvider,
  setTerminal,
  selectFolder
}: UseLaunchDialogControllerOptions): LaunchDialogController {
  const { t } = useTranslation()
  const availableTerminals = useAvailableTerminals()
  const [launchOpen, setLaunchOpen] = useState(false)
  const [launching, setLaunching] = useState(false)

  const handleSelectFolder = useCallback(async () => {
    try {
      await selectFolder()
    } catch (err) {
      logger.error('Failed to select folder:', err as Error)
    }
  }, [selectFolder])

  // The CLI config file is written at "enable" time, not here — launch only
  // opens a terminal running the CLI in the provider's directory. Provider-less
  // tools (qoder / copilot) launch with a directory only.
  const handleLaunch = useCallback(async () => {
    const isProviderless = PROVIDERLESS_CLI_TOOLS.has(selectedCliTool)
    if (!directory || (!isProviderless && !enabledProvider)) {
      window.toast.error(t('code.folder_placeholder'))
      return
    }
    if (isProviderless) {
      try {
        setLaunching(true)
        const runResult = await ipcApi.request('code_cli.run', {
          cliTool: selectedCliTool,
          model: '',
          providerId: '',
          directory,
          options: { terminal: selectedTerminal ?? undefined }
        })
        if (!runResult.success) {
          window.toast.error(runResult.message)
          return
        }
        setLaunchOpen(false)
      } catch (err) {
        logger.error('Failed to launch CLI tool:', err as Error)
        window.toast.error(t('code.launch.error'))
      } finally {
        setLaunching(false)
      }
      return
    }

    const cliConfigContext = enabledProvider
      ? resolveCliConfigApplyContext(selectedCliTool, enabledProvider.id, currentProviderConfig ?? undefined)
      : null
    if (!cliConfigContext) {
      logger.error('Invalid CLI model id configured for launch', {
        modelId: currentProviderConfig?.modelId,
        toolId: selectedCliTool,
        providerId: enabledProvider?.id
      })
      if (enabledProvider) {
        await upsertProviderConfig(enabledProvider.id, { modelId: '' })
      }
      await setCurrentProvider(null)
      window.toast.error(t('code.launch.validation_error'))
      return
    }

    try {
      setLaunching(true)
      const runResult = await ipcApi.request('code_cli.run', {
        cliTool: selectedCliTool,
        model: cliConfigContext.rawModelId,
        providerId: cliConfigContext.providerId,
        directory,
        options: { terminal: selectedTerminal ?? undefined }
      })
      if (!runResult.success) {
        window.toast.error(runResult.message)
      } else {
        setLaunchOpen(false)
      }
    } catch (err) {
      logger.error('Failed to launch CLI tool:', err as Error)
      window.toast.error(t('code.launch.error'))
    } finally {
      setLaunching(false)
    }
  }, [
    currentProviderConfig,
    directory,
    enabledProvider,
    upsertProviderConfig,
    selectedCliTool,
    selectedTerminal,
    setCurrentProvider,
    t
  ])

  return {
    launchDialogProps: {
      open: launchOpen,
      onClose: () => setLaunchOpen(false),
      toolName,
      directory,
      terminals: availableTerminals,
      selectedTerminal,
      onSelectFolder: () => void handleSelectFolder(),
      onSelectTerminal: (terminal) => void setTerminal(terminal),
      onLaunch: () => void handleLaunch(),
      launching
    },
    launching,
    openLaunchDialog: () => setLaunchOpen(true)
  }
}
