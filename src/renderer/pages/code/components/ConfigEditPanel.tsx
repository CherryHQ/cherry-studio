import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { ModelSelector } from '@renderer/components/Selector/model'
import { getProviderDisplayName, useProviders } from '@renderer/hooks/useProvider'
import { cn } from '@renderer/utils/style'
import type { CliNamedConfig } from '@shared/data/preference/preferenceTypes'
import { isUniqueModelId, type Model, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { codeCLI } from '@shared/types/codeCli'
import { ChevronDown, ChevronDown as ChevronDownIcon } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  const providerMap = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers])
  const advancedFields = useMemo(() => ADVANCED_FIELDS[cliTool] ?? [], [cliTool])

  const [name, setName] = useState('')
  const [modelId, setModelId] = useState<UniqueModelId | undefined>(undefined)
  const [advanced, setAdvanced] = useState<Record<string, unknown>>({})
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Initialize form fields on open / config change.
  useEffect(() => {
    if (!open) return
    if (config) {
      setName(config.name)
      setModelId(isUniqueModelId(config.modelId) ? config.modelId : undefined)
      setAdvanced(config.advanced ?? {})
    } else {
      setName('')
      setModelId(undefined)
      setAdvanced({})
    }
    setShowAdvanced(false)
  }, [open, config])

  const selectedModelRecord = useMemo(() => {
    if (!modelId) return undefined
    const { providerId, modelId: rawId } = parseUniqueModelId(modelId)
    const provider = providerMap.get(providerId)
    return provider?.models?.find((m) => m.id === rawId)
  }, [modelId, providerMap])

  const selectedProvider = selectedModelRecord ? providerMap.get(selectedModelRecord.providerId) : undefined

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
      await onSubmit({ name: name.trim(), providerId, modelId, advanced })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, modelId, name, advanced, onSubmit, onClose])

  const hasAdvanced = advancedFields.length > 0

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent size="lg" closeOnOverlayClick className="flex max-h-[85vh] flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-border border-b px-5 py-3.5">
          <DialogTitle className="text-base">{config ? t('code.edit_config') : t('code.add_config')}</DialogTitle>
        </DialogHeader>

        <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Basic info */}
          <FormField label={t('code.config_name')}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('code.config_name_placeholder')}
            />
          </FormField>

          {/* Model */}
          <FormField label={t('code.model')}>
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
          </FormField>

          {/* Advanced config */}
          {hasAdvanced && (
            <>
              <AdvancedSettingsButton onClick={() => setShowAdvanced(!showAdvanced)}>
                <ChevronDownIcon
                  size={16}
                  className={cn('transition-transform duration-200', showAdvanced && 'rotate-180')}
                />
                {t('common.advanced_settings')}
              </AdvancedSettingsButton>

              {showAdvanced && (
                <div className="grid grid-cols-1 items-start gap-x-4 gap-y-4 xl:grid-cols-2">
                  {advancedFields.map((field) => (
                    <AdvancedField
                      key={field.key}
                      field={field}
                      value={advanced[field.key]}
                      onChange={(v) => setAdvanced((prev) => ({ ...prev, [field.key]: v }))}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="shrink-0 border-border border-t px-5 py-3.5">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
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

// ── Layout primitives ─────────────────────────────────────────────────────────────────

const FormField: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div className="flex min-w-0 flex-col gap-1.5">
    <Label className="font-medium text-muted-foreground text-xs">{label}</Label>
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

// ── Advanced field definitions (model-agnostic params, persisted per config) ──

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

// ── Field renderer ─────────────────────────────────────────────────────────

const AdvancedField: FC<{ field: AdvancedFieldDef; value: unknown; onChange: (v: unknown) => void }> = ({
  field,
  value,
  onChange
}) => {
  const { t } = useTranslation()

  if (field.type === 'boolean') {
    // Boolean → inline row (label + checkbox).
    return (
      <label
        className={cn(
          'flex h-14 min-w-0 flex-row items-center justify-between gap-4 rounded-md border border-border/70 px-3 xl:col-span-2'
        )}>
        <span className="text-foreground text-sm">{t(field.labelKey)}</span>
        <Checkbox size="sm" checked={Boolean(value)} onCheckedChange={(c) => onChange(c === true)} />
      </label>
    )
  }

  if (field.type === 'select') {
    return (
      <FormField label={t(field.labelKey)}>
        <Select value={(value as string) ?? ''} onValueChange={(v) => onChange(v)}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder={t('code.adv.select_placeholder')} />
          </SelectTrigger>
          <SelectContent>
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
