import {
  Button,
  EditableNumber,
  EmojiAvatar,
  Field,
  FieldContent,
  FieldError,
  FieldSeparator,
  FieldSet,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  Textarea
} from '@cherrystudio/ui'
import EmojiPicker from '@renderer/components/EmojiPicker'
import { useProviders } from '@renderer/hooks/useProvider'
import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'
import { isFunctionCallingModel } from '@shared/utils/model'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FieldHeader } from '../../FieldHeader'
import { ModelSelectorField } from '../../ModelSelectorField'
import type { AgentFormState } from '../descriptor'

interface Props {
  form: AgentFormState
  onChange: (patch: Partial<AgentFormState>) => void
  nameError?: string
  modelError?: string
}

// Avatar quick-pick presets shown next to the emoji picker button.
const AVATAR_PRESETS = ['🤖', '🧠', '⚡', '🚀', '🛠️', '🎯', '📊', '🔬'] as const
const DISALLOWED_AGENT_CAPABILITIES = new Set<string>([
  MODEL_CAPABILITY.EMBEDDING,
  MODEL_CAPABILITY.RERANK,
  MODEL_CAPABILITY.IMAGE_GENERATION
])

/**
 * Protocol Translation Layer — Agent Model Filter
 *
 * Gate models that can be selected for Agent use. Uses **provider-level**
 * Anthropic endpoint detection, not model-level `endpointTypes`. This allows
 * models from providers that proxy Anthropic-compatible requests (SiliconFlow,
 * DeepSeek, BigModel, AIHubMix, CherryIN, etc.) to appear in the Agent picker,
 * even if the individual model does not declare `anthropic-messages` support.
 *
 * The API Gateway (proxyStream) handles cross-format protocol translation at
 * runtime — converting Anthropic-format Agent requests to the model's native
 * format (OpenAI / Gemini) and back — so the model itself does NOT need to
 * natively speak Anthropic.
 *
 * Additional gate: model must support function calling (tool use), since
 * Agent mode relies on tool-call round-trips.
 */
function createAgentModelFilter(
  claudeCompatibleProviderIds: Set<string>
): (model: Model) => boolean {
  return (model: Model): boolean => {
    // Provider must have an Anthropic-compatible endpoint
    if (!claudeCompatibleProviderIds.has(model.providerId)) return false

    // Model must not be embedding / rerank / image-gen
    if (model.capabilities.some((c) => DISALLOWED_AGENT_CAPABILITIES.has(c))) return false

    // Model must support function calling (tool use)
    if (!isFunctionCallingModel(model)) return false

    return true
  }
}

/**
 * The section where everything identity- and runtime-related lives. Fields:
 *
 * - name
 * - model (primary + plan + small — all from `AgentBase`)
 * - configuration.soul_enabled
 * - configuration.heartbeat_enabled / heartbeat_interval
 * - description
 * - configuration.avatar
 *
 * Each sub-field stays in one flat list to match the "one tall Essential
 * tab" feel of the legacy popup.
 */
const BasicSection: FC<Props> = ({ form, onChange, nameError, modelError }) => {
  const { t } = useTranslation()
  const [emojiOpen, setEmojiOpen] = useState(false)
  const { providers } = useProviders()

  // Build the set of provider IDs that can serve Anthropic-shaped requests.
  // This mirrors the logic in useAgentModelFilter.ts — any provider with an
  // explicit `anthropic-messages` endpoint config (or the native Anthropic
  // provider) is eligible for Agent use.
  const agentModelFilter = useMemo(() => {
    const claudeCompatibleIds = new Set<string>(['anthropic'])
    for (const p of providers) {
      if (p.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]) {
        claudeCompatibleIds.add(p.id)
      }
    }
    return createAgentModelFilter(claudeCompatibleIds)
  }, [providers])

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="mb-1 text-base text-foreground">{t('library.config.agent.section.basic.title')}</h3>
        <p className="text-muted-foreground/80 text-xs">{t('library.config.agent.section.basic.desc')}</p>
      </div>

      <Field className="gap-1.5">
        <FieldHeader label={t('common.avatar')} hint={t('library.config.agent.field.avatar.hint')} />
        <FieldContent>
          <div className="flex items-center gap-2">
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t('library.config.basic.pick_avatar')}
                  className="h-auto min-h-0 rounded-[20%] p-0 text-foreground shadow-none transition-opacity hover:bg-transparent hover:text-foreground hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50">
                  <EmojiAvatar size={48} fontSize={24}>
                    {form.avatar || '🤖'}
                  </EmojiAvatar>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <EmojiPicker
                  onEmojiClick={(emoji) => {
                    onChange({ avatar: emoji })
                    setEmojiOpen(false)
                  }}
                />
              </PopoverContent>
            </Popover>
            <div className="flex flex-wrap gap-1">
              {AVATAR_PRESETS.map((a) => {
                const active = form.avatar === a
                return (
                  <Button
                    key={a}
                    type="button"
                    variant="ghost"
                    onClick={() => onChange({ avatar: a })}
                    className={`flex size-7 min-h-0 items-center justify-center rounded-2xs font-normal text-sm shadow-none transition-all focus-visible:ring-0 ${
                      active ? 'bg-accent ring-1 ring-primary/20' : 'hover:bg-accent/50'
                    }`}>
                    {a}
                  </Button>
                )
              })}
            </div>
          </div>
        </FieldContent>
      </Field>

      <Field data-invalid={Boolean(nameError) || undefined} className="gap-1.5">
        <FieldHeader
          label={t('library.config.agent.field.name.label')}
          hint={t('library.config.agent.field.name.hint')}
        />
        <FieldContent>
          <Input
            value={form.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={t('library.config.agent.field.name.placeholder')}
            aria-invalid={Boolean(nameError) || undefined}
          />
          <FieldError className="text-xs" errors={nameError ? [{ message: nameError }] : undefined} />
        </FieldContent>
      </Field>

      <ModelSubsection>
        <ModelField
          label={t('library.config.agent.field.model.label')}
          hint={t('library.config.agent.field.model.hint')}
          value={form.model}
          errorMessage={modelError}
          filter={agentModelFilter}
          onSelect={(modelId) => onChange({ model: modelId ?? '' })}
        />
        <ModelField
          label={t('library.config.agent.field.plan_model.label')}
          hint={t('library.config.agent.field.plan_model.hint')}
          value={form.planModel}
          allowClear
          filter={agentModelFilter}
          onSelect={(modelId) => onChange({ planModel: modelId ?? '' })}
        />
        <ModelField
          label={t('library.config.agent.field.small_model.label')}
          hint={t('library.config.agent.field.small_model.hint')}
          value={form.smallModel}
          allowClear
          filter={agentModelFilter}
          onSelect={(modelId) => onChange({ smallModel: modelId ?? '' })}
        />
      </ModelSubsection>

      <SwitchRow
        label={t('library.config.agent.field.soul_enabled.label')}
        hint={t('library.config.agent.field.soul_enabled.help')}
        checked={form.soulEnabled}
        onCheckedChange={(checked) => onChange({ soulEnabled: checked })}
      />

      <SwitchRow
        label={t('library.config.agent.field.heartbeat_enabled.label')}
        hint={t('agent.cherryClaw.heartbeat.enabledHelper')}
        checked={form.heartbeatEnabled}
        onCheckedChange={(checked) => onChange({ heartbeatEnabled: checked })}
      />

      {form.heartbeatEnabled ? (
        <Field className="gap-1.5">
          <FieldHeader
            label={t('library.config.agent.field.heartbeat_interval.label')}
            hint={t('agent.cherryClaw.heartbeat.intervalHelper')}
          />
          <FieldContent>
            <EditableNumber
              block
              min={1}
              max={1440}
              step={1}
              precision={0}
              align="start"
              changeOnBlur
              value={form.heartbeatInterval || null}
              onChange={(v) => onChange({ heartbeatInterval: typeof v === 'number' ? v : 0 })}
            />
          </FieldContent>
        </Field>
      ) : null}

      <Field className="gap-1.5">
        <FieldHeader
          label={t('library.config.agent.field.description.label')}
          hint={t('library.config.agent.field.description.hint')}
        />
        <FieldContent>
          <Textarea.Input
            value={form.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder={t('library.config.agent.field.description.placeholder')}
            rows={3}
          />
        </FieldContent>
      </Field>
    </div>
  )
}

function ModelSubsection({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <FieldSet className="gap-3">
      <FieldSeparator className="font-medium text-foreground *:data-[slot=field-separator-content]:bg-background [&>[data-slot=field-separator-content]]:font-medium">
        {t('library.config.agent.model_config')}
      </FieldSeparator>
      {children}
    </FieldSet>
  )
}

function ModelField({
  label,
  hint,
  value,
  allowClear = false,
  errorMessage,
  onSelect,
  filter
}: {
  label: string
  hint: string
  value: string
  allowClear?: boolean
  errorMessage?: string
  onSelect: (modelId: UniqueModelId | null) => void
  filter: (model: Model) => boolean
}) {
  return (
    <ModelSelectorField
      label={label}
      hint={hint}
      value={value}
      allowClear={allowClear}
      errorMessage={errorMessage}
      filter={filter}
      onSelect={onSelect}
    />
  )
}

function SwitchRow({
  label,
  hint,
  checked,
  onCheckedChange
}: {
  label: string
  hint?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="rounded-xs border border-border/30 bg-accent/15 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <FieldHeader label={label} hint={hint} className="min-w-0 flex-1" />
        <Switch size="sm" checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
      </div>
    </div>
  )
}

export default BasicSection
