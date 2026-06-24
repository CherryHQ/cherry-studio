import { HoverCard, HoverCardContent, HoverCardTrigger } from '@cherrystudio/ui'
import { getModelDisplayTags, ModelTag } from '@renderer/components/Tags/Model'
import { getModelSupportedReasoningEffortOptions } from '@renderer/config/models/reasoning'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { TFunction } from 'i18next'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { ModelSelectorModelItem } from './types'
import { getProviderDisplayName } from './utils'

type HoverCardPortalContainer = ComponentPropsWithoutRef<typeof HoverCardContent>['portalContainer']

const NUMBER_FORMATTER = new Intl.NumberFormat(undefined)

const REASONING_EFFORT_LABEL_KEYS: Record<string, string> = {
  auto: 'assistants.settings.reasoning_effort.auto',
  default: 'assistants.settings.reasoning_effort.default',
  high: 'assistants.settings.reasoning_effort.high',
  low: 'assistants.settings.reasoning_effort.low',
  medium: 'assistants.settings.reasoning_effort.medium',
  minimal: 'assistants.settings.reasoning_effort.minimal',
  none: 'assistants.settings.reasoning_effort.off',
  xhigh: 'assistants.settings.reasoning_effort.xhigh'
}

const IMAGE_MODE_LABEL_KEYS: Record<string, string> = {
  edit: 'paintings.mode.edit',
  generate: 'paintings.mode.generate',
  merge: 'paintings.mode.merge',
  remix: 'paintings.mode.remix',
  upscale: 'paintings.mode.upscale'
}

function formatNumber(value: number | null | undefined): string | undefined {
  return value == null ? undefined : NUMBER_FORMATTER.format(value)
}

function compactList(values: readonly string[] | undefined, limit = 3): string | undefined {
  if (!values?.length) {
    return undefined
  }

  const visibleValues = values.slice(0, limit)
  const restCount = values.length - visibleValues.length
  return restCount > 0 ? `${visibleValues.join(', ')} +${restCount}` : visibleValues.join(', ')
}

function formatReasoningEfforts(values: readonly string[] | undefined, t: TFunction): string | undefined {
  return values?.map((value) => t(REASONING_EFFORT_LABEL_KEYS[value] ?? value)).join(', ')
}

function formatImageGenerationModes(model: Model, t: TFunction): string | undefined {
  const modes = Object.keys(model.imageGeneration?.modes ?? {})
  return compactList(modes.map((mode) => t(IMAGE_MODE_LABEL_KEYS[mode] ?? mode)))
}

function DetailRow({ label, value }: { label: ReactNode; value?: ReactNode }) {
  if (value == null || value === '') {
    return null
  }

  return (
    <div className="grid grid-cols-[6.75rem_minmax(0,1fr)] gap-3 text-xs leading-5">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-foreground">{value}</dd>
    </div>
  )
}

function ModelSelectorDetailCardBody({ item, providerName }: { item: ModelSelectorModelItem; providerName: string }) {
  const { t } = useTranslation()
  const { model, modelIdentifier } = item
  const tags = useMemo(() => getModelDisplayTags(model), [model])
  const reasoningEfforts = formatReasoningEfforts(getModelSupportedReasoningEffortOptions(model), t)
  const imageModes = formatImageGenerationModes(model, t)
  const hasTokenDetails = model.contextWindow != null || model.maxInputTokens != null || model.maxOutputTokens != null
  const hasCapabilityDetails = Boolean(reasoningEfforts || imageModes)

  return (
    <div className="max-h-[min(420px,70vh)] overflow-auto p-3">
      <div className="min-w-0 space-y-1">
        <div className="truncate font-medium text-foreground text-sm" title={model.name}>
          {model.name}
        </div>
      </div>

      <dl className="mt-3 space-y-1.5 border-border border-t pt-3">
        <DetailRow label={t('models.detail.provider')} value={providerName} />
        <DetailRow
          label={t('models.detail.model_id')}
          value={
            <span className="font-mono" title={modelIdentifier}>
              {modelIdentifier}
            </span>
          }
        />
      </dl>

      {tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <ModelTag key={`${item.key}-detail-${tag}`} tag={tag} size={10} showLabel showTooltip={false} />
          ))}
        </div>
      ) : null}

      {hasTokenDetails ? (
        <dl className="mt-3 space-y-1.5 border-border border-t pt-3">
          <DetailRow label={t('models.detail.context_window')} value={formatNumber(model.contextWindow)} />
          <DetailRow label={t('models.detail.max_input_tokens')} value={formatNumber(model.maxInputTokens)} />
          <DetailRow label={t('models.detail.max_output_tokens')} value={formatNumber(model.maxOutputTokens)} />
        </dl>
      ) : null}

      {hasCapabilityDetails ? (
        <dl className="mt-3 space-y-1.5 border-border border-t pt-3">
          <DetailRow label={t('assistants.settings.reasoning_effort.label')} value={reasoningEfforts} />
          <DetailRow label={t('models.detail.image_modes')} value={imageModes} />
        </dl>
      ) : null}
    </div>
  )
}

export const ModelSelectorDetailCard = memo(function ModelSelectorDetailCard({
  item,
  provider,
  portalContainer,
  children
}: {
  item: ModelSelectorModelItem
  provider: Provider
  portalContainer?: HoverCardPortalContainer | null
  children: ReactNode
}) {
  const providerName = getProviderDisplayName(provider)

  return (
    <HoverCard openDelay={450} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        portalContainer={portalContainer ?? undefined}
        className="w-84 p-0">
        <ModelSelectorDetailCardBody item={item} providerName={providerName} />
      </HoverCardContent>
    </HoverCard>
  )
})
