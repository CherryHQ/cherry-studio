import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ApiGatewayProviderBundle } from '@renderer/hooks/useApiGatewayProvider'
import {
  clearCliConfig,
  parseConfiguredModelId,
  resolveCliConfigApplyContext,
  writeCliConfigDraft
} from '@renderer/services/codeCliConfig'
import { isModelConfiguredCli } from '@renderer/services/codeCliConfig'
import { loggerService } from '@renderer/services/LoggerService'
import { toast } from '@renderer/services/toast'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli, isApiGatewayProviderId } from '@shared/types/codeCli'
import { type CliConfigGatewayContext, sanitizeCliConfigBlob } from '@shared/utils/cliConfig'

import type { ConfigEditPanelProps, ConfigEditPanelSubmitValues } from '../components/configEditPanel/types'

const logger = loggerService.withContext('useConfigPanelController')

interface UseConfigPanelControllerOptions {
  selectedCliTool: CodeCli
  currentProviderId: string | null
  providerConfigs: Record<string, CliProviderConfig>
  upsertProviderConfig: (
    providerId: string,
    partial: Pick<CliProviderConfig, 'modelId'> & Partial<CliProviderConfig>
  ) => Promise<string>
  deleteProviderConfig: (providerId: string) => Promise<void>
  setCurrentProvider: (providerId: string | null) => Promise<void>
  makeModelFilter: (providerId: string) => (model: Model) => boolean
  /** Synthetic Cherry gateway bundle (null when the gateway config is unavailable). */
  apiGatewayProvider?: ApiGatewayProviderBundle | null
  gatewayModelsById?: Map<UniqueModelId, Model>
  /** True while either query backing `gatewayModelsById` is still in flight. */
  isGatewayModelsLoading?: boolean
}

interface ConfigPanelController {
  configPanelKey?: string
  configPanelProps?: ConfigEditPanelProps
  openConfigurePanel: (provider: Provider) => void
  onToggleCurrent: (provider: Provider) => void
  selectModel: (provider: Provider, modelId: UniqueModelId) => Promise<boolean>
}

export function useConfigPanelController({
  selectedCliTool,
  currentProviderId,
  providerConfigs,
  upsertProviderConfig,
  deleteProviderConfig,
  setCurrentProvider,
  makeModelFilter,
  apiGatewayProvider,
  gatewayModelsById,
  isGatewayModelsLoading
}: UseConfigPanelControllerOptions): ConfigPanelController {
  const { t } = useTranslation()
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  const [panelSession, setPanelSession] = useState(0)
  const pendingEnableProviderIdRef = useRef<string | null>(null)
  const writesCliConfig =
    isModelConfiguredCli(selectedCliTool) ||
    selectedCliTool === CodeCli.OPENCLAW ||
    selectedCliTool === CodeCli.DEEPSEEK_HARNESS

  // CLI files receive the gateway key while upstream credentials stay in Cherry.
  const resolveGatewayWriteContext = useCallback(
    async (providerId: string): Promise<CliConfigGatewayContext | undefined> => {
      if (!writesCliConfig || !isApiGatewayProviderId(providerId) || !apiGatewayProvider) {
        return undefined
      }
      await apiGatewayProvider.ensureRunning()
      const apiKey = await apiGatewayProvider.getApiKey()
      return { provider: apiGatewayProvider.provider, apiKey }
    },
    [apiGatewayProvider, writesCliConfig]
  )
  // Prevent a second action from interleaving multi-file writes and rollback.
  const inFlightToolsRef = useRef<Set<CodeCli>>(new Set())

  const openConfigurePanel = useCallback((provider: Provider) => {
    pendingEnableProviderIdRef.current = null
    setPanelSession((current) => current + 1)
    setEditingProvider(provider)
  }, [])

  const closePanel = useCallback(() => {
    pendingEnableProviderIdRef.current = null
    setEditingProvider(null)
  }, [])

  const applyProviderConfig = useCallback(
    async (provider: Provider, values: ConfigEditPanelSubmitValues, enable = false) => {
      const hasModelValue = 'modelId' in values
      const modelId = values.modelId ?? (hasModelValue ? null : (providerConfigs[provider.id]?.modelId ?? null))
      const hasConfigValue = 'config' in values
      const sanitizedConfig = hasConfigValue ? sanitizeCliConfigBlob(selectedCliTool, values.config ?? {}) : undefined
      const configPatch = hasConfigValue ? { config: sanitizedConfig ?? {} } : {}

      if (values.cliConfigOnly) {
        if (!values.cliConfigFiles?.length) {
          throw new Error('Cannot save CLI config without config files')
        }
        const files = values.cliConfigFiles
        await writeCliConfigDraft({
          cliTool: selectedCliTool,
          files
        })
        if (hasModelValue || hasConfigValue) {
          await upsertProviderConfig(provider.id, {
            modelId,
            ...configPatch
          })
        }
        logger.info('Updated CLI config file draft', { toolId: selectedCliTool })
        return
      }

      const shouldEnableAfterSave = enable || pendingEnableProviderIdRef.current === provider.id
      const resolvedCliConfigContext = resolveCliConfigApplyContext(
        selectedCliTool,
        provider.id,
        {
          modelId,
          config: sanitizedConfig ?? providerConfigs[provider.id]?.config
        },
        isApiGatewayProviderId(provider.id) ? gatewayModelsById : undefined
      )
      const cliConfigModelId = values.cliConfigModelId ?? resolvedCliConfigContext?.modelId
      const writePrimaryModel = values.writePrimaryModel ?? resolvedCliConfigContext?.writePrimaryModel
      if (isApiGatewayProviderId(provider.id) && writePrimaryModel === false && !cliConfigModelId) {
        throw new Error('Cannot resolve the detailed gateway model')
      }
      const shouldApplyCliConfig = writesCliConfig && (currentProviderId === provider.id || shouldEnableAfterSave)
      // Preference and the external CLI files are one user-visible config. The active provider owns
      // the current files, so with nothing addressing a model the write below is skipped and
      // persisting anyway would strand the files on their previous contents (e.g. flipping Claude's
      // detailed mode back to common without picking a model). Reject instead of half-saving.
      // Only the active provider is at risk: any other provider owns no files to diverge from, and
      // an enable-on-save that resolves no model simply leaves it disabled with its params stored.
      if (currentProviderId === provider.id && !cliConfigModelId) {
        throw new Error('Cannot apply a CLI config without a model')
      }
      const previousProviderConfig = providerConfigs[provider.id]
      let providerConfigPersisted = false
      if (hasModelValue || hasConfigValue) {
        await upsertProviderConfig(provider.id, {
          modelId,
          ...configPatch
        })
        providerConfigPersisted = true
      }
      logger.info('Updated CLI provider config', { toolId: selectedCliTool, providerId: provider.id })
      if (!cliConfigModelId) return
      if (!shouldApplyCliConfig) {
        if (shouldEnableAfterSave) {
          await setCurrentProvider(provider.id)
        }
        return
      }

      try {
        const gateway = isApiGatewayProviderId(provider.id) ? await resolveGatewayWriteContext(provider.id) : undefined
        await writeCliConfigDraft({
          cliTool: selectedCliTool,
          modelId: cliConfigModelId,
          configBlob: sanitizedConfig,
          files: values.cliConfigFiles,
          writePrimaryModel,
          gateway
        })
      } catch (err) {
        logger.error('Failed to inject CLI config on edit:', err as Error)
        // Preference and the external CLI files form one user-visible config. Restore the saved
        // provider snapshot when the external write fails so the UI cannot advertise unapplied values.
        if (providerConfigPersisted) {
          try {
            if (previousProviderConfig) {
              await upsertProviderConfig(provider.id, {
                modelId: previousProviderConfig.modelId,
                config: previousProviderConfig.config,
                ...(previousProviderConfig.sortIndex !== undefined
                  ? { sortIndex: previousProviderConfig.sortIndex }
                  : {})
              })
            } else {
              await deleteProviderConfig(provider.id)
            }
          } catch (rollbackError) {
            logger.error('Failed to roll back CLI provider config preference:', rollbackError as Error)
          }
        }
        // Rethrow so the submitting dialog keeps the user's draft and stays open.
        throw err
      }
      if (shouldEnableAfterSave) {
        await setCurrentProvider(provider.id)
      }
    },
    [
      selectedCliTool,
      currentProviderId,
      providerConfigs,
      upsertProviderConfig,
      deleteProviderConfig,
      setCurrentProvider,
      resolveGatewayWriteContext,
      gatewayModelsById,
      writesCliConfig
    ]
  )

  const handleToggleCurrent = useCallback(
    (provider: Provider) => {
      const isEnabling = currentProviderId !== provider.id
      if (inFlightToolsRef.current.has(selectedCliTool)) return
      inFlightToolsRef.current.add(selectedCliTool)
      void (async () => {
        if (!isEnabling) {
          try {
            if (writesCliConfig) {
              await clearCliConfig({ cliTool: selectedCliTool })
            }
            // Active state must reflect whether managed credentials were cleared.
            await setCurrentProvider(null)
          } catch (err) {
            logger.error('Failed to clear CLI config on disable:', err as Error)
            toast.error(t('code.apply_failed'))
          }
          return
        }

        // Ensure the provider has a model before injecting. If none is saved,
        // open configuration so the user chooses explicitly.
        const cfg = providerConfigs[provider.id]
        const cliConfigContext = resolveCliConfigApplyContext(
          selectedCliTool,
          provider.id,
          cfg,
          isApiGatewayProviderId(provider.id) ? gatewayModelsById : undefined
        )
        if (cfg?.modelId && !parseConfiguredModelId(cfg.modelId) && !cliConfigContext) {
          await upsertProviderConfig(provider.id, { modelId: null })
          pendingEnableProviderIdRef.current = provider.id
          setPanelSession((current) => current + 1)
          setEditingProvider(provider)
          toast.error(t('code.launch.validation_error'))
          return
        }
        if (!cliConfigContext) {
          pendingEnableProviderIdRef.current = provider.id
          setPanelSession((current) => current + 1)
          setEditingProvider(provider)
          return
        }

        if (!writesCliConfig) {
          try {
            await setCurrentProvider(provider.id)
          } catch (err) {
            logger.error('Failed to select CLI provider:', err as Error)
            toast.error(t('code.apply_failed'))
          }
          return
        }

        // Inject first; only mark as current on success so the UI never shows a
        // provider as active while its CLI config file failed to write.
        try {
          // Gateway: ensure it's running (generating the key on first start) before injecting.
          // Gated on the id so the real-provider path stays synchronous (no extra await tick).
          const gateway = isApiGatewayProviderId(provider.id)
            ? await resolveGatewayWriteContext(provider.id)
            : undefined
          await writeCliConfigDraft({
            cliTool: selectedCliTool,
            modelId: cliConfigContext.modelId,
            configBlob: cfg?.config,
            writePrimaryModel: cliConfigContext.writePrimaryModel,
            gateway
          })
          await setCurrentProvider(provider.id)
          if (gateway) toast.info(t('code.api_gateway.requires_running'))
        } catch (err) {
          logger.error('Failed to inject CLI config on enable:', err as Error)
          toast.error(t('code.apply_failed'))
        }
      })().finally(() => {
        inFlightToolsRef.current.delete(selectedCliTool)
      })
    },
    [
      currentProviderId,
      selectedCliTool,
      providerConfigs,
      upsertProviderConfig,
      setCurrentProvider,
      resolveGatewayWriteContext,
      gatewayModelsById,
      writesCliConfig,
      t
    ]
  )

  return {
    configPanelKey: editingProvider ? `${selectedCliTool}:${editingProvider.id}:${panelSession}` : undefined,
    configPanelProps: editingProvider
      ? {
          onClose: closePanel,
          cliTool: selectedCliTool,
          provider: editingProvider,
          providerConfig: providerConfigs[editingProvider.id] ?? null,
          isCurrentProvider: currentProviderId === editingProvider.id,
          modelFilter: makeModelFilter(editingProvider.id),
          // Preview key only (may be null before first start); the actual write reads the configured key.
          gateway:
            isApiGatewayProviderId(editingProvider.id) && apiGatewayProvider
              ? { provider: apiGatewayProvider.provider, apiKey: apiGatewayProvider.apiKey ?? '' }
              : undefined,
          gatewayModels: isApiGatewayProviderId(editingProvider.id) ? gatewayModelsById : undefined,
          isGatewayModelsLoading: isApiGatewayProviderId(editingProvider.id) ? isGatewayModelsLoading : false,
          onSubmit: (values) => applyProviderConfig(editingProvider, values)
        }
      : undefined,
    openConfigurePanel,
    selectModel: async (provider, modelId) => {
      if (inFlightToolsRef.current.has(selectedCliTool)) return false
      inFlightToolsRef.current.add(selectedCliTool)
      try {
        await applyProviderConfig(provider, { modelId }, true)
        return true
      } catch (error) {
        logger.error('Failed to select CLI model', error as Error)
        toast.error(t('code.apply_failed'))
        return false
      } finally {
        inFlightToolsRef.current.delete(selectedCliTool)
      }
    },
    onToggleCurrent: handleToggleCurrent
  }
}
