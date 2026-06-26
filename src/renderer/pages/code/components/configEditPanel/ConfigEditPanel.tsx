import { Button, CodeEditor, Dialog, DialogContent, DialogFooter, DialogTitle, Input } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { ModelSelector } from '@renderer/components/Selector/model'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useModelById } from '@renderer/hooks/useModel'
import { getProviderDisplayName, useProviders } from '@renderer/hooks/useProvider'
import { parseJSON } from '@renderer/utils/json'
import { cn } from '@renderer/utils/style'
import type { CliNamedConfig } from '@shared/data/preference/preferenceTypes'
import type { EndpointType } from '@shared/data/types/model'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { codeCLI } from '@shared/types/codeCli'
import { ChevronDown, Wand2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CLI_TOOLS } from '../../cliTools'
import { CLIIcon } from '../CLIIcon'
import { ADVANCED_FIELDS, MODEL_ROLE_FIELDS } from './advancedFieldDefs'
import { AdvancedField, BooleanPill } from './AdvancedFields'
import { CollapsibleSection, FormField, Section } from './PanelPrimitives'

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
    advanced?: Record<string, unknown>
  }) => Promise<void>
}

// Short labels for the endpoint-type badge in the provider context bar.
const ENDPOINT_LABEL: Partial<Record<EndpointType, string>> = {
  'anthropic-messages': 'Anthropic',
  'openai-chat-completions': 'OpenAI',
  'openai-responses': 'Responses'
}

function getEnvFromAdvanced(advanced: Record<string, unknown> | undefined): Record<string, string> {
  if (!advanced || typeof advanced.env !== 'object' || advanced.env === null) {
    return {}
  }
  return advanced.env as Record<string, string>
}

function getAttributionFromAdvanced(
  advanced: Record<string, unknown> | undefined
): { commit: string; pr: string } | undefined {
  if (!advanced || typeof advanced.attribution !== 'object' || advanced.attribution === null) {
    return undefined
  }
  return advanced.attribution as { commit: string; pr: string }
}

export const ConfigEditPanel: FC<ConfigEditPanelProps> = ({
  open,
  onClose,
  cliTool,
  config,
  modelFilter,
  onSubmit
}) => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const { activeCmTheme } = useCodeStyle()
  const [fontSize] = usePreference('chat.message.font_size')
  const providerMap = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers])
  const advancedFields = useMemo(() => ADVANCED_FIELDS[cliTool] ?? [], [cliTool])
  const booleanFields = useMemo(() => advancedFields.filter((f) => f.type === 'boolean'), [advancedFields])
  const otherFields = useMemo(() => advancedFields.filter((f) => f.type !== 'boolean'), [advancedFields])
  const modelRoleFields = useMemo(() => MODEL_ROLE_FIELDS[cliTool] ?? [], [cliTool])
  const hasModelRoles = modelRoleFields.length > 0

  const [name, setName] = useState('')
  const [modelId, setModelId] = useState<UniqueModelId | undefined>(undefined)
  const [advanced, setAdvanced] = useState<Record<string, unknown>>({})
  const [configText, setConfigText] = useState('{}')
  const [paramsOpen, setParamsOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [isUserEditing, setIsUserEditing] = useState(false)

  const toolMeta = useMemo(() => CLI_TOOLS.find((ti) => ti.value === cliTool), [cliTool])

  // Derived state
  const env = useMemo(() => getEnvFromAdvanced(advanced), [advanced])
  const attribution = useMemo(() => getAttributionFromAdvanced(advanced), [advanced])
  const hideAttribution = attribution?.commit === '' && attribution?.pr === ''

  // Initialize form fields on open / config change.
  useEffect(() => {
    if (!open) return
    const initial = config?.advanced ?? {}
    if (config) {
      setName(config.name)
      setModelId(isUniqueModelId(config.modelId) ? config.modelId : undefined)
      setAdvanced(initial)
    } else {
      setName('')
      setModelId(undefined)
      setAdvanced({})
    }
    setConfigText(toJson(initial) ?? '{}')
    setParamsOpen(false)
    setIsUserEditing(false)
  }, [open, config])

  const { model: selectedModelRecord } = useModelById(modelId ?? null)

  const selectedProvider = selectedModelRecord ? providerMap.get(selectedModelRecord.providerId) : undefined

  const providerContext = useMemo(() => {
    if (!selectedProvider) return null
    const endpointType = selectedProvider.defaultChatEndpoint
    const baseUrl = endpointType ? selectedProvider.endpointConfigs?.[endpointType]?.baseUrl : undefined
    return {
      name: getProviderDisplayName(selectedProvider),
      endpointLabel: endpointType ? (ENDPOINT_LABEL[endpointType] ?? endpointType) : undefined,
      baseUrl
    }
  }, [selectedProvider])

  // Sync provider baseUrl to config when model is selected
  useEffect(() => {
    if (!selectedProvider || isUserEditing) return

    const endpointType = selectedProvider.defaultChatEndpoint
    const baseUrl = endpointType ? selectedProvider.endpointConfigs?.[endpointType]?.baseUrl : undefined

    if (!baseUrl) return

    const newAdvanced: Record<string, unknown> = {
      env: {
        ANTHROPIC_BASE_URL: baseUrl,
        ANTHROPIC_AUTH_TOKEN: ''
      }
    }

    setAdvanced(newAdvanced)
    setConfigText(toJson(newAdvanced) ?? '{}')
  }, [selectedProvider, isUserEditing])

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

  const updateEnvField = useCallback(
    (envKey: string, value: string) => {
      const nextEnv = { ...env }
      if (value) {
        nextEnv[envKey] = value
      } else {
        delete nextEnv[envKey]
      }
      const nextAdvanced = { ...advanced, env: nextEnv }
      setAdvanced(nextAdvanced)
      setConfigText(toJson(nextAdvanced) ?? '{}')
      setIsUserEditing(true)
    },
    [env, advanced]
  )

  const toggleHideAttribution = useCallback(
    (hide: boolean) => {
      const { ...rest } = advanced
      delete rest.attribution
      const nextAdvanced = hide ? { ...rest, attribution: { commit: '', pr: '' } } : rest
      setAdvanced(nextAdvanced)
      setConfigText(toJson(nextAdvanced) ?? '{}')
      setIsUserEditing(true)
    },
    [advanced]
  )

  const handleConfigTextChange = useCallback((next: string) => {
    setConfigText(next)
    setIsUserEditing(true)
    const parsed = parseJSON(next)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      setAdvanced(parsed)
    }
  }, [])

  const handleFormat = useCallback(() => {
    setConfigText((prev) => toJson(parseJSON(prev)) ?? prev)
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !modelId) return
    try {
      setSubmitting(true)
      const { providerId } = parseUniqueModelId(modelId)
      await onSubmit({ name: name.trim(), providerId, modelId, advanced })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, modelId, name, advanced, onSubmit, onClose])

  const hasAdvanced = advancedFields.length > 0

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent size="lg" className="flex max-h-[85vh] flex-col overflow-hidden p-0">
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-border/15 border-b pr-12 pl-4">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <CLIIcon id={cliTool} size={16} className="text-primary" />
          </div>
          <DialogTitle className="flex min-w-0 items-center gap-1.5 text-left font-medium text-sm leading-none">
            <span className="truncate text-foreground">{toolMeta?.label ?? cliTool}</span>
            <span className="shrink-0 rounded bg-accent/50 px-1.5 py-0.5 font-normal text-[10px] text-muted-foreground/70">
              {config ? t('code.edit_config') : t('code.add_config')}
            </span>
          </DialogTitle>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
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
                onSelect={(id) => {
                  setModelId(id)
                  setIsUserEditing(false)
                }}
                filter={modelFilter}
                showTagFilter
                trigger={renderModelTrigger()}
              />
              <p className="text-[11px] text-muted-foreground/50">{t('code.model_hint_config')}</p>
            </div>
          </Section>

          {(hasAdvanced || hasModelRoles) && (
            <CollapsibleSection open={paramsOpen} onOpenChange={setParamsOpen} label={t('code.tool_parameters')}>
              <div className="space-y-4">
                {hasModelRoles && (
                  <div className="space-y-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-foreground/80 text-xs">{t('code.adv.claude.model_roles')}</span>
                      <span className="text-[11px] text-muted-foreground/50">
                        {t('code.adv.claude.model_roles_hint')}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 items-start gap-x-4 gap-y-4 xl:grid-cols-3">
                      {modelRoleFields.map((field) => (
                        <FormField key={field.envKey} label={t(field.labelKey)}>
                          <Input
                            value={env[field.envKey] ?? ''}
                            onChange={(e) => updateEnvField(field.envKey, e.target.value)}
                            placeholder={field.placeholder}
                            autoComplete="off"
                            className="font-mono"
                          />
                        </FormField>
                      ))}
                    </div>
                  </div>
                )}

                {/* Typed scalar / select params */}
                {otherFields.length > 0 && (
                  <div
                    className={cn(
                      'grid grid-cols-1 items-start gap-x-4 gap-y-4',
                      hasModelRoles ? 'xl:grid-cols-3' : 'xl:grid-cols-2'
                    )}>
                    {otherFields.map((field) => (
                      <AdvancedField
                        key={field.envKey}
                        field={field}
                        value={env[field.envKey]}
                        onChange={(v) => updateEnvField(field.envKey, v)}
                      />
                    ))}
                  </div>
                )}

                {/* Boolean toggles */}
                {booleanFields.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {booleanFields.map((field) => (
                      <BooleanPill
                        key={field.envKey}
                        field={field}
                        value={env[field.envKey] === 'true'}
                        onChange={(v) => updateEnvField(field.envKey, v ? 'true' : '')}
                      />
                    ))}
                  </div>
                )}

                {/* Special: Hide AI Attribution */}
                {cliTool === 'claude-code' && (
                  <BooleanPill
                    field={{
                      envKey: 'hideAttribution',
                      labelKey: 'code.adv.claude.hide_attribution',
                      type: 'boolean'
                    }}
                    value={hideAttribution}
                    onChange={(v) => toggleHideAttribution(v)}
                  />
                )}
              </div>
            </CollapsibleSection>
          )}

          {/* Raw JSON config — always visible, syncs with the structured fields above */}
          {hasAdvanced && (
            <Section
              title={t('code.raw_config')}
              description={t('code.config_json_hint')}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleFormat}
                  className="gap-1 px-2 py-0.5 text-[11px] text-muted-foreground/70 hover:text-foreground">
                  <Wand2 size={11} />
                  {t('code.format_json')}
                </Button>
              }>
              <CodeEditor
                theme={activeCmTheme}
                fontSize={fontSize - 4}
                value={configText}
                language="json"
                onChange={handleConfigTextChange}
                height="240px"
                expanded={false}
                wrapped
                className="overflow-hidden rounded-md border border-border/40"
                options={{ lint: true, lineNumbers: true, foldGutter: true, keymap: true }}
              />
            </Section>
          )}
        </div>

        <DialogFooter className="shrink-0 justify-end gap-2 border-border/15 border-t px-4 py-2.5">
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

function toJson(value: unknown): string | null {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return null
  }
}
