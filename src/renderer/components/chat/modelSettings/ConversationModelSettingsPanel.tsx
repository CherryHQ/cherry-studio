import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { HelpTooltip, InputNumber, Slider, Switch } from '@cherrystudio/ui'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { EmptyState } from '@renderer/components/chat/primitives'
import { ModelSpeedControlFields, modelSpeedControlHasVisibleControls } from '@renderer/components/ModelSpeedControl'
import Scrollbar from '@renderer/components/Scrollbar'
import type { AssistantSettings } from '@renderer/types/assistant'
import { getProviderDisplayNameById } from '@renderer/utils/naming'
import { cn } from '@renderer/utils/style'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { ReasoningSummary, ServiceTierSelection } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import {
  isSupportTemperatureModel,
  isSupportTopPModel,
  isTemperatureTopPMutuallyExclusiveModel
} from '@shared/utils/model'

const UI_DEFAULT_MAX_TOKENS = DEFAULT_ASSISTANT_SETTINGS.maxTokens

type ConversationModelSettingsPanelProps = {
  active: boolean
  model?: Model
  modelPending?: boolean
  missingAssistant?: boolean
  missingEntity?: 'assistant' | 'agent'
  settings?: AssistantSettings
  reasoningEffort: ReasoningEffortOption
  reasoningSummary?: ReasoningSummary
  serviceTier: ServiceTierSelection
  fastMode: boolean
  onReasoningEffortChange: (effort: ReasoningEffortOption) => void
  onReasoningSummaryChange?: (summary: ReasoningSummary) => void
  onServiceTierChange: (tier: ServiceTierSelection) => void
  onFastModeChange: (enabled: boolean) => void
  onPatchSettings?: (patch: Partial<AssistantSettings>) => void | Promise<unknown>
}

export const ConversationModelSettingsPanel: FC<ConversationModelSettingsPanelProps> = ({
  active,
  model,
  modelPending,
  missingAssistant,
  missingEntity = 'assistant',
  settings,
  reasoningEffort,
  reasoningSummary,
  serviceTier,
  fastMode,
  onReasoningEffortChange,
  onReasoningSummaryChange,
  onServiceTierChange,
  onFastModeChange,
  onPatchSettings
}) => {
  const { t } = useTranslation()

  if (!active) return null

  if (missingAssistant) {
    const entityKey = missingEntity === 'agent' ? 'agent' : 'assistant'
    return (
      <EmptyState
        className="h-full px-4"
        title={t(`chat.model_settings.no_${entityKey}.title`)}
        description={t(`chat.model_settings.no_${entityKey}.description`)}
      />
    )
  }

  if (modelPending) {
    return <EmptyState className="h-full px-4" title={t('common.loading')} />
  }

  if (!model) {
    return (
      <EmptyState
        className="h-full px-4"
        title={t('chat.model_settings.no_model.title')}
        description={t('chat.model_settings.no_model.description')}
      />
    )
  }

  const providerName = getProviderDisplayNameById(model.providerId)
  const showSpeedFields = modelSpeedControlHasVisibleControls({
    model,
    onReasoningSummaryChange,
    onServiceTierChange,
    onFastModeChange
  })
  const showTemperature = isSupportTemperatureModel(model)
  const showTopP = isSupportTopPModel(model)
  const mutuallyExclusive = isTemperatureTopPMutuallyExclusiveModel(model)
  const showMaxTokens = model.parameterSupport?.maxTokens !== false
  const showAssistantSection = Boolean(settings && onPatchSettings && (showTemperature || showTopP || showMaxTokens))

  return (
    <Scrollbar className="h-full min-h-0 flex-1">
      <div className="flex flex-col gap-6 px-4 py-4 text-xs">
        <div className="flex items-center gap-3">
          <ModelAvatar model={model} size={36} className="size-9 shrink-0" />
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground text-sm">{model.name}</div>
            <div className="truncate text-muted-foreground">{providerName}</div>
          </div>
        </div>

        {showSpeedFields ? (
          <section className="flex flex-col gap-3">
            <SectionHeading title={t('chat.model_settings.section.capabilities')} />
            <div className="rounded-lg border border-frame-border p-3">
              <ModelSpeedControlFields
                model={model}
                reasoningEffort={reasoningEffort}
                reasoningSummary={reasoningSummary}
                serviceTier={serviceTier}
                fastMode={fastMode}
                onReasoningEffortChange={onReasoningEffortChange}
                onReasoningSummaryChange={onReasoningSummaryChange}
                onServiceTierChange={onServiceTierChange}
                onFastModeChange={onFastModeChange}
              />
            </div>
          </section>
        ) : null}

        {showAssistantSection ? (
          <section className="flex flex-col gap-4">
            <SectionHeading
              title={t('chat.model_settings.section.assistant')}
              description={t('chat.model_settings.section.assistant_hint')}
            />
            {showTemperature && settings ? (
              <SamplingField
                label={t('library.config.basic.temperature')}
                hint={t('library.config.basic.field.temperature.hint')}
                enabled={settings.enableTemperature}
                value={settings.temperature}
                onEnabledChange={(enabled) => {
                  const patch: Partial<AssistantSettings> = { enableTemperature: enabled }
                  if (mutuallyExclusive && enabled) patch.enableTopP = false
                  void onPatchSettings?.(patch)
                }}
                onCommit={(value) => void onPatchSettings?.({ temperature: value })}
                min={0}
                max={2}
                step={0.1}
                precision={1}
              />
            ) : null}
            {showTopP && settings ? (
              <SamplingField
                label={t('library.config.basic.top_p')}
                hint={t('library.config.basic.field.top_p.hint')}
                enabled={settings.enableTopP}
                value={settings.topP}
                onEnabledChange={(enabled) => {
                  const patch: Partial<AssistantSettings> = { enableTopP: enabled }
                  if (mutuallyExclusive && enabled) patch.enableTemperature = false
                  void onPatchSettings?.(patch)
                }}
                onCommit={(value) => void onPatchSettings?.({ topP: value })}
                min={0}
                max={1}
                step={0.05}
                precision={2}
              />
            ) : null}
            {showMaxTokens && settings ? (
              <MaxTokensField
                enabled={settings.enableMaxTokens}
                value={settings.maxTokens}
                onEnabledChange={(enabled) => void onPatchSettings?.({ enableMaxTokens: enabled })}
                onCommit={(value) => void onPatchSettings?.({ maxTokens: value })}
              />
            ) : null}
          </section>
        ) : null}

        {!showSpeedFields && !showAssistantSection ? (
          <EmptyState
            className="px-0"
            title={t('chat.model_settings.empty.title')}
            description={t('chat.model_settings.empty.description')}
          />
        ) : null}
      </div>
    </Scrollbar>
  )
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="font-medium text-foreground text-xs">{title}</h3>
      {description ? <p className="text-muted-foreground text-[11px] leading-relaxed">{description}</p> : null}
    </div>
  )
}

type SamplingFieldProps = {
  label: string
  hint: string
  enabled: boolean
  value: number
  onEnabledChange: (enabled: boolean) => void
  onCommit: (value: number) => void
  min: number
  max: number
  step: number
  precision: number
}

const SamplingField: FC<SamplingFieldProps> = ({
  label,
  hint,
  enabled,
  value,
  onEnabledChange,
  onCommit,
  min,
  max,
  step,
  precision
}) => {
  const { t } = useTranslation()
  const [dragged, setDragged] = useState<number | null>(null)
  const shown = dragged ?? value

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="font-medium text-foreground">{label}</span>
            <HelpTooltip content={hint} iconProps={{ className: 'text-foreground-tertiary' }} />
          </div>
          <span className="text-muted-foreground text-[11px]">
            {enabled ? shown.toFixed(precision) : t('library.config.basic.default_value')}
          </span>
        </div>
        <Switch size="sm" aria-label={label} checked={enabled} onCheckedChange={onEnabledChange} />
      </div>
      {enabled ? (
        <Slider
          min={min}
          max={max}
          step={step}
          value={[shown]}
          aria-label={label}
          className={cn('w-full')}
          onValueChange={([next]) => setDragged(next)}
          onValueCommit={([next]) => {
            setDragged(null)
            onCommit(next)
          }}
        />
      ) : null}
    </div>
  )
}

function MaxTokensField({
  enabled,
  value,
  onEnabledChange,
  onCommit
}: {
  enabled: boolean
  value: number
  onEnabledChange: (enabled: boolean) => void
  onCommit: (value: number) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="font-medium text-foreground">{t('library.config.basic.max_tokens')}</span>
            <HelpTooltip
              content={t('library.config.basic.field.max_tokens.hint')}
              iconProps={{ className: 'text-foreground-tertiary' }}
            />
          </div>
          {!enabled ? (
            <span className="text-muted-foreground text-[11px]">{t('library.config.basic.default_value')}</span>
          ) : null}
        </div>
        <Switch
          size="sm"
          aria-label={t('library.config.basic.max_tokens')}
          checked={enabled}
          onCheckedChange={onEnabledChange}
        />
      </div>
      {enabled ? (
        <InputNumber
          min={1}
          max={Number.MAX_SAFE_INTEGER}
          step={1}
          aria-label={t('library.config.basic.max_tokens')}
          className="h-8 w-full max-w-[10rem] rounded-lg px-2.5"
          value={value}
          onBlur={(next) => onCommit(typeof next === 'number' && next > 0 ? next : UI_DEFAULT_MAX_TOKENS)}
        />
      ) : null}
    </div>
  )
}
