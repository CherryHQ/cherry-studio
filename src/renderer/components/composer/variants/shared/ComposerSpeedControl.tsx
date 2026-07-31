import { ChevronDown, Gauge, Zap } from 'lucide-react'
import { type ReactNode, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Popover, PopoverContent, PopoverTrigger, RadioGroup, RadioGroupItem, Slider } from '@cherrystudio/ui'
import type { ThinkingOption } from '@renderer/types/reasoning'
import { cn } from '@renderer/utils/style'
import { deriveThinkingOptions } from '@shared/ai/reasoning'
import type { Model, ReasoningSummary, ServiceTierSelection } from '@shared/data/types/model'

const SLIDER_EFFORT_ORDER: readonly ThinkingOption[] = [
  'default',
  'none',
  'auto',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
]

const EFFORT_LABEL_KEYS: Record<ThinkingOption, string> = {
  default: 'assistants.settings.reasoning_effort.default',
  none: 'assistants.settings.reasoning_effort.off',
  minimal: 'assistants.settings.reasoning_effort.minimal',
  low: 'assistants.settings.reasoning_effort.low',
  medium: 'assistants.settings.reasoning_effort.medium',
  high: 'assistants.settings.reasoning_effort.high',
  xhigh: 'assistants.settings.reasoning_effort.xhigh',
  max: 'assistants.settings.reasoning_effort.max',
  auto: 'assistants.settings.reasoning_effort.auto'
}

const SUMMARY_LABEL_KEYS: Record<ReasoningSummary, string> = {
  auto: 'agent.speed.summary.auto',
  concise: 'agent.speed.summary.concise',
  detailed: 'agent.speed.summary.detailed'
}

const SERVICE_TIER_LABEL_KEYS: Record<ServiceTierSelection, string> = {
  standard: 'agent.speed.service_tier.standard',
  auto: 'agent.speed.service_tier.auto',
  fast: 'agent.speed.service_tier.fast',
  flex: 'agent.speed.service_tier.flex'
}

const WHEEL_STEP_THRESHOLD = 40
const WHEEL_IDLE_RESET_MS = 120

interface ComposerSpeedControlProps {
  model: Model
  reasoningEffort: ThinkingOption
  serviceTier?: ServiceTierSelection
  fastMode: boolean
  /** Omit both to hide the summary row — surfaces where the selection has nowhere to persist. */
  reasoningSummary?: ReasoningSummary
  onReasoningEffortChange: (effort: ThinkingOption) => void
  onReasoningSummaryChange?: (summary: ReasoningSummary) => void
  onServiceTierChange?: (tier: ServiceTierSelection) => void
  onFastModeChange: (enabled: boolean) => void
}

interface WheelStepControlProps {
  children: ReactNode
  className?: string
  min: number
  max: number
  value: number
  onValueChange: (value: number) => void
}

function normalizeWheelDelta(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL) return event.deltaY
  return Math.sign(event.deltaY) * WHEEL_STEP_THRESHOLD
}

function WheelStepControl({ children, className, min, max, value, onValueChange }: WheelStepControlProps) {
  const wheelDeltaRef = useRef(0)
  const wheelIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.deltaY === 0) return

      const normalizedDelta = normalizeWheelDelta(event)
      const direction = normalizedDelta < 0 ? 1 : -1
      const nextValue = Math.min(Math.max(value + direction, min), max)

      if (nextValue === value) {
        wheelDeltaRef.current = 0
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (Math.sign(wheelDeltaRef.current) !== Math.sign(normalizedDelta)) wheelDeltaRef.current = 0
      wheelDeltaRef.current += normalizedDelta

      if (wheelIdleTimerRef.current) clearTimeout(wheelIdleTimerRef.current)
      wheelIdleTimerRef.current = setTimeout(() => {
        wheelDeltaRef.current = 0
      }, WHEEL_IDLE_RESET_MS)

      if (Math.abs(wheelDeltaRef.current) < WHEEL_STEP_THRESHOLD) return

      wheelDeltaRef.current = 0
      onValueChange(nextValue)
    },
    [max, min, onValueChange, value]
  )

  const setWheelTargetRef = useCallback(
    (wheelTarget: HTMLDivElement | null) => {
      if (!wheelTarget) return

      wheelTarget.addEventListener('wheel', handleWheel, { passive: false })
      return () => {
        wheelTarget.removeEventListener('wheel', handleWheel)
        wheelDeltaRef.current = 0
        if (wheelIdleTimerRef.current) clearTimeout(wheelIdleTimerRef.current)
        wheelIdleTimerRef.current = null
      }
    },
    [handleWheel]
  )

  return (
    <div ref={setWheelTargetRef} className={className}>
      {children}
    </div>
  )
}

/** Keep the submitted selection valid without changing the provider's Default semantics. */
export function resolveComposerReasoningEffort(model: Model, effort: ThinkingOption): ThinkingOption {
  const reasoningOptions = deriveThinkingOptions(model) ?? []

  return reasoningOptions.includes(effort) ? effort : 'default'
}

/** Use the endpoint default for this send without mutating an unsupported saved selection. */
export function resolveComposerServiceTier(model: Model, tier: ServiceTierSelection): ServiceTierSelection {
  const control = model.requestControls?.serviceTier
  if (!control) return 'standard'
  return control.options.includes(tier) ? tier : control.default
}

export function ComposerSpeedControl({
  model,
  reasoningEffort,
  reasoningSummary,
  serviceTier = 'standard',
  fastMode,
  onReasoningEffortChange,
  onReasoningSummaryChange,
  onServiceTierChange,
  onFastModeChange
}: ComposerSpeedControlProps) {
  const { t } = useTranslation()
  const reasoningOptions = useMemo(() => {
    const declaredEfforts = new Set(deriveThinkingOptions(model) ?? [])
    return SLIDER_EFFORT_ORDER.filter((effort) => declaredEfforts.has(effort))
  }, [model])
  const supportsReasoning = reasoningOptions.length > 1
  const supportsFast = model.supportsFastMode === true
  const serviceTierOptions = onServiceTierChange ? (model.requestControls?.serviceTier?.options ?? []) : []
  const supportsServiceTier = serviceTierOptions.length > 0
  // Only endpoints whose wire carries a summary knob project these; the wire's own default is 'auto'.
  const summaryOptions = onReasoningSummaryChange ? (model.reasoning?.summaryOptions ?? []) : []
  const selectedSummary: ReasoningSummary = reasoningSummary ?? 'auto'

  if (!supportsReasoning && !supportsServiceTier && !supportsFast) return null

  const sliderEfforts = reasoningOptions.filter((effort) => effort !== 'default')
  const showEffortSlider = sliderEfforts.filter((effort) => effort !== 'none' && effort !== 'auto').length > 1

  // Model changes reconcile in an effect owned by the composer. During that one render, preserve
  // provider Default rather than displaying or submitting an invalid explicit tier.
  const effectiveReasoningEffort = resolveComposerReasoningEffort(model, reasoningEffort)
  const selectedOption = supportsReasoning ? effectiveReasoningEffort : undefined
  const defaultSliderEffort = model.reasoning?.defaultEffort
  const sliderSelection =
    effectiveReasoningEffort === 'default' &&
    defaultSliderEffort !== undefined &&
    sliderEfforts.includes(defaultSliderEffort)
      ? defaultSliderEffort
      : effectiveReasoningEffort
  const selectedIndex = sliderSelection === 'default' ? -1 : sliderEfforts.indexOf(sliderSelection)
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0
  const displayedEffort = showEffortSlider ? effectiveReasoningEffort : selectedOption
  const effortLabel = displayedEffort ? t(EFFORT_LABEL_KEYS[displayedEffort]) : ''
  const effortControlLabel = t('agent.speed.effort')
  const serviceTierControlLabel = t('agent.speed.service_tier.label')
  const effectiveServiceTier = resolveComposerServiceTier(model, serviceTier)
  const serviceTierLabel = t(SERVICE_TIER_LABEL_KEYS[effectiveServiceTier])
  const triggerLabel = fastMode ? t('agent.speed.fast') : t('agent.speed.label')
  const handleSliderValueChange = (index: number) => {
    const effort = sliderEfforts[index]
    if (effort) onReasoningEffortChange(effort)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1 rounded-md px-2.5 text-muted-foreground text-xs hover:text-foreground"
          aria-label={t('agent.speed.title')}>
          <Gauge size={14} className="shrink-0" />
          <span>{supportsReasoning ? effortLabel : supportsServiceTier ? serviceTierLabel : triggerLabel}</span>
          {supportsReasoning && fastMode && supportsFast ? <span>· {t('agent.speed.fast')}</span> : null}
          <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-72 rounded-lg border-frame-border p-3 text-xs shadow-xl">
        {supportsReasoning || supportsFast ? (
          <div className="flex min-h-7 items-center gap-3">
            {supportsReasoning ? (
              <div className="flex min-w-0 items-baseline gap-1.5 text-xs">
                <span className="shrink-0 text-muted-foreground">{effortControlLabel}:</span>
                <span
                  data-testid="composer-effort-slider-label"
                  aria-live="polite"
                  className="truncate font-medium text-foreground">
                  {effortLabel}
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground">{t('agent.speed.label')}</span>
            )}
            {showEffortSlider || supportsFast ? (
              <div className="ml-auto flex shrink-0 items-center gap-0.5">
                {showEffortSlider && effectiveReasoningEffort !== 'default' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 rounded-md bg-muted/60 px-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    aria-pressed={false}
                    onClick={() => onReasoningEffortChange('default')}>
                    {t(EFFORT_LABEL_KEYS.default)}
                  </Button>
                ) : null}
                {supportsFast ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={cn('rounded-full', fastMode && 'text-primary hover:text-primary')}
                    aria-label={t('agent.speed.fast')}
                    aria-pressed={fastMode}
                    onClick={() => onFastModeChange(!fastMode)}>
                    <Zap size={14} fill={fastMode ? 'currentColor' : 'none'} />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {supportsReasoning && showEffortSlider ? (
          <div className="mt-2.5">
            <div className="flex items-center justify-between font-medium text-[11px] leading-none" aria-hidden="true">
              <span className="text-muted-foreground">{t('agent.speed.faster')}</span>
              <span className="text-primary">{t('agent.speed.smarter')}</span>
            </div>
            <WheelStepControl
              value={currentIndex}
              min={0}
              max={sliderEfforts.length - 1}
              className="relative mt-1.5 h-7"
              onValueChange={handleSliderValueChange}>
              <Slider
                value={[currentIndex]}
                min={0}
                max={sliderEfforts.length - 1}
                step={1}
                size="lg"
                getThumbAriaLabel={() => effortControlLabel}
                getThumbAriaValueText={() => effortLabel}
                className={cn(
                  'h-7',
                  '[&_[data-slot=slider-track]]:h-1.5 [&_[data-slot=slider-track]]:bg-muted [&_[data-slot=slider-track]]:shadow-inner',
                  '[&_[data-slot=slider-range]]:bg-primary',
                  '[&_[data-slot=slider-thumb]]:z-20 [&_[data-slot=slider-thumb]]:size-[18px] [&_[data-slot=slider-thumb]]:rounded-full',
                  '[&_[data-slot=slider-thumb]]:border-border [&_[data-slot=slider-thumb]]:bg-popover! [&_[data-slot=slider-thumb]]:shadow-sm',
                  '[&_[data-slot=slider-thumb]:hover]:ring-0'
                )}
                onValueChange={([index]) => handleSliderValueChange(index)}
              />
              <div className="pointer-events-none absolute inset-x-3 top-1/2 z-10 h-0">
                {sliderEfforts.map((effort, index) =>
                  index === currentIndex ? null : (
                    <span
                      key={effort}
                      data-slot="composer-effort-step"
                      data-index={index}
                      className="-translate-x-1/2 -translate-y-1/2 absolute size-1 rounded-full bg-background"
                      style={{ left: `${(index / (sliderEfforts.length - 1)) * 100}%` }}
                    />
                  )
                )}
              </div>
            </WheelStepControl>
          </div>
        ) : supportsReasoning ? (
          <RadioGroup
            value={displayedEffort}
            aria-label={effortControlLabel}
            className="mt-2 gap-0"
            onValueChange={(effort) => onReasoningEffortChange(effort as ThinkingOption)}>
            {reasoningOptions.map((effort) => (
              <label
                key={effort}
                className="flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-xs hover:bg-accent">
                <RadioGroupItem value={effort} size="sm" />
                <span>{t(EFFORT_LABEL_KEYS[effort])}</span>
              </label>
            ))}
          </RadioGroup>
        ) : null}
        {summaryOptions.length > 0 ? (
          <div className="mt-3 border-frame-border border-t pt-3">
            <span className="mb-2 block font-medium text-[11px] text-muted-foreground leading-none">
              {t('agent.speed.summary.label')}
            </span>
            <div
              role="group"
              aria-label={t('agent.speed.summary.label')}
              className="grid grid-cols-3 gap-1 rounded-lg bg-muted/70 p-1">
              {summaryOptions.map((summary) => (
                <Button
                  key={summary}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-8 min-w-0 rounded-md px-2 text-muted-foreground text-xs transition-colors',
                    selectedSummary === summary
                      ? 'bg-background text-foreground shadow-sm hover:bg-background hover:text-foreground'
                      : 'hover:bg-background/60 hover:text-foreground'
                  )}
                  aria-pressed={selectedSummary === summary}
                  onClick={() => onReasoningSummaryChange?.(summary)}>
                  {t(SUMMARY_LABEL_KEYS[summary])}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {supportsServiceTier ? (
          <div
            className={cn(
              (supportsReasoning || summaryOptions.length > 0) && 'mt-3 border-frame-border border-t pt-3'
            )}>
            <div className="mb-2 font-medium text-[11px] text-muted-foreground leading-none">
              {serviceTierControlLabel}
            </div>
            <RadioGroup
              value={effectiveServiceTier}
              aria-label={serviceTierControlLabel}
              className="gap-0"
              onValueChange={(tier) => onServiceTierChange?.(tier as ServiceTierSelection)}>
              {serviceTierOptions.map((tier) => (
                <label
                  key={tier}
                  className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent">
                  <RadioGroupItem value={tier} size="sm" aria-label={t(SERVICE_TIER_LABEL_KEYS[tier])} />
                  <span>{t(SERVICE_TIER_LABEL_KEYS[tier])}</span>
                </label>
              ))}
            </RadioGroup>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
