import { HoverCard, HoverCardContent, HoverCardTrigger } from '@cherrystudio/ui'
import { getModelDisplayTags, ModelTag } from '@renderer/components/tags/Model'
import { getModelSupportedReasoningEffortOptions } from '@renderer/utils/model'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { TFunction } from 'i18next'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ModelSelectorModelItem } from './types'
import { getProviderDisplayName } from './utils'

type HoverCardPortalContainer = ComponentPropsWithoutRef<typeof HoverCardContent>['portalContainer']
type HoverCardSide = NonNullable<ComponentPropsWithoutRef<typeof HoverCardContent>['side']>
type HoverCardAlign = NonNullable<ComponentPropsWithoutRef<typeof HoverCardContent>['align']>

const NUMBER_FORMATTER = new Intl.NumberFormat(undefined)
const DETAIL_CARD_TARGET_WIDTH = 336
const DETAIL_CARD_SIDE_OFFSET = 8
const DETAIL_CARD_COLLISION_PADDING = 12

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

function getViewportSize() {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0 }
  }

  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight
  }
}

type PlacementBounds = {
  left: number
  top: number
  right: number
  bottom: number
}

function getPlacementBounds(portalContainer: HoverCardPortalContainer | null | undefined): PlacementBounds {
  const viewport = getViewportSize()
  const viewportBounds = {
    left: 0,
    top: 0,
    right: viewport.width,
    bottom: viewport.height
  }

  if (!(portalContainer instanceof HTMLElement)) {
    return viewportBounds
  }

  const containerRect = portalContainer.getBoundingClientRect()
  const left = Math.max(viewportBounds.left, containerRect.left)
  const top = Math.max(viewportBounds.top, containerRect.top)
  const right = Math.min(viewportBounds.right, containerRect.right)
  const bottom = Math.min(viewportBounds.bottom, containerRect.bottom)

  if (right <= left || bottom <= top) {
    return viewportBounds
  }

  return { left, top, right, bottom }
}

function getAvailableSpaceForSide(triggerRect: DOMRect, side: HoverCardSide, bounds: PlacementBounds) {
  switch (side) {
    case 'right':
      return bounds.right - triggerRect.right - DETAIL_CARD_SIDE_OFFSET - DETAIL_CARD_COLLISION_PADDING
    case 'left':
      return triggerRect.left - bounds.left - DETAIL_CARD_SIDE_OFFSET - DETAIL_CARD_COLLISION_PADDING
    case 'bottom':
      return bounds.bottom - triggerRect.bottom - DETAIL_CARD_SIDE_OFFSET - DETAIL_CARD_COLLISION_PADDING
    case 'top':
      return triggerRect.top - bounds.top - DETAIL_CARD_SIDE_OFFSET - DETAIL_CARD_COLLISION_PADDING
  }
}

function getDetailCardSide(
  trigger: HTMLElement,
  portalContainer: HoverCardPortalContainer | null | undefined
): HoverCardSide {
  const triggerRect = trigger.getBoundingClientRect()
  const bounds = getPlacementBounds(portalContainer)
  const rightSpace = getAvailableSpaceForSide(triggerRect, 'right', bounds)
  const leftSpace = getAvailableSpaceForSide(triggerRect, 'left', bounds)

  if (rightSpace >= DETAIL_CARD_TARGET_WIDTH) {
    return 'right'
  }

  if (leftSpace >= DETAIL_CARD_TARGET_WIDTH) {
    return 'left'
  }

  return rightSpace >= leftSpace ? 'right' : 'left'
}

function getDetailCardAlign(side: HoverCardSide): HoverCardAlign {
  return side === 'left' || side === 'right' ? 'start' : 'center'
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
    <div className="max-h-[min(420px,70vh,var(--radix-hover-card-content-available-height,70vh))] overflow-auto p-3">
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
  const triggerRef = useRef<HTMLElement | null>(null)
  const [side, setSide] = useState<HoverCardSide>('right')
  const align = getDetailCardAlign(side)
  const setTriggerElement = useCallback((element: HTMLAnchorElement | null) => {
    triggerRef.current = element
  }, [])

  const updateSide = useCallback(() => {
    if (!triggerRef.current) {
      return
    }

    setSide(getDetailCardSide(triggerRef.current, portalContainer))
  }, [portalContainer])

  return (
    <HoverCard openDelay={450} closeDelay={100} onOpenChange={(open) => open && updateSide()}>
      <HoverCardTrigger asChild ref={setTriggerElement}>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        side={side}
        align={align}
        sideOffset={DETAIL_CARD_SIDE_OFFSET}
        collisionPadding={DETAIL_CARD_COLLISION_PADDING}
        collisionBoundary={portalContainer instanceof Element ? portalContainer : undefined}
        avoidCollisions={false}
        portalContainer={portalContainer ?? undefined}
        className="w-84 max-w-(--radix-hover-card-content-available-width) p-0">
        <ModelSelectorDetailCardBody item={item} providerName={providerName} />
      </HoverCardContent>
    </HoverCard>
  )
})
