import type { TFunction } from 'i18next'
import type { ComponentPropsWithoutRef, KeyboardEventHandler, ReactNode, Ref } from 'react'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@cherrystudio/ui'
import { getModelDisplayTags, ModelTag, type ModelDisplayTag } from '@renderer/components/tags/Model'
import { deriveThinkingOptions } from '@shared/ai/reasoning'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { ModelSelectorPricing } from './ModelSelectorPricing'
import type { ModelSelectorModelItem } from './types'
import { getProviderDisplayName } from './utils'

type HoverCardPortalContainer = ComponentPropsWithoutRef<typeof HoverCardContent>['portalContainer']
type HoverCardSide = NonNullable<ComponentPropsWithoutRef<typeof HoverCardContent>['side']>
type HorizontalHoverCardSide = Extract<HoverCardSide, 'left' | 'right'>
type HoverCardAlign = NonNullable<ComponentPropsWithoutRef<typeof HoverCardContent>['align']>

const NUMBER_FORMATTER = new Intl.NumberFormat(undefined)
const DETAIL_CARD_TARGET_WIDTH = 336
const DETAIL_CARD_SIDE_OFFSET = 8
const DETAIL_CARD_COLLISION_PADDING = 12
const DETAIL_CARD_OPEN_DELAY = 1500

const REASONING_EFFORT_LABEL_KEYS: Record<string, string> = {
  auto: 'assistants.settings.reasoning_effort.auto',
  default: 'assistants.settings.reasoning_effort.default',
  high: 'assistants.settings.reasoning_effort.high',
  low: 'assistants.settings.reasoning_effort.low',
  max: 'assistants.settings.reasoning_effort.max',
  medium: 'assistants.settings.reasoning_effort.medium',
  minimal: 'assistants.settings.reasoning_effort.minimal',
  none: 'assistants.settings.reasoning_effort.off',
  ultra: 'assistants.settings.reasoning_effort.ultra',
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

function getViewportSize() {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0 }
  }

  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight
  }
}

function getAvailableSpaceForSide(
  triggerRect: DOMRect,
  side: HorizontalHoverCardSide,
  viewport: { width: number; height: number }
) {
  switch (side) {
    case 'right':
      return viewport.width - triggerRect.right - DETAIL_CARD_SIDE_OFFSET - DETAIL_CARD_COLLISION_PADDING
    case 'left':
      return triggerRect.left - DETAIL_CARD_SIDE_OFFSET - DETAIL_CARD_COLLISION_PADDING
  }
}

function getDetailCardSide(trigger: HTMLElement): HoverCardSide {
  const triggerRect = trigger.getBoundingClientRect()
  const viewport = getViewportSize()
  const rightSpace = getAvailableSpaceForSide(triggerRect, 'right', viewport)
  const leftSpace = getAvailableSpaceForSide(triggerRect, 'left', viewport)

  if (rightSpace >= DETAIL_CARD_TARGET_WIDTH) {
    return 'right'
  }

  if (leftSpace >= DETAIL_CARD_TARGET_WIDTH) {
    return 'left'
  }

  return 'bottom'
}

function getDetailCardAlign(): HoverCardAlign {
  return 'start'
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

export function ModelSelectorDetailCardContent({
  name,
  modelIdentifier,
  providerName,
  tags,
  model,
  provider,
  referenceTime,
  scrollRef,
  description
}: {
  name: string
  modelIdentifier: string
  providerName: string
  tags: readonly ModelDisplayTag[]
  model?: Model
  provider?: Provider
  referenceTime?: Date
  scrollRef?: Ref<HTMLDivElement>
  description?: ReactNode
}) {
  const { t } = useTranslation()
  const [mountedAt] = useState(() => new Date())
  const reasoningEfforts = formatReasoningEfforts(
    (model ? deriveThinkingOptions(model) : undefined)?.filter((option) => option !== 'default'),
    t
  )
  const imageModes = model ? formatImageGenerationModes(model, t) : undefined
  const hasTokenDetails =
    model && (model.contextWindow != null || model.maxInputTokens != null || model.maxOutputTokens != null)
  const hasCapabilityDetails = Boolean(reasoningEfforts || imageModes)
  const hasDescription = description != null && description !== '' && typeof description !== 'boolean'

  return (
    <div
      ref={scrollRef}
      className="max-h-[min(420px,70vh,var(--radix-hover-card-content-available-height,70vh))] overflow-auto p-3">
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-medium break-words text-foreground">{name}</div>
        {hasDescription ? <div className="text-xs text-muted-foreground">{description}</div> : null}
      </div>

      <dl className="mt-3 space-y-1.5 border-t border-border pt-3">
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
            <ModelTag key={tag} tag={tag} size={10} showLabel showTooltip={false} />
          ))}
        </div>
      ) : null}

      {model && hasTokenDetails ? (
        <dl className="mt-3 space-y-1.5 border-t border-border pt-3">
          <DetailRow label={t('models.detail.context_window')} value={formatNumber(model.contextWindow)} />
          <DetailRow label={t('models.detail.max_input_tokens')} value={formatNumber(model.maxInputTokens)} />
          <DetailRow label={t('models.detail.max_output_tokens')} value={formatNumber(model.maxOutputTokens)} />
        </dl>
      ) : null}

      {model ? (
        <ModelSelectorPricing model={model} provider={provider} referenceTime={referenceTime ?? mountedAt} />
      ) : null}

      {hasCapabilityDetails ? (
        <dl className="mt-3 space-y-1.5 border-t border-border pt-3">
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
  description,
  tags,
  children
}: {
  item: ModelSelectorModelItem
  provider: Provider
  portalContainer?: HoverCardPortalContainer | null
  description?: ReactNode
  tags?: readonly ModelDisplayTag[]
  children: ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const isOpen = useRef(false)
  const scrollDetails: KeyboardEventHandler<HTMLAnchorElement> = (event) => {
    const element = scrollRef.current
    if (!isOpen.current || !element || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key !== 'PageDown' && event.key !== 'PageUp') return
    event.preventDefault()
    event.stopPropagation()
    element.scrollBy({ top: (event.key === 'PageDown' ? 1 : -1) * element.clientHeight * 0.8 })
  }
  const [referenceTime, setReferenceTime] = useState(() => new Date())
  const refreshReferenceTime = useCallback((open: boolean) => {
    isOpen.current = open
    if (open) setReferenceTime(new Date())
  }, [])
  const resolvedTags = useMemo(
    () => tags ?? getModelDisplayTags(item.model, undefined, provider),
    [item.model, provider, tags]
  )
  return (
    <ModelSelectorHoverCard
      portalContainer={portalContainer}
      onOpenChange={refreshReferenceTime}
      onTriggerKeyDown={scrollDetails}
      content={
        <ModelSelectorDetailCardContent
          name={item.model.name}
          modelIdentifier={item.modelIdentifier}
          providerName={getProviderDisplayName(provider)}
          tags={resolvedTags}
          model={item.model}
          provider={provider}
          referenceTime={referenceTime}
          scrollRef={scrollRef}
          description={description}
        />
      }>
      {children}
    </ModelSelectorHoverCard>
  )
})

export function ModelSelectorHoverCard({
  children,
  portalContainer,
  content,
  onOpenChange,
  onTriggerKeyDown
}: {
  children: ReactNode
  portalContainer?: HoverCardPortalContainer | null
  content: ReactNode
  onOpenChange?: (open: boolean) => void
  onTriggerKeyDown?: KeyboardEventHandler<HTMLAnchorElement>
}) {
  const triggerRef = useRef<HTMLElement | null>(null)
  const [side, setSide] = useState<HoverCardSide>('right')
  const align = getDetailCardAlign()
  const setTriggerElement = useCallback((element: HTMLAnchorElement | null) => {
    triggerRef.current = element
  }, [])

  const updateSide = useCallback(() => {
    if (!triggerRef.current) {
      return
    }

    setSide(getDetailCardSide(triggerRef.current))
  }, [])

  return (
    <HoverCard
      openDelay={DETAIL_CARD_OPEN_DELAY}
      closeDelay={100}
      onOpenChange={(open) => {
        if (open) updateSide()
        onOpenChange?.(open)
      }}>
      <HoverCardTrigger asChild ref={setTriggerElement} onKeyDown={onTriggerKeyDown}>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        side={side}
        align={align}
        sideOffset={DETAIL_CARD_SIDE_OFFSET}
        collisionPadding={DETAIL_CARD_COLLISION_PADDING}
        portalContainer={portalContainer ?? undefined}
        className="w-84 max-w-(--radix-hover-card-content-available-width) p-0">
        {content}
      </HoverCardContent>
    </HoverCard>
  )
}
