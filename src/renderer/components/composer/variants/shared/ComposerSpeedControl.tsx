import { Button, Popover, PopoverContent, PopoverTrigger, RadioGroup, RadioGroupItem, Slider } from '@cherrystudio/ui'
import type { ThinkingOption } from '@renderer/types/reasoning'
import { cn } from '@renderer/utils/style'
import { deriveThinkingOptions } from '@shared/ai/reasoning'
import type { Model } from '@shared/data/types/model'
import { ChevronDown, Gauge, Zap } from 'lucide-react'
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const WHEEL_STEP_THRESHOLD = 40
const WHEEL_IDLE_RESET_MS = 120
const WHEEL_LINE_HEIGHT_PX = 16

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

function AnimatedEffortLabel({ label }: { label: string }) {
  return (
    <span
      key={label}
      className="motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-0.5 motion-safe:animate-in motion-safe:duration-100 motion-safe:ease-out">
      {label}
    </span>
  )
}

function normalizeWheelDelta(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL) return event.deltaY

  const estimatedPixels = Math.abs(event.deltaY) * WHEEL_LINE_HEIGHT_PX
  return Math.sign(event.deltaY) * Math.max(estimatedPixels, WHEEL_STEP_THRESHOLD)
}

interface ComposerEffortSliderProps {
  ariaLabel: string
  efforts: readonly ThinkingOption[]
  value: number
  valueText: string
  onChange: (effort: ThinkingOption) => void
}

function ComposerEffortSlider({ ariaLabel, efforts, value, valueText, onChange }: ComposerEffortSliderProps) {
  const wheelTargetRef = useRef<HTMLDivElement>(null)
  const wheelDeltaRef = useRef(0)
  const wheelIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleWheel = useEffectEvent((event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey || event.deltaY === 0) return

    event.preventDefault()
    event.stopPropagation()

    const normalizedDelta = normalizeWheelDelta(event)
    if (Math.sign(wheelDeltaRef.current) !== Math.sign(normalizedDelta)) wheelDeltaRef.current = 0
    wheelDeltaRef.current += normalizedDelta

    if (wheelIdleTimerRef.current) clearTimeout(wheelIdleTimerRef.current)
    wheelIdleTimerRef.current = setTimeout(() => {
      wheelDeltaRef.current = 0
    }, WHEEL_IDLE_RESET_MS)

    if (Math.abs(wheelDeltaRef.current) < WHEEL_STEP_THRESHOLD) return

    const direction = wheelDeltaRef.current < 0 ? 1 : -1
    wheelDeltaRef.current = 0
    const nextIndex = Math.min(Math.max(value + direction, 0), efforts.length - 1)
    const nextEffort = efforts[nextIndex]
    if (nextIndex !== value && nextEffort) onChange(nextEffort)
  })

  useEffect(() => {
    const wheelTarget = wheelTargetRef.current
    if (!wheelTarget) return

    wheelTarget.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      wheelTarget.removeEventListener('wheel', handleWheel)
      if (wheelIdleTimerRef.current) clearTimeout(wheelIdleTimerRef.current)
    }
    // `handleWheel` is an Effect Event that reads the latest effort state without re-subscribing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const progress = efforts.length > 1 ? value / (efforts.length - 1) : 0
  const thumbStepWidth = efforts.length > 1 ? 100 / (efforts.length - 1) : 100

  return (
    <div
      ref={wheelTargetRef}
      className={cn(
        'relative mt-1.5 h-8',
        '[&:has([data-slot=slider-thumb]:focus-visible)_[data-slot=composer-effort-thumb]]:ring-2',
        '[&:has([data-slot=slider-thumb]:focus-visible)_[data-slot=composer-effort-thumb]]:ring-primary/30',
        '[&:has([data-slot=slider-thumb]:focus-visible)_[data-slot=composer-effort-thumb]]:ring-inset'
      )}>
      <Slider
        value={[value]}
        min={0}
        max={efforts.length - 1}
        step={1}
        size="lg"
        getThumbAriaLabel={() => ariaLabel}
        getThumbAriaValueText={() => valueText}
        className={cn(
          'absolute inset-0 z-40 h-8',
          '[&_[data-slot=slider-track]]:h-2.5 [&_[data-slot=slider-track]]:bg-transparent',
          '[&_[data-slot=slider-range]]:bg-transparent',
          '[&_[data-slot=slider-thumb]]:z-20 [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:rounded-full',
          '[&_[data-slot=slider-thumb]]:border-transparent [&_[data-slot=slider-thumb]]:bg-transparent! [&_[data-slot=slider-thumb]]:opacity-0 [&_[data-slot=slider-thumb]]:shadow-none'
        )}
        onPointerDown={() => setIsDragging(true)}
        onPointerUp={() => setIsDragging(false)}
        onPointerCancel={() => setIsDragging(false)}
        onLostPointerCapture={() => setIsDragging(false)}
        onValueChange={([nextIndex]) => {
          const nextEffort = efforts[nextIndex]
          if (nextEffort) onChange(nextEffort)
        }}
      />
      <div className="-translate-y-1/2 pointer-events-none absolute inset-x-2.5 top-1/2 z-10 h-2.5 overflow-hidden rounded-full bg-muted shadow-inner">
        <div
          data-slot="composer-effort-range"
          className={cn(
            'absolute inset-0 origin-left bg-primary will-change-transform motion-reduce:transition-none',
            isDragging ? 'transition-none' : 'transition-transform duration-150 ease-out'
          )}
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
      <div className="pointer-events-none absolute inset-x-2.5 top-1/2 z-20 h-0">
        {efforts.map((effort, index) => (
          <span
            key={effort}
            data-slot="composer-effort-step"
            data-index={index}
            data-current={index === value}
            className="-translate-x-1/2 -translate-y-1/2 absolute size-1 rounded-full bg-background"
            style={{ left: `${(index / (efforts.length - 1)) * 100}%` }}
          />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-2.5 top-1/2 z-30 h-0">
        <div
          data-slot="composer-effort-thumb-motion"
          data-dragging={isDragging}
          className={cn(
            'absolute top-0 left-0 will-change-transform motion-reduce:transition-none',
            isDragging ? 'transition-none' : 'transition-transform duration-150 ease-out'
          )}
          style={{ transform: `translate3d(${value * 100}%, 0, 0)`, width: `${thumbStepWidth}%` }}>
          <span
            data-slot="composer-effort-thumb"
            className="-translate-x-1/2 -translate-y-1/2 absolute top-0 left-0 size-5 rounded-full border border-border bg-popover shadow-sm transition-shadow"
          />
        </div>
      </div>
    </div>
  )
}

/** Keep the submitted selection valid without changing the provider's Default semantics. */
export function resolveComposerReasoningEffort(model: Model, effort: ThinkingOption): ThinkingOption {
  const reasoningOptions = deriveThinkingOptions(model) ?? []

  return reasoningOptions.includes(effort) ? effort : 'default'
}

interface ComposerSpeedControlProps {
  model: Model
  reasoningEffort: ThinkingOption
  fastMode: boolean
  onReasoningEffortChange: (effort: ThinkingOption) => void
  onFastModeChange: (enabled: boolean) => void
}

export function ComposerSpeedControl({
  model,
  reasoningEffort,
  fastMode,
  onReasoningEffortChange,
  onFastModeChange
}: ComposerSpeedControlProps) {
  const { t } = useTranslation()
  const reasoningOptions = useMemo(() => {
    const declaredEfforts = new Set(deriveThinkingOptions(model) ?? [])
    return SLIDER_EFFORT_ORDER.filter((effort) => declaredEfforts.has(effort))
  }, [model])
  const supportsReasoning = reasoningOptions.length > 1
  const supportsFast = model.supportsFastMode === true

  if (!supportsReasoning && !supportsFast) return null

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
  const triggerLabel = fastMode ? t('agent.speed.fast') : t('agent.speed.label')

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
          {supportsReasoning ? (
            <span className="inline-flex overflow-hidden">
              <AnimatedEffortLabel label={effortLabel} />
            </span>
          ) : (
            <span>{triggerLabel}</span>
          )}
          {supportsReasoning && fastMode && supportsFast ? <span>· {t('agent.speed.fast')}</span> : null}
          <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-56 overflow-hidden rounded-md border-frame-border p-1.5 text-xs shadow-xl">
        <div className="flex h-10 items-center px-2">
          {supportsReasoning ? (
            <div className="flex min-w-0 items-baseline gap-1 text-xs">
              <span className="shrink-0 text-muted-foreground">{effortControlLabel}:</span>
              <span
                data-testid="composer-effort-slider-label"
                aria-live="polite"
                className="truncate font-medium text-foreground">
                <AnimatedEffortLabel label={effortLabel} />
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground">{t('agent.speed.label')}</span>
          )}
          {showEffortSlider || supportsFast ? (
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              {showEffortSlider ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-7 rounded-md px-2 text-muted-foreground text-xs',
                    effectiveReasoningEffort === 'default' && 'text-primary hover:text-primary'
                  )}
                  aria-pressed={effectiveReasoningEffort === 'default'}
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
        {supportsReasoning && showEffortSlider ? (
          <div className="mx-2.5 mt-1 mb-2">
            <div className="flex items-center justify-between font-medium text-[11px]" aria-hidden="true">
              <span className="text-muted-foreground">{t('agent.speed.faster')}</span>
              <span className="text-primary">{t('agent.speed.smarter')}</span>
            </div>
            <ComposerEffortSlider
              ariaLabel={effortControlLabel}
              efforts={sliderEfforts}
              value={currentIndex}
              valueText={effortLabel}
              onChange={onReasoningEffortChange}
            />
          </div>
        ) : supportsReasoning ? (
          <RadioGroup
            value={displayedEffort}
            aria-label={effortControlLabel}
            className="gap-0"
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
      </PopoverContent>
    </Popover>
  )
}
