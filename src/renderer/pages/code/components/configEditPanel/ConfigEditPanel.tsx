import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { ModelSelector } from '@renderer/components/Selector/model'
import { useModelById } from '@renderer/hooks/useModel'
import { getProviderDisplayName } from '@renderer/hooks/useProvider'
import { useTheme } from '@renderer/hooks/useTheme'
import { SettingContainer, SettingGroup, SettingHelpText, SettingTitle } from '@renderer/pages/settings'
import type { CliProviderConfig } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId, type Model, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
import { getProviderHostTopology } from '@shared/utils/providerTopology'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ClaudeConfigFields } from './tools/ClaudeConfigFields'
import { CodexConfigFields } from './tools/CodexConfigFields'

export interface ConfigEditPanelProps {
  open: boolean
  onClose: () => void
  cliTool: CodeCli
  provider: Provider
  providerConfig: CliProviderConfig | null
  /** First model for the provider — used as the selector default when no model is saved. */
  defaultModelId: UniqueModelId | undefined
  modelFilter: (model: Model) => boolean
  onSubmit: (values: { modelId: UniqueModelId; config?: Record<string, unknown> }) => Promise<void>
}

export const ConfigEditPanel: FC<ConfigEditPanelProps> = (props) => {
  const { open, onClose, cliTool, provider, providerConfig, defaultModelId, modelFilter, onSubmit } = props
  const { t } = useTranslation()
  const { theme } = useTheme()

  const [modelId, setModelId] = useState<UniqueModelId | undefined>(undefined)
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    const saved = providerConfig && isUniqueModelId(providerConfig.modelId) ? providerConfig.modelId : undefined
    setModelId(saved ?? defaultModelId)
    setConfig(providerConfig?.config ?? {})
  }, [open, providerConfig, defaultModelId])

  const { model: selectedModelRecord } = useModelById(modelId ?? null)

  const endpointUrl = getProviderHostTopology(provider).primaryBaseUrl

  const canSubmit = !!modelId

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
      <span className="h-2 w-2 shrink-0 rounded-full bg-success" />
      <span className="shrink-0 text-xs font-medium text-foreground">{getProviderDisplayName(provider)}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/45">
        {endpointUrl || t('code.endpoint_default')}
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground/45">{t('code.endpoint_hint')}</span>
    </div>
  )

  const modelSlot: ReactNode = (
    <>
      <ModelSelector
        multiple={false}
        selectionType="id"
        value={modelId}
        onSelect={setModelId}
        filter={modelFilter}
        showTagFilter
        trigger={renderModelTrigger()}
      />
      <SettingHelpText className="mt-2">{t('code.model_hint_config')}</SettingHelpText>
    </>
  )

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !modelId) return
    try {
      setSubmitting(true)
      await onSubmit({ modelId, config })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, modelId, config, onSubmit, onClose])

  const toolFields: ReactNode = (() => {
    switch (cliTool) {
      case CodeCli.CLAUDE_CODE:
        return <ClaudeConfigFields config={config} onChange={setConfig} />
      case CodeCli.OPENAI_CODEX:
        return <CodexConfigFields config={config} onChange={setConfig} />
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
