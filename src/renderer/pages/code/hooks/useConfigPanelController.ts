import { loggerService } from '@renderer/services/LoggerService'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CLI_OWN_LOGIN_PROVIDER_ID, type CodeCli } from '@shared/types/codeCli'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  clearCliConfig,
  type CliConfigConnection,
  type CliConfigFileDraft,
  extractConnectionFromCliConfigDraft,
  isOwnLoginConfigurable,
  parseConfiguredModelId,
  resolveCliConfigApplyContext,
  sanitizeCliConfigBlob,
  writeCliConfigDraft,
  writeOwnLoginCliConfigDraft
} from '../cliConfig'
import type { OwnLoginConfigPanelProps } from '../components/configEditPanel/OwnLoginConfigPanel'
import type { ConfigEditPanelProps, ConfigEditPanelSubmitValues } from '../components/configEditPanel/types'

const logger = loggerService.withContext('useConfigPanelController')

interface UseConfigPanelControllerOptions {
  selectedCliTool: CodeCli
  toolName: string
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
  ownLoginConfigPanelProps?: OwnLoginConfigPanelProps
  openConfigurePanel: (provider: Provider) => void
  onToggleCurrent: (provider: Provider) => void
}

export function useConfigPanelController({
  selectedCliTool,
  toolName,
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
  // Tracks tools with an in-flight enable/disable. writeCliConfigDraft / clearCliConfig write multiple
  // files sequentially with snapshot rollback and no cross-file lock, so a rapid second toggle for the
  // same tool could interleave the two operations' reads/writes and leave its config files inconsistent.
  const inFlightToolsRef = useRef<Set<CodeCli>>(new Set())

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
      // Ignore a re-entrant toggle for the same tool while its config write/clear is still running.
      if (inFlightToolsRef.current.has(selectedCliTool)) return
      inFlightToolsRef.current.add(selectedCliTool)
      const isEnabling = currentProviderId !== provider.id
      void (async () => {
        // Virtual "own login" entry: the CLI falls back to its own stored login. Always scrub the
        // Cherry-managed credentials/model first (this also clears credential-only side files like
        // Codex auth.json / Gemini .env), then — for configurable tools on select — layer the saved
        // tool params back on. Finally mark the reserved id current (or clear it when re-toggled).
        if (provider.id === CLI_OWN_LOGIN_PROVIDER_ID) {
          try {
            await clearCliConfig({ cliTool: selectedCliTool })
            if (isEnabling && isOwnLoginConfigurable(selectedCliTool)) {
              await writeOwnLoginCliConfigDraft({
                cliTool: selectedCliTool,
                configBlob: providerConfigs[CLI_OWN_LOGIN_PROVIDER_ID]?.config
              })
            }
          } catch (err) {
            logger.error('Failed to apply CLI config on own-login toggle:', err as Error)
            window.toast.error(t('code.apply_failed'))
          }
          await setCurrentProvider(isEnabling ? CLI_OWN_LOGIN_PROVIDER_ID : null)
          setCurrentCliConfigConnection(null)
          return
        }
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
      setCurrentCliConfigConnection,
      t
    ]
  )

  const handleOwnLoginSubmit = useCallback(
    async (values: { config: Record<string, unknown>; cliConfigFiles?: CliConfigFileDraft[] }) => {
      const sanitizedConfig = sanitizeCliConfigBlob(selectedCliTool, values.config)
      await upsertProviderConfig(CLI_OWN_LOGIN_PROVIDER_ID, { modelId: '', config: sanitizedConfig })
      logger.info('Updated own-login config', { toolId: selectedCliTool })

      // Re-apply to the CLI config file when own login is the active selection. Hand-edited raw
      // files (if any) are written verbatim; otherwise the file is rebuilt from the tool params.
      if (currentProviderId === CLI_OWN_LOGIN_PROVIDER_ID) {
        try {
          await writeOwnLoginCliConfigDraft({
            cliTool: selectedCliTool,
            configBlob: sanitizedConfig,
            files: values.cliConfigFiles
          })
          setCurrentCliConfigConnection(null)
        } catch (err) {
          logger.error('Failed to inject own-login config on edit:', err as Error)
          window.toast.error(t('code.apply_failed'))
        }
      }
    },
    [selectedCliTool, currentProviderId, upsertProviderConfig, setCurrentCliConfigConnection, t]
  )

  const isEditingOwnLogin = editingProvider?.id === CLI_OWN_LOGIN_PROVIDER_ID

  return {
    configPanelKey: editingProvider ? `${selectedCliTool}:${editingProvider.id}` : undefined,
    configPanelProps:
      editingProvider && !isEditingOwnLogin
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
    ownLoginConfigPanelProps:
      editingProvider && isEditingOwnLogin
        ? {
            onClose: closePanel,
            cliTool: selectedCliTool,
            toolName,
            providerConfig: providerConfigs[CLI_OWN_LOGIN_PROVIDER_ID] ?? null,
            onSubmit: handleOwnLoginSubmit
          }
        : undefined,
    openConfigurePanel,
    onToggleCurrent: handleToggleCurrent
  }
}
