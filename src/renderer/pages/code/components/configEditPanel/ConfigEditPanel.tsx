import { Button, Dialog, DialogContent, DialogFooter, DialogTitle, Input } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { ModelSelector } from '@renderer/components/Selector/model'
import { useModelById } from '@renderer/hooks/useModel'
import { getProviderDisplayName, useProviders } from '@renderer/hooks/useProvider'
import type { CliNamedConfig } from '@shared/data/preference/preferenceTypes'
import type { EndpointType, Model } from '@shared/data/types/model'
import { isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { codeCLI } from '@shared/types/codeCli'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CLI_TOOLS, getCodeCliApiBaseUrl } from '../../cliTools'
import { CLIIcon } from '../CLIIcon'
import { FormField, Section } from './PanelPrimitives'
import { ClaudeConfigFields } from './tools/ClaudeConfigFields'
import { CodexConfigFields } from './tools/CodexConfigFields'
import { HermesConfigFields } from './tools/HermesConfigFields'
import { OpenclawConfigFields } from './tools/OpenclawConfigFields'
import { OpenCodeConfigFields } from './tools/OpenCodeConfigFields'

export interface ConfigEditPanelProps {
  open: boolean
  onClose: () => void
  cliTool: codeCLI
  config: CliNamedConfig | null
  modelFilter: (model: Model) => boolean
  onSubmit: (values: {
    name: string
    providerId: string
    modelId: UniqueModelId
    config?: Record<string, unknown>
  }) => Promise<void>
}

// Short labels for the endpoint-type badge in the provider context bar.
const ENDPOINT_LABEL: Partial<Record<EndpointType, string>> = {
  'anthropic-messages': 'Anthropic',
  'openai-chat-completions': 'OpenAI',
  'openai-responses': 'Responses'
}

export const ConfigEditPanel: FC<ConfigEditPanelProps> = (props) => {
  const { open, onClose, cliTool, modelFilter, onSubmit } = props
  const { t } = useTranslation()
  const { providers } = useProviders()
  const providerMap = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers])

  const [name, setName] = useState('')
  const [modelId, setModelId] = useState<UniqueModelId | undefined>(undefined)
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [submitting, setSubmitting] = useState(false)

  const toolMeta = useMemo(() => CLI_TOOLS.find((ti) => ti.value === cliTool), [cliTool])

  // Initialize form fields on open / config change.
  useEffect(() => {
    if (!open) return
    if (props.config) {
      setName(props.config.name)
      setModelId(isUniqueModelId(props.config.modelId) ? props.config.modelId : undefined)
      setConfig(props.config.config ?? {})
    } else {
      setName('')
      setModelId(undefined)
      setConfig({})
    }
  }, [open, props.config])

  const { model: selectedModelRecord } = useModelById(modelId ?? null)

  // NOTE: the selected model is NOT mirrored into the config blob here.
  // `CodeCliService.resolveAndApplyConfig` injects the model (along with the
  // resolved API key / base URL) at launch time, so the blob stays the user's
  // editing surface and is never clobbered by the model picker.

  const selectedProvider = selectedModelRecord ? providerMap.get(selectedModelRecord.providerId) : undefined

  // Fetch the provider's metadata for the endpoint context bar.
  const providerContext = useMemo(() => {
    if (!selectedProvider) return null
    const anthropicBaseUrl =
      getCodeCliApiBaseUrl(selectedProvider.id, 'anthropic') ??
      selectedProvider.endpointConfigs?.['anthropic-messages']?.baseUrl
    const useAnthropic = cliTool === 'claude-code' && Boolean(anthropicBaseUrl)
    const endpointType = useAnthropic ? 'anthropic-messages' : selectedProvider.defaultChatEndpoint
    const baseUrl = useAnthropic
      ? anthropicBaseUrl
      : endpointType
        ? selectedProvider.endpointConfigs?.[endpointType]?.baseUrl
        : undefined
    return {
      name: getProviderDisplayName(selectedProvider),
      endpointLabel: endpointType ? (ENDPOINT_LABEL[endpointType] ?? endpointType) : undefined,
      baseUrl
    }
  }, [selectedProvider, cliTool])

  const canSubmit = name.trim().length > 0 && !!modelId

  const renderModelTrigger = () => (
    <button
      type="button"
      className="group flex h-9 w-full items-center justify-between rounded-lg border border-border bg-muted/30 px-3 text-sm transition-colors hover:bg-muted/50">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {selectedModelRecord ? (
          <>
            <ModelAvatar model={selectedModelRecord} size={18} />
            <span className="truncate text-foreground">{selectedModelRecord.name || selectedModelRecord.id}</span>
            {selectedProvider && (
              <span className="shrink-0 text-muted-foreground text-xs">{getProviderDisplayName(selectedProvider)}</span>
            )}
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

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !modelId) return
    try {
      setSubmitting(true)
      const { providerId } = parseUniqueModelId(modelId)
      // The config blob is stored as-is; model/credentials are injected by
      // CodeCliService at launch time.
      await onSubmit({ name: name.trim(), providerId, modelId, config })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, modelId, name, config, onSubmit, onClose])

  const renderToolFields = () => {
    switch (cliTool) {
      case 'claude-code':
        return <ClaudeConfigFields config={config} onChange={setConfig} />
      case 'openai-codex':
        return <CodexConfigFields config={config} onChange={setConfig} />
      case 'opencode':
        return <OpenCodeConfigFields config={config} onChange={setConfig} />
      case 'openclaw':
        return <OpenclawConfigFields config={config} onChange={setConfig} />
      case 'hermes':
        return <HermesConfigFields config={config} onChange={setConfig} />
      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent size="lg" aria-describedby={undefined} className="flex max-h-[85vh] flex-col p-0">
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-border/15 border-b pr-12 pl-6">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <CLIIcon id={cliTool} size={16} className="text-primary" />
          </div>
          <DialogTitle className="flex min-w-0 items-center gap-1.5 text-left font-medium text-sm leading-none">
            <span className="truncate text-foreground">{toolMeta?.label ?? cliTool}</span>
            <span className="shrink-0 rounded bg-accent/50 px-1.5 py-0.5 font-normal text-[10px] text-muted-foreground/70">
              {props.config ? t('code.edit_config') : t('code.add_config')}
            </span>
          </DialogTitle>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {providerContext && (
            <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-accent/15 px-3 py-2">
              <span className="shrink-0 font-medium text-foreground text-xs">{providerContext.name}</span>
              {providerContext.endpointLabel && (
                <span className="shrink-0 rounded bg-accent/60 px-1.5 py-0.5 text-[10px] text-muted-foreground/70">
                  {providerContext.endpointLabel}
                </span>
              )}
              {providerContext.baseUrl && (
                <span className="truncate font-mono text-[11px] text-muted-foreground/55">
                  {providerContext.baseUrl}
                </span>
              )}
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/50">
                {t('code.endpoint_key_in_model_service')}
              </span>
            </div>
          )}

          <Section title={t('code.basic_info')}>
            <FormField label={t('code.config_name')}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('code.config_name_placeholder')}
              />
            </FormField>
          </Section>

          <Section title={t('code.model')}>
            <div className="space-y-2.5">
              <ModelSelector
                multiple={false}
                selectionType="id"
                value={modelId}
                onSelect={setModelId}
                filter={modelFilter}
                showTagFilter
                trigger={renderModelTrigger()}
              />
              <p className="text-[11px] text-muted-foreground/50">{t('code.model_hint_config')}</p>
            </div>
          </Section>

          {renderToolFields()}
        </div>

        <DialogFooter className="shrink-0 justify-end gap-2 border-border/15 border-t px-6 py-3">
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
