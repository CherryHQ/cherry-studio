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
import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'
import type { FC } from 'react'
import { useState } from 'react'
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

function isSelectableAgentModel(model: Model): boolean {
  return (
    model.endpointTypes?.includes(ENDPOINT_TYPE.ANTHROPIC_MESSAGES) === true &&
    !model.capabilities.some((capability) => DISALLOWED_AGENT_CAPABILITIES.has(capability))
  )
}

/**
 * Mirrors the legacy AgentSettings **Essential** tab: the section where
 * everything identity- and runtime-related lives. Fields (in original
 * popup order):
 *
 * - name
 * - model (primary + plan + small — all from `AgentBase`)
 * - accessible_paths
 * - configuration.soul_enabled
 * - configuration.heartbeat_enabled / heartbeat_interval
 * - description
 * - configuration.avatar (new here — old popup surfaced it via NameSetting)
 *
 * Each sub-field stays in one flat list to match the "one tall Essential
 * tab" feel of the legacy popup.
 */
const BasicSection: FC<Props> = ({ form, onChange, nameError, modelError }) => {
  const { t } = useTranslation()
  const [emojiOpen, setEmojiOpen] = useState(false)

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
          onSelect={(modelId) => onChange({ model: modelId ?? '' })}
        />
        <ModelField
          label={t('library.config.agent.field.plan_model.label')}
          hint={t('library.config.agent.field.plan_model.hint')}
          value={form.planModel}
          allowClear
          onSelect={(modelId) => onChange({ planModel: modelId ?? '' })}
        />
        <ModelField
          label={t('library.config.agent.field.small_model.label')}
          hint={t('library.config.agent.field.small_model.hint')}
          value={form.smallModel}
          allowClear
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
  onSelect
}: {
  label: string
  hint: string
  value: string
  allowClear?: boolean
  errorMessage?: string
  onSelect: (modelId: UniqueModelId | null) => void
}) {
  return (
    <ModelSelectorField
      label={label}
      hint={hint}
      value={value}
      allowClear={allowClear}
      errorMessage={errorMessage}
      filter={isSelectableAgentModel}
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
