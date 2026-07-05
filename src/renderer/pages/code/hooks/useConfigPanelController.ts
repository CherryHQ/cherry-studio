import { loggerService } from '@renderer/services/LoggerService'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { CodeCli } from '@shared/types/codeCli'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { parseConfiguredModelId, resolveCliConfigApplyContext } from '../cliConfig/applyContext'
import { clearCliConfig } from '../cliConfig/clear'
import { writeCliConfigDraft } from '../cliConfig/draft'
import { extractConnectionFromCliConfigDraft } from '../cliConfig/parser'
import { sanitizeCliConfigBlob } from '../cliConfig/sanitize'
import type { CliConfigConnection } from '../cliConfig/types'
import type { ConfigEditPanelProps, ConfigEditPanelSubmitValues } from '../components/configEditPanel/types'

const logger = loggerService.withContext('useConfigPanelController')

interface UseConfigPanelControllerOptions {
  selectedCliTool: CodeCli
  currentProviderId: string | null
  providerConfigs: Record<string, CliProviderConfig>
  upsertProviderConfig: (
    providerId: string,
    partial: { modelId: string } & Partial<CliProviderConfig>
  ) => Promise<string>
  setCurrentProvider: (providerId: string | null) => Promise<void>
  setCurrentCliConfigConnection: (connection: CliConfigConnection | null) => void
  makeModelFilter: (providerId: string) => (model: Model) => boolean
}

interface ConfigPanelController {
  configPanelKey?: string
  configPanelProps?: ConfigEditPanelProps
  openConfigurePanel: (provider: Provider) => void
  onToggleCurrent: (provider: Provider) => void
}

export function useConfigPanelController({
  selectedCliTool,
  currentProviderId,
  providerConfigs,
  upsertProviderConfig,
  setCurrentProvider,
  setCurrentCliConfigConnection,
  makeModelFilter
}: UseConfigPanelControllerOptions): ConfigPanelController {
  const { t } = useTranslation()
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  const pendingEnableProviderIdRef = useRef<string | null>(null)

  const openConfigurePanel = useCallback((provider: Provider) => {
    pendingEnableProviderIdRef.current = null
    setEditingProvider(provider)
  }, [])

  const closePanel = useCallback(() => {
    pendingEnableProviderIdRef.current = null
    setEditingProvider(null)
  }, [])

  const handlePanelSubmit = useCallback(
    async (values: ConfigEditPanelSubmitValues) => {
      if (!editingProvider) return
      const hasModelValue = 'modelId' in values
      const modelId = values.modelId ?? (hasModelValue ? '' : (providerConfigs[editingProvider.id]?.modelId ?? ''))
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
          await upsertProviderConfig(editingProvider.id, {
            modelId,
            ...configPatch
          })
        }
        setCurrentCliConfigConnection(extractConnectionFromCliConfigDraft(selectedCliTool, files))
        logger.info('Updated CLI config file draft', { toolId: selectedCliTool })
        return
      }

      const shouldEnableAfterSave = pendingEnableProviderIdRef.current === editingProvider.id
      if (hasModelValue || hasConfigValue) {
        await upsertProviderConfig(editingProvider.id, {
          modelId,
          ...configPatch
        })
      }
      logger.info('Updated CLI provider config', { toolId: selectedCliTool, providerId: editingProvider.id })

      const resolvedCliConfigContext = resolveCliConfigApplyContext(selectedCliTool, editingProvider.id, {
        modelId,
        config: sanitizedConfig ?? providerConfigs[editingProvider.id]?.config
      })
      const cliConfigModelId = values.cliConfigModelId ?? resolvedCliConfigContext?.modelId
      const writePrimaryModel = values.writePrimaryModel ?? resolvedCliConfigContext?.writePrimaryModel
      if (!cliConfigModelId) return

      // Re-apply to the CLI config file when editing the currently active provider.
      if (currentProviderId === editingProvider.id || shouldEnableAfterSave) {
        try {
          await writeCliConfigDraft({
            cliTool: selectedCliTool,
            modelId: cliConfigModelId,
            configBlob: sanitizedConfig,
            files: values.cliConfigFiles,
            writePrimaryModel
          })
          if (shouldEnableAfterSave) {
            await setCurrentProvider(editingProvider.id)
          }
          setCurrentCliConfigConnection(null)
        } catch (err) {
          logger.error('Failed to inject CLI config on edit:', err as Error)
          window.toast.error(t('code.apply_failed'))
        }
      }
    },
    [
      editingProvider,
      selectedCliTool,
      currentProviderId,
      providerConfigs,
      upsertProviderConfig,
      setCurrentProvider,
      setCurrentCliConfigConnection,
      t
    ]
  )

  const handleToggleCurrent = useCallback(
    (provider: Provider) => {
      const isEnabling = currentProviderId !== provider.id
      void (async () => {
        if (!isEnabling) {
          try {
            await clearCliConfig({ cliTool: selectedCliTool })
          } catch (err) {
            logger.error('Failed to clear CLI config on disable:', err as Error)
            window.toast.error(t('code.apply_failed'))
          }
          await setCurrentProvider(null)
          setCurrentCliConfigConnection(null)
          return
        }

        // Ensure the provider has a model before injecting. If none is saved,
        // open configuration so the user chooses explicitly.
        const cfg = providerConfigs[provider.id]
        const cliConfigContext = resolveCliConfigApplyContext(selectedCliTool, provider.id, cfg)
        if (cfg?.modelId && !parseConfiguredModelId(cfg.modelId) && !cliConfigContext) {
          await upsertProviderConfig(provider.id, { modelId: '' })
          pendingEnableProviderIdRef.current = provider.id
          setEditingProvider(provider)
          window.toast.error(t('code.launch.validation_error'))
          return
        }
        if (!cliConfigContext) {
          pendingEnableProviderIdRef.current = provider.id
          setEditingProvider(provider)
          return
        }

        // Inject first; only mark as current on success so the UI never shows a
        // provider as active while its CLI config file failed to write.
        try {
          await writeCliConfigDraft({
            cliTool: selectedCliTool,
            modelId: cliConfigContext.modelId,
            configBlob: cfg?.config,
            writePrimaryModel: cliConfigContext.writePrimaryModel
          })
          await setCurrentProvider(provider.id)
          setCurrentCliConfigConnection(null)
        } catch (err) {
          logger.error('Failed to inject CLI config on enable:', err as Error)
          window.toast.error(t('code.apply_failed'))
        }
      })()
    },
    [
      currentProviderId,
      selectedCliTool,
      providerConfigs,
      upsertProviderConfig,
      setCurrentProvider,
      setCurrentCliConfigConnection,
      t
    ]
  )

  return {
    configPanelKey: editingProvider ? `${selectedCliTool}:${editingProvider.id}` : undefined,
    configPanelProps: editingProvider
      ? {
          onClose: closePanel,
          cliTool: selectedCliTool,
          provider: editingProvider,
          providerConfig: providerConfigs[editingProvider.id] ?? null,
          isCurrentProvider: currentProviderId === editingProvider.id,
          modelFilter: makeModelFilter(editingProvider.id),
          onSubmit: handlePanelSubmit
        }
      : undefined,
    openConfigurePanel,
    onToggleCurrent: handleToggleCurrent
  }
}
