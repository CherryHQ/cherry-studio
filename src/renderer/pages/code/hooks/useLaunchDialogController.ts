import { ipcApi } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { type CodeCli, isApiGatewayProviderId } from '@shared/types/codeCli'
import type { ComponentProps } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type CliConfigFileDraft,
  extractConfigFromCliConfigDraft,
  extractConnectionFromCliConfigDraft,
  gatewayExpectedModel,
  gatewayModelIdFromAddress,
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
  /** Models currently available through the gateway, keyed by UniqueModelId. */
  gatewayModelsById: Map<UniqueModelId, Model>
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
  gatewayModelsById,
  upsertProviderConfig,
  setCurrentProvider,
  setTerminal,
  selectFolder
}: UseLaunchDialogControllerOptions): LaunchDialogController {
  const { t } = useTranslation()
  const availableTerminals = useAvailableTerminals()
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
        let onDiskFiles: CliConfigFileDraft[] | undefined
        try {
          onDiskFiles = await readCliConfigFiles(selectedCliTool)
        } catch (err) {
          // Reading is only needed to preserve a raw gateway model. If it fails, rebuild the managed
          // config from preference so launch still uses the current gateway connection.
          logger.warn('Failed to read CLI config for gateway reconciliation; rewriting', err as Error)
        }

        let modelId = cliConfigContext.modelId
        let configBlob = currentProviderConfig?.config
        let mergeFiles: CliConfigFileDraft[] | undefined
        if (onDiskFiles) {
          const onDiskModel = extractConnectionFromCliConfigDraft(selectedCliTool, onDiskFiles)?.model
          const expectedModel = gatewayExpectedModel(
            cliConfigContext.modelId,
            gatewayModelsById.get(cliConfigContext.modelId)?.apiModelId
          )
          if (onDiskModel && expectedModel && onDiskModel !== expectedModel) {
            const onDiskModelId = gatewayModelIdFromAddress(onDiskModel, gatewayModelsById)
            if (!onDiskModelId) {
              throw new Error(`Cannot resolve gateway model from CLI config: ${onDiskModel}`)
            }
            modelId = onDiskModelId
            configBlob = extractConfigFromCliConfigDraft(selectedCliTool, onDiskFiles) ?? configBlob
            mergeFiles = onDiskFiles
          }
        }
        if (!gatewayModelsById.has(modelId)) {
          throw new Error(`Gateway model is no longer available: ${modelId}`)
        }
        await writeCliConfigDraft({
          cliTool: selectedCliTool,
          modelId,
          configBlob,
          ...(mergeFiles ? { files: mergeFiles } : {}),
          writePrimaryModel: cliConfigContext.writePrimaryModel,
          gateway: { provider: apiGatewayProvider.provider, apiKey }
        })
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
    gatewayModelsById,
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
