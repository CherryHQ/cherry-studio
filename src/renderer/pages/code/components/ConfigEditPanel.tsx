import {
  Button,
  CodeEditor,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
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
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CLI_TOOLS } from '..'
import { CLIIcon } from './CLIIcon'

export interface ConfigEditPanelProps {
  open: boolean
  onClose: () => void
  cliTool: codeCLI
  /** When editing an existing config; null when adding a new one. */
  config: CliNamedConfig | null
  /** Model filter (provider/model compatibility) for this CLI tool. */
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
  /** Editor text — the editable serialization of `advanced`. Kept as a string so the
   * user can paste a raw config blob even while typing invalid JSON (lint highlights it). */
  const [advancedText, setAdvancedText] = useState('{}')
  const [paramsOpen, setParamsOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  /** Dialog content element — used as the portal container for nested Select/Popover
   * overlays so Radix dismiss layers treat them as inside the dialog interaction boundary. */
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null)

  const toolMeta = useMemo(() => CLI_TOOLS.find((ti) => ti.value === cliTool), [cliTool])

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
    setAdvancedText(toJson(initial) ?? '{}')
    setParamsOpen(false)
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

  const updateField = useCallback(
    (key: string, value: unknown) => {
      const next = { ...advanced, [key]: value }
      setAdvanced(next)
      setAdvancedText(toJson(next) ?? '{}')
    },
    [advanced]
  )

  const handleAdvancedChange = useCallback((next: string) => {
    setAdvancedText(next)
    const parsed = parseJSON(next)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      setAdvanced(parsed as Record<string, unknown>)
    }
  }, [])

  const handleFormat = useCallback(() => {
    setAdvancedText((prev) => toJson(parseJSON(prev)) ?? prev)
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
      <DialogContent ref={setPortalContainer} size="lg" className="flex max-h-[85vh] flex-col overflow-hidden p-0">
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
                onSelect={(id) => setModelId(id)}
                filter={modelFilter}
                showTagFilter
                trigger={renderModelTrigger()}
                portalContainer={typeof document !== 'undefined' ? document.body : null}
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
                      <span className="text-xs font-medium text-foreground/80">{t('code.adv.claude.model_roles')}</span>
                      <span className="text-[11px] text-muted-foreground/50">
                        {t('code.adv.claude.model_roles_hint')}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 items-start gap-x-4 gap-y-4 xl:grid-cols-3">
                      {modelRoleFields.map((field) => (
                        <FormField key={field.key} label={t(field.labelKey)}>
                          <Input
                            value={(advanced[field.key] as string) ?? ''}
                            onChange={(e) => updateField(field.key, e.target.value)}
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
                        key={field.key}
                        field={field}
                        value={advanced[field.key]}
                        onChange={(v) => updateField(field.key, v)}
                        portalContainer={portalContainer}
                      />
                    ))}
                  </div>
                )}

                {/* Boolean toggles */}
                {booleanFields.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {booleanFields.map((field) => (
                      <BooleanPill
                        key={field.key}
                        field={field}
                        value={advanced[field.key]}
                        onChange={(v) => updateField(field.key, v)}
                      />
                    ))}
                  </div>
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
                value={advancedText}
                language="json"
                onChange={handleAdvancedChange}
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

const Section: FC<{ title: string; description?: string; action?: ReactNode; children: ReactNode }> = ({
  title,
  description,
  action,
  children
}) => (
  <section className="space-y-3">
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5">
        <span className="text-foreground/70 text-xs">{title}</span>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {description && <p className="text-[11px] text-muted-foreground/50">{description}</p>}
    </div>
    {children}
  </section>
)

const FormField: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div className="flex min-w-0 flex-col gap-1.5">
    <Label className="font-normal text-muted-foreground text-xs">{label}</Label>
    {children}
  </div>
)

/** "Advanced Settings" toggle (ghost button with a leading icon). */
const AdvancedSettingsButton: FC<React.ComponentPropsWithoutRef<typeof Button>> = ({
  type = 'button',
  variant = 'ghost',
  size = 'sm',
  className,
  ...props
}) => (
  <Button
    type={type}
    variant={variant}
    size={size}
    className={cn('h-8 w-fit gap-1.5 px-2 text-primary hover:text-primary', className)}
    {...props}
  />
)

const CollapsibleSection: FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  children: ReactNode
}> = ({ open, onOpenChange, label, children }) => (
  <section className="space-y-2.5">
    <AdvancedSettingsButton onClick={() => onOpenChange(!open)}>
      <ChevronDown size={16} className={cn('transition-transform duration-200', open && 'rotate-180')} />
      {label}
    </AdvancedSettingsButton>
    {open && children}
  </section>
)

interface AdvancedFieldDef {
  key: string
  labelKey: string
  type: 'text' | 'number' | 'boolean' | 'select'
  placeholder?: string
  options?: { value: string; labelKey: string }[]
  min?: number
  max?: number
}

const ADVANCED_FIELDS: Record<string, AdvancedFieldDef[]> = {
  'claude-code': [
    { key: 'timeoutMs', labelKey: 'code.adv.claude.timeout_ms', type: 'text', placeholder: '30000' },
    { key: 'maxOutputTokens', labelKey: 'code.adv.claude.max_output_tokens', type: 'text', placeholder: '16384' },
    {
      key: 'effortLevel',
      labelKey: 'code.adv.claude.effort_level',
      type: 'select',
      options: [
        { value: 'low', labelKey: 'code.adv.effort.low' },
        { value: 'medium', labelKey: 'code.adv.effort.medium' },
        { value: 'high', labelKey: 'code.adv.effort.high' }
      ]
    },
    { key: 'autoCompactWindow', labelKey: 'code.adv.claude.auto_compact_window', type: 'text', placeholder: '100000' },
    { key: 'enableToolSearch', labelKey: 'code.adv.claude.enable_tool_search', type: 'boolean' },
    { key: 'skipWebFetchPreflight', labelKey: 'code.adv.claude.skip_web_fetch_preflight', type: 'boolean' },
    { key: 'includeCoAuthoredBy', labelKey: 'code.adv.claude.include_co_authored_by', type: 'boolean' },
    { key: 'disableNonessentialTraffic', labelKey: 'code.adv.claude.disable_nonessential_traffic', type: 'boolean' },
    { key: 'disableExperimentalBetas', labelKey: 'code.adv.claude.disable_experimental_betas', type: 'boolean' }
  ],
  'openai-codex': [
    {
      key: 'reasoningEffort',
      labelKey: 'code.adv.codex.reasoning_effort',
      type: 'select',
      options: [
        { value: 'low', labelKey: 'code.adv.effort.low' },
        { value: 'medium', labelKey: 'code.adv.effort.medium' },
        { value: 'high', labelKey: 'code.adv.effort.high' }
      ]
    },
    { key: 'personality', labelKey: 'code.adv.codex.personality', type: 'text', placeholder: 'pragmatic' },
    { key: 'verbosity', labelKey: 'code.adv.codex.verbosity', type: 'text', placeholder: 'concise' },
    {
      key: 'contextWindow',
      labelKey: 'code.adv.codex.context_window',
      type: 'number',
      placeholder: '128000',
      min: 1000,
      max: 1000000
    },
    {
      key: 'autoCompactTokenLimit',
      labelKey: 'code.adv.codex.auto_compact_token_limit',
      type: 'number',
      placeholder: '100000',
      min: 1000,
      max: 1000000
    },
    { key: 'reviewModel', labelKey: 'code.adv.codex.review_model', type: 'text', placeholder: 'gpt-4o' },
    { key: 'disableResponseStorage', labelKey: 'code.adv.codex.disable_response_storage', type: 'boolean' }
  ],
  opencode: [
    {
      key: 'budgetTokens',
      labelKey: 'code.adv.opencode.budget_tokens',
      type: 'number',
      placeholder: '10000',
      min: 1000,
      max: 100000
    },
    {
      key: 'contextLimit',
      labelKey: 'code.adv.opencode.context_limit',
      type: 'number',
      placeholder: '128000',
      min: 1000,
      max: 1000000
    },
    {
      key: 'outputLimit',
      labelKey: 'code.adv.opencode.output_limit',
      type: 'number',
      placeholder: '16384',
      min: 1000,
      max: 100000
    }
  ],
  openclaw: [
    { key: 'reasoning', labelKey: 'code.adv.openclaw.reasoning', type: 'boolean' },
    {
      key: 'contextWindow',
      labelKey: 'code.adv.openclaw.context_window',
      type: 'number',
      placeholder: '128000',
      min: 1000,
      max: 1000000
    },
    {
      key: 'maxTokens',
      labelKey: 'code.adv.openclaw.max_tokens',
      type: 'number',
      placeholder: '16384',
      min: 1000,
      max: 100000
    }
  ],
  hermes: [
    {
      key: 'contextLength',
      labelKey: 'code.adv.hermes.context_length',
      type: 'number',
      placeholder: '128000',
      min: 1000,
      max: 1000000
    },
    {
      key: 'maxTokens',
      labelKey: 'code.adv.hermes.max_tokens',
      type: 'number',
      placeholder: '16384',
      min: 1000,
      max: 100000
    }
  ]
}

interface ModelRoleFieldDef {
  key: string
  labelKey: string
  placeholder: string
}

const MODEL_ROLE_FIELDS: Record<string, ModelRoleFieldDef[]> = {
  'claude-code': [
    { key: 'haikuModel', labelKey: 'code.adv.claude.haiku_model', placeholder: 'claude-haiku-4-5' },
    { key: 'sonnetModel', labelKey: 'code.adv.claude.sonnet_model', placeholder: 'claude-sonnet-4-5' },
    { key: 'opusModel', labelKey: 'code.adv.claude.opus_model', placeholder: 'claude-opus-4-1' }
  ]
}

const AdvancedField: FC<{
  field: AdvancedFieldDef
  value: unknown
  onChange: (v: unknown) => void
  portalContainer?: HTMLElement | null
}> = ({ field, value, onChange, portalContainer }) => {
  const { t } = useTranslation()

  if (field.type === 'select') {
    return (
      <FormField label={t(field.labelKey)}>
        <Select value={(value as string) ?? ''} onValueChange={(v) => onChange(v)}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder={t('code.adv.select_placeholder')} />
          </SelectTrigger>
          <SelectContent portalContainer={portalContainer}>
            {field.options?.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
    )
  }

  return (
    <FormField label={t(field.labelKey)}>
      <Input
        type={field.type === 'number' ? 'number' : 'text'}
        value={(value as string | number) ?? ''}
        onChange={(e) =>
          onChange(field.type === 'number' ? (e.target.value ? Number(e.target.value) : undefined) : e.target.value)
        }
        placeholder={field.placeholder}
        min={field.min}
        max={field.max}
        className="font-mono"
      />
    </FormField>
  )
}

const BooleanPill: FC<{ field: AdvancedFieldDef; value: unknown; onChange: (v: boolean) => void }> = ({
  field,
  value,
  onChange
}) => {
  const { t } = useTranslation()
  const on = Boolean(value)

  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-2 text-[11px] transition-colors',
        on
          ? 'border-foreground/25 bg-foreground/[0.06] text-foreground'
          : 'border-border/50 text-muted-foreground/60 hover:border-border hover:text-foreground'
      )}>
      <span className={cn('size-1.5 shrink-0 rounded-full', on ? 'bg-success' : 'bg-muted-foreground/30')} />
      {t(field.labelKey)}
    </button>
  )
}
