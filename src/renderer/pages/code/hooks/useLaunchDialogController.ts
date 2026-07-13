import { useModels } from '@renderer/hooks/useModel'
import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import type { Provider } from '@shared/data/types/provider'
import { type CodeCli, isApiGatewayProviderId } from '@shared/types/codeCli'
import type { ComponentProps } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  extractConnectionFromCliConfigDraft,
  gatewayExpectedModel,
  readCliConfigFiles,
  resolveCliConfigApplyContext,
  writeCliConfigDraft
} from '../cliConfig'
import type { LaunchDialog } from '../components/LaunchDialog'
import { PROVIDERLESS_CLI_TOOLS } from '../constants/cliTools'
import type { ApiGatewayProviderBundle } from './useApiGatewayProvider'
import { useAvailableTerminals } from './useAvailableTerminals'

const logger = loggerService.withContext('useLaunchDialogController')

interface UseLaunchDialogControllerOptions {
  selectedCliTool: CodeCli
  toolName: string
  directory?: string
  enabledProvider?: Provider
  isOwnLoginSelected: boolean
  currentProviderConfig?: CliProviderConfig | null
  selectedTerminal?: string
  /** Synthetic Cherry gateway bundle — used to re-verify/rebuild the gateway config before launch. */
  apiGatewayProvider?: ApiGatewayProviderBundle | null
  upsertProviderConfig: (
    providerId: string,
    partial: Pick<CliProviderConfig, 'modelId'> & Partial<CliProviderConfig>
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
  isOwnLoginSelected,
  currentProviderConfig,
  selectedTerminal,
  apiGatewayProvider,
  upsertProviderConfig,
  setCurrentProvider,
  setTerminal,
  selectFolder
}: UseLaunchDialogControllerOptions): LaunchDialogController {
  const { t } = useTranslation()
  const availableTerminals = useAvailableTerminals()
  const { models } = useModels({ enabled: true })
  const [launchOpen, setLaunchOpen] = useState(false)
  const [launching, setLaunching] = useState(false)

  // The picker displays a fallback terminal before the user has ever chosen one
  // (see LaunchDialog/CurrentConfigPanel); resolve that same fallback here so the
  // launch payload matches what's on screen instead of sending `undefined`.
  const effectiveTerminal = selectedTerminal ?? availableTerminals[0]?.id

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
    // Provider-less tools (qoder/copilot) and the virtual "own login" option both
    // launch with a directory only — no Cherry provider/model is injected.
    const runWithoutProvider = PROVIDERLESS_CLI_TOOLS.has(selectedCliTool) || isOwnLoginSelected
    if (!directory || (!runWithoutProvider && !enabledProvider)) {
      toast.error(t('code.folder_placeholder'))
      return
    }
    if (runWithoutProvider) {
      try {
        setLaunching(true)
        const runResult = await ipcApi.request('code_cli.run', {
          mode: 'own-login',
          cliTool: selectedCliTool,
          directory,
          terminal: effectiveTerminal
        })
        if (!runResult.success) {
          toast.error(runResult.message)
          return
        }
        setLaunchOpen(false)
      } catch (err) {
        logger.error('Failed to launch CLI tool:', err as Error)
        toast.error(t('code.launch.error'))
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
        await upsertProviderConfig(enabledProvider.id, { modelId: null })
      }
      await setCurrentProvider(null)
      toast.error(t('code.launch.validation_error'))
      return
    }

    try {
      setLaunching(true)
      // The gateway may have been stopped or re-keyed/re-ported since "enable" wrote the CLI
      // config; re-verify it's serving and rewrite the config with the fresh context so the
      // CLI never launches against a dead endpoint or a stale key.
      if (enabledProvider && isApiGatewayProviderId(enabledProvider.id) && apiGatewayProvider) {
        const apiKey = await apiGatewayProvider.ensureReady()
        // Respect a foreign/raw config the user saved via the advanced editor: if the on-disk model
        // no longer matches the preferred model, the config was hand-edited — launch it as-is (like
        // real providers) instead of rebuilding from preference and clobbering it. A managed config
        // (model still matches) is still rewritten, to refresh a stale key/port.
        let isForeignConfig = false
        try {
          const files = await readCliConfigFiles(selectedCliTool)
          const onDiskModel = extractConnectionFromCliConfigDraft(selectedCliTool, files)?.model
          const expectedModel = gatewayExpectedModel(
            cliConfigContext.modelId,
            models.find((m) => m.id === cliConfigContext.modelId)?.apiModelId
          )
          isForeignConfig = !!onDiskModel && !!expectedModel && onDiskModel !== expectedModel
        } catch (err) {
          // The foreign-detection read is a non-essential optimization; on failure fall back to the
          // safe default (rewrite, matching pre-gateway behavior) rather than aborting a valid launch.
          logger.warn('Failed to read CLI config for gateway foreign-detection; rewriting', err as Error)
        }
        if (!isForeignConfig) {
          await writeCliConfigDraft({
            cliTool: selectedCliTool,
            modelId: cliConfigContext.modelId,
            configBlob: currentProviderConfig?.config,
            writePrimaryModel: cliConfigContext.writePrimaryModel,
            gateway: { provider: apiGatewayProvider.provider, apiKey }
          })
        }
      }
      const runResult = await ipcApi.request('code_cli.run', {
        mode: 'normal',
        cliTool: selectedCliTool,
        model: cliConfigContext.rawModelId,
        providerId: cliConfigContext.providerId,
        directory,
        terminal: effectiveTerminal
      })
      if (!runResult.success) {
        toast.error(runResult.message)
      } else {
        setLaunchOpen(false)
      }
    } catch (err) {
      logger.error('Failed to launch CLI tool:', err as Error)
      toast.error(t('code.launch.error'))
    } finally {
      setLaunching(false)
    }
  }, [
    currentProviderConfig,
    directory,
    enabledProvider,
    isOwnLoginSelected,
    upsertProviderConfig,
    selectedCliTool,
    effectiveTerminal,
    apiGatewayProvider,
    models,
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
      selectedTerminal: effectiveTerminal,
      onSelectFolder: () => void handleSelectFolder(),
      onSelectTerminal: (terminal) => void setTerminal(terminal),
      onLaunch: () => void handleLaunch(),
      launching
    },
    launching,
    openLaunchDialog: () => setLaunchOpen(true)
  }
}
