import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { ModelSelector } from '@renderer/components/Selector/model'
import { SettingContainer, SettingGroup, SettingHelpText, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { useModelById } from '@renderer/hooks/useModel'
import { getProviderDisplayName, useProviderApiKeys } from '@renderer/hooks/useProvider'
import { useTheme } from '@renderer/hooks/useTheme'
import type { CliConfigConnection, CliConfigFileDraft } from '@renderer/pages/code/cliConfig'
import {
  cliConfigConnectionMatchesProvider,
  extractConfigFromCliConfigDraft,
  extractConnectionFromCliConfigDraft,
  readCliConfigDraft,
  readCliConfigFiles,
  updateCliConfigDraftConfig,
  validateCliConfigDraftForWrite
} from '@renderer/pages/code/cliConfig'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { getProviderHostTopology } from '@shared/utils/providerTopology'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CliConfigEditor } from './CliConfigEditor'
import { ClaudeConfigFields } from './tools/ClaudeConfigFields'
import { CodexConfigFields } from './tools/CodexConfigFields'
import { GeminiConfigFields } from './tools/GeminiConfigFields'
import { KimiConfigFields } from './tools/KimiConfigFields'
import { OpenCodeConfigFields } from './tools/OpenCodeConfigFields'
import { QwenConfigFields } from './tools/QwenConfigFields'

export interface ConfigEditPanelProps {
  open: boolean
  onClose: () => void
  cliTool: CodeCli
  provider: Provider
  providerConfig: CliProviderConfig | null
  isCurrentProvider: boolean
  /** First model for the provider — used as the selector default when no model is saved. */
  defaultModelId: UniqueModelId | undefined
  modelFilter: (model: Model) => boolean
  onSubmit: (values: {
    modelId?: UniqueModelId
    config?: Record<string, unknown>
    cliConfigFiles?: CliConfigFileDraft[]
    cliConfigOnly?: boolean
  }) => Promise<void>
}

export const ConfigEditPanel: FC<ConfigEditPanelProps> = (props) => {
  const { open, onClose, cliTool, provider, providerConfig, isCurrentProvider, defaultModelId, modelFilter, onSubmit } =
    props
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { data: apiKeysData } = useProviderApiKeys(provider.id)

  const [modelId, setModelId] = useState<UniqueModelId | undefined>(undefined)
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [cliConfigFiles, setCliConfigFiles] = useState<CliConfigFileDraft[]>([])
  const [cliConfigError, setCliConfigError] = useState('')
  const [cliConfigSelection, setCliConfigSelection] = useState<CliConfigConnection | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const configRef = useRef<Record<string, unknown>>({})
  const cliConfigFilesRef = useRef<CliConfigFileDraft[]>([])
  const loadIdRef = useRef(0)

  const { model: selectedModelRecord } = useModelById(modelId ?? null)

  const endpointUrl = getProviderHostTopology(provider).primaryBaseUrl
  const displayedProviderName = cliConfigSelection
    ? t('code.cli_config.unknown_provider')
    : getProviderDisplayName(provider)
  const displayedEndpointUrl = cliConfigSelection?.baseUrl ?? endpointUrl

  const connectionMatchesProvider = useCallback(
    (connection: CliConfigConnection | null, expectedModelId = modelId): boolean => {
      const expectedModel =
        expectedModelId && isUniqueModelId(expectedModelId) ? parseUniqueModelId(expectedModelId).modelId : undefined
      return cliConfigConnectionMatchesProvider(cliTool, connection, provider, apiKeysData?.keys, expectedModel)
    },
    [apiKeysData, cliTool, modelId, provider]
  )

  const loadCliConfig = useCallback(
    async (
      nextModelId: UniqueModelId | undefined,
      nextConfig: Record<string, unknown>,
      files?: CliConfigFileDraft[],
      options?: { preserveUnknown?: boolean }
    ) => {
      if (!nextModelId) {
        setCliConfigFiles([])
        cliConfigFilesRef.current = []
        return
      }
      const loadId = ++loadIdRef.current
      try {
        if (options?.preserveUnknown && !files?.length) {
          const rawFiles = await readCliConfigFiles(cliTool)
          const connection = extractConnectionFromCliConfigDraft(cliTool, rawFiles)
          if (connection && !connectionMatchesProvider(connection, nextModelId)) {
            if (loadId !== loadIdRef.current) return
            setCliConfigSelection(connection)
            setCliConfigError('')
            setCliConfigFiles(rawFiles)
            cliConfigFilesRef.current = rawFiles
            const nextDraftConfig = extractConfigFromCliConfigDraft(cliTool, rawFiles)
            if (nextDraftConfig) {
              setConfig(nextDraftConfig)
              configRef.current = nextDraftConfig
            }
            return
          }
          if (!rawFiles.length) {
            if (loadId !== loadIdRef.current) return
            setCliConfigFiles([])
            cliConfigFilesRef.current = []
            setCliConfigError('')
            return
          }
        }
        const nextFiles = await readCliConfigDraft({
          cliTool,
          modelId: nextModelId,
          configBlob: nextConfig,
          files
        })
        if (loadId !== loadIdRef.current) return
        setCliConfigError('')
        setCliConfigFiles(nextFiles)
        cliConfigFilesRef.current = nextFiles
      } catch (error) {
        if (loadId !== loadIdRef.current) return
        setCliConfigError(error instanceof Error ? error.message : String(error))
      }
    },
    [cliTool, connectionMatchesProvider]
  )

  useEffect(() => {
    if (!open) return
    const saved = providerConfig && isUniqueModelId(providerConfig.modelId) ? providerConfig.modelId : undefined
    const nextModelId = saved ?? defaultModelId
    const nextConfig = providerConfig?.config ?? {}
    setModelId(nextModelId)
    setConfig(nextConfig)
    setCliConfigSelection(null)
    setCliConfigError('')
    configRef.current = nextConfig
    void loadCliConfig(nextModelId, nextConfig, undefined, { preserveUnknown: isCurrentProvider })
  }, [open, providerConfig, defaultModelId, isCurrentProvider, loadCliConfig])

  const canSubmit = cliConfigSelection ? cliConfigFiles.length > 0 && !cliConfigError : !!modelId && !cliConfigError

  const renderModelTrigger = () => (
    <button
      type="button"
      className="group flex h-9 w-full items-center justify-between rounded-lg border border-border bg-muted/30 px-3 text-sm transition-colors hover:bg-muted/50">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {selectedModelRecord ? (
          <>
            <ModelAvatar model={selectedModelRecord} size={18} />
            <span className="truncate text-foreground">{selectedModelRecord.name || selectedModelRecord.id}</span>
          </>
        ) : modelId && isUniqueModelId(modelId) ? (
          <span className="truncate text-foreground">{parseUniqueModelId(modelId).modelId}</span>
        ) : (
          <span className="truncate text-muted-foreground/50">{t('code.model_placeholder')}</span>
        )}
      </div>
      <ChevronDown
        size={12}
        className="ml-2 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
      />
    </button>
  )

  const endpointRow: ReactNode = (
    <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-accent/15 px-3 py-2">
      <span
        className={
          cliConfigSelection ? 'h-2 w-2 shrink-0 rounded-full bg-warning' : 'h-2 w-2 shrink-0 rounded-full bg-success'
        }
      />
      <span className="shrink-0 font-medium text-foreground text-xs">{displayedProviderName}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/45">
        {displayedEndpointUrl || t('code.endpoint_default')}
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground/45">{t('code.endpoint_hint')}</span>
    </div>
  )

  const modelSlot: ReactNode = cliConfigSelection ? (
    <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
      <div className="font-medium text-warning text-xs">{t('code.cli_config.unknown_provider')}</div>
      <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
        {cliConfigSelection.model || t('code.cli_config.unknown_model')}
      </div>
    </div>
  ) : (
    <>
      <ModelSelector
        multiple={false}
        selectionType="id"
        value={modelId}
        onSelect={(nextModelId) => {
          setModelId(nextModelId)
          if (nextModelId) void loadCliConfig(nextModelId, configRef.current, cliConfigFilesRef.current)
        }}
        filter={modelFilter}
        showTagFilter
        trigger={renderModelTrigger()}
      />
      <SettingHelpText className="mt-2">{t('code.model_hint_config')}</SettingHelpText>
    </>
  )

  const handleConfigChange = useCallback(
    (nextConfig: Record<string, unknown>) => {
      setConfig(nextConfig)
      configRef.current = nextConfig
      if (cliConfigSelection) {
        try {
          const nextFiles = updateCliConfigDraftConfig(cliTool, cliConfigFilesRef.current, nextConfig)
          setCliConfigError('')
          setCliConfigFiles(nextFiles)
          cliConfigFilesRef.current = nextFiles
        } catch (error) {
          setCliConfigError(error instanceof Error ? error.message : String(error))
        }
      } else {
        void loadCliConfig(modelId, nextConfig, cliConfigFilesRef.current)
      }
    },
    [cliConfigSelection, cliTool, loadCliConfig, modelId]
  )

  const handleCliConfigFilesChange = useCallback(
    (files: CliConfigFileDraft[]) => {
      setCliConfigFiles(files)
      cliConfigFilesRef.current = files
      try {
        validateCliConfigDraftForWrite(files)
        setCliConfigError('')
      } catch (error) {
        setCliConfigError(error instanceof Error ? error.message : String(error))
        return
      }

      const connection = extractConnectionFromCliConfigDraft(cliTool, files)
      if (connection && !connectionMatchesProvider(connection)) {
        setCliConfigSelection(connection)
      } else {
        setCliConfigSelection(null)
        if (connection?.model) {
          setModelId(`${provider.id}::${connection.model}` as UniqueModelId)
        }
      }

      const nextConfig = extractConfigFromCliConfigDraft(cliTool, files)
      if (nextConfig) {
        setConfig(nextConfig)
        configRef.current = nextConfig
      }
    },
    [cliTool, connectionMatchesProvider, provider.id]
  )

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    try {
      setSubmitting(true)
      if (cliConfigSelection) {
        await onSubmit({ modelId, cliConfigFiles, cliConfigOnly: true })
      } else if (modelId) {
        await onSubmit({ modelId, config, cliConfigFiles })
      }
      onClose()
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, cliConfigSelection, modelId, onSubmit, cliConfigFiles, config, onClose])

  const toolFields: ReactNode = (() => {
    switch (cliTool) {
      case CodeCli.CLAUDE_CODE:
        return <ClaudeConfigFields config={config} onChange={handleConfigChange} />
      case CodeCli.OPENAI_CODEX:
        return <CodexConfigFields config={config} onChange={handleConfigChange} />
      case CodeCli.OPEN_CODE:
        return <OpenCodeConfigFields config={config} onChange={handleConfigChange} />
      case CodeCli.GEMINI_CLI:
        return <GeminiConfigFields config={config} onChange={handleConfigChange} />
      case CodeCli.QWEN_CODE:
        return <QwenConfigFields config={config} onChange={handleConfigChange} />
      case CodeCli.KIMI_CODE:
        return <KimiConfigFields config={config} onChange={handleConfigChange} />
      default:
        return null
    }
  })()

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent
        size="lg"
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle>{t('code.configuring_provider', { provider: getProviderDisplayName(provider) })}</DialogTitle>
        </DialogHeader>

        <SettingContainer theme={theme} style={{ background: 'transparent' }} className="gap-5">
          {endpointRow}
          <SettingGroup theme={theme} className="border-t-0 pt-0">
            <SettingTitle className="mb-2.5">{t('code.model')}</SettingTitle>
            {modelSlot}
          </SettingGroup>
          {toolFields && (
            <SettingGroup theme={theme} className="border-t-0 pt-0">
              <SettingTitle className="mb-2.5">{t('code.tool_parameters')}</SettingTitle>
              {toolFields}
            </SettingGroup>
          )}
          {cliConfigFiles.length > 0 && (
            <SettingGroup theme={theme} className="border-t-0 pt-0">
              <CliConfigEditor files={cliConfigFiles} error={cliConfigError} onChange={handleCliConfigFilesChange} />
            </SettingGroup>
          )}
        </SettingContainer>

        <DialogFooter className="justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="default" size="sm" onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
