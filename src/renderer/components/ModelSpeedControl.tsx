/**
 * Speed popover for a model: reasoning effort, reasoning summary, service tier
 * and fast mode. Every row hides itself unless the model declares the knob;
 * the three optional ones also need a handler, so a surface with nowhere to
 * persist a selection is not offered it. The whole popover hides when no row
 * survives.
 */

import './ModelSpeedControl.css'
import { ChevronDown, Gauge, Zap } from 'lucide-react'
import { type ComponentProps, type ReactNode, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Popover, PopoverContent, PopoverTrigger, RadioGroup, RadioGroupItem, Slider } from '@cherrystudio/ui'
import type { ThinkingOption } from '@renderer/types/reasoning'
import { reasoningEffortLabel } from '@renderer/utils/reasoning'
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
  'max',
  'ultra'
]

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

const SERVICE_TIER_DESCRIPTION_KEYS: Record<ServiceTierSelection, string> = {
  standard: 'agent.speed.service_tier.standard.description',
  auto: 'agent.speed.service_tier.auto.description',
  fast: 'agent.speed.service_tier.fast.description',
  flex: 'agent.speed.service_tier.flex.description'
}

// Canonical tier order, used only to slot a stored-but-unsupported tier among the declared options.
const SERVICE_TIER_ORDER: readonly ServiceTierSelection[] = ['standard', 'auto', 'fast', 'flex']

const WHEEL_STEP_THRESHOLD = 40
const WHEEL_IDLE_RESET_MS = 120

interface ModelSpeedControlProps {
  model: Model
  reasoningEffort: ThinkingOption
  serviceTier?: ServiceTierSelection
  fastMode?: boolean
  /** Which way the popover opens; defaults to 'top', but a top bar wants 'bottom'. */
  side?: ComponentProps<typeof PopoverContent>['side']
  /** Omit both to hide the summary row — surfaces where the selection has nowhere to persist. */
  reasoningSummary?: ReasoningSummary
  onReasoningEffortChange: (effort: ThinkingOption) => void
  onReasoningSummaryChange?: (summary: ReasoningSummary) => void
  onServiceTierChange?: (tier: ServiceTierSelection) => void
  /** Omitting the handler hides the fast toggle — a surface with nowhere to persist it. */
  onFastModeChange?: (enabled: boolean) => void
}

export interface ReasoningEffortControlOption {
  value: string
  label: string
  /** Normalized tier key used for ordering and default/off quick buttons (e.g. 'default', 'none', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'). */
  tier?: string
}

export interface ReasoningEffortControlProps {
  options: readonly ReasoningEffortControlOption[]
  currentValue: string
  disabled?: boolean
  readOnlyNotice?: string
  side?: ComponentProps<typeof PopoverContent>['side']
  onChange: (value: string) => void
}

interface OrderedEffortOption extends ReasoningEffortControlOption {
  normalizedTier?: string
}

function normalizeEffortTier(tier?: string): string | undefined {
  const normalized = tier?.trim().toLowerCase()
  if (!normalized) return undefined
  return normalized === 'off' ? 'none' : normalized
}

function sortEffortOptions(options: readonly ReasoningEffortControlOption[]): OrderedEffortOption[] {
  return options
    .map((option, originalIndex) => ({
      option: {
        ...option,
        normalizedTier: normalizeEffortTier(option.tier ?? option.value)
      },
      originalIndex
    }))
    .sort((a, b) => {
      const aRank = a.option.normalizedTier
        ? SLIDER_EFFORT_ORDER.indexOf(a.option.normalizedTier as ThinkingOption)
        : -1
      const bRank = b.option.normalizedTier
        ? SLIDER_EFFORT_ORDER.indexOf(b.option.normalizedTier as ThinkingOption)
        : -1
      const aOrder = aRank >= 0 ? aRank : SLIDER_EFFORT_ORDER.length + a.originalIndex
      const bOrder = bRank >= 0 ? bRank : SLIDER_EFFORT_ORDER.length + b.originalIndex
      return aOrder - bOrder
    })
    .map((entry) => entry.option)
}

interface WheelStepControlProps {
  children: ReactNode
  className?: string
  disabled?: boolean
  min: number
  max: number
  value: number
  onValueChange: (value: number) => void
}

function normalizeWheelDelta(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL) return event.deltaY
  return Math.sign(event.deltaY) * WHEEL_STEP_THRESHOLD
}

function WheelStepControl({
  children,
  className,
  disabled = false,
  min,
  max,
  value,
  onValueChange
}: WheelStepControlProps) {
  const wheelDeltaRef = useRef(0)
  const wheelIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (disabled || event.ctrlKey || event.metaKey || event.deltaY === 0) return

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
    [disabled, max, min, onValueChange, value]
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

/**
 * Coerce a selection to something this model declares, falling back to provider
 * Default rather than guessing a neighbouring effort. The control displays this
 * value; a caller that submits should send the same one so the wire matches the
 * UI. Whether the coerced value is written back is the caller's policy.
 */
export function resolveSupportedReasoningEffort(model: Model, effort: ThinkingOption): ThinkingOption {
  const reasoningOptions = deriveThinkingOptions(model) ?? []

  return reasoningOptions.includes(effort) ? effort : 'default'
}

/** Coerce a selection to one this model's endpoint declares — its default tier, or Standard when it declares no tiers at all. */
export function resolveSupportedServiceTier(model: Model, tier: ServiceTierSelection): ServiceTierSelection {
  const control = model.requestControls?.serviceTier
  if (!control) return 'standard'
  return control.options.includes(tier) ? tier : control.default
}

interface ReasoningEffortSectionProps {
  supportsReasoning: boolean
  showEffortSlider: boolean
  effortControlLabel: string
  effortLabel: string
  headerFallbackLabel?: string
  defaultAction?: { label: string; onClick: () => void }
  disableAction?: { label: string; onClick: () => void }
  headerExtra?: ReactNode
  sliderOptions: readonly { value: string; label: string }[]
  currentIndex: number
  isPeakEffort: boolean
  peakBurst: number
  onSliderValueChange: (index: number) => void
  radioValue?: string
  radioOptions: readonly { value: string; label: string }[]
  onRadioValueChange: (value: string) => void
  disabled?: boolean
  readOnlyNotice?: string
}

function ReasoningEffortSection({
  supportsReasoning,
  showEffortSlider,
  effortControlLabel,
  effortLabel,
  headerFallbackLabel,
  defaultAction,
  disableAction,
  headerExtra,
  sliderOptions,
  currentIndex,
  isPeakEffort,
  peakBurst,
  onSliderValueChange,
  radioValue,
  radioOptions,
  onRadioValueChange,
  disabled = false,
  readOnlyNotice
}: ReasoningEffortSectionProps) {
  const { t } = useTranslation()
  const showHeaderActions = showEffortSlider || Boolean(headerExtra)

  return (
    <>
      {readOnlyNotice ? (
        <p role="status" className="mb-2 text-xs text-muted-foreground">
          {readOnlyNotice}
        </p>
      ) : null}
      {supportsReasoning || headerFallbackLabel ? (
        <div className="flex min-h-7 items-center gap-3">
          {supportsReasoning ? (
            <div className="flex min-w-0 items-baseline gap-1.5 text-xs">
              <span className="shrink-0 text-muted-foreground">{effortControlLabel}:</span>
              <span
                data-testid="model-speed-effort-label"
                aria-live="polite"
                className="truncate font-medium text-foreground">
                {effortLabel}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground">{headerFallbackLabel}</span>
          )}
          {showHeaderActions ? (
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              {showEffortSlider && defaultAction ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  className="h-6 rounded-md bg-muted/60 px-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  aria-pressed={false}
                  onClick={defaultAction.onClick}>
                  {defaultAction.label}
                </Button>
              ) : null}
              {disableAction ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  className="h-6 rounded-md bg-muted/60 px-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  aria-pressed={false}
                  onClick={disableAction.onClick}>
                  {disableAction.label}
                </Button>
              ) : null}
              {headerExtra}
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
            disabled={disabled}
            value={currentIndex}
            min={0}
            max={sliderOptions.length - 1}
            className="relative mt-1.5 h-7"
            onValueChange={onSliderValueChange}>
            <Slider
              value={[currentIndex]}
              min={0}
              max={sliderOptions.length - 1}
              step={1}
              snapOnRelease
              disabled={disabled || undefined}
              size="lg"
              getThumbAriaLabel={() => effortControlLabel}
              getThumbAriaValueText={() => effortLabel}
              className={cn(
                'model-speed-effort-slider h-7',
                isPeakEffort && 'model-speed-effort-slider-peak',
                'cursor-pointer [&_[data-slot=slider-track]]:h-4 [&_[data-slot=slider-track]]:bg-muted',
                '[&_[data-slot=slider-range]]:bg-primary',
                '[&_[data-slot=slider-thumb]]:z-20 [&_[data-slot=slider-thumb]]:size-[18px] [&_[data-slot=slider-thumb]]:rounded-full',
                '[&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-popover! [&_[data-slot=slider-thumb]]:shadow-xs',
                '[&_[data-slot=slider-thumb]:hover]:ring-0'
              )}
              onValueChange={([index]) => onSliderValueChange(index)}
            />
            {isPeakEffort && peakBurst > 0 ? (
              <span key={peakBurst} aria-hidden="true" className="model-speed-effort-splash">
                <span />
                <span />
                <span />
                <span />
                <span />
              </span>
            ) : null}
            <div className="pointer-events-none absolute inset-x-[9px] top-1/2 z-10 h-0">
              {sliderOptions.map((option, index) => (
                <span
                  key={option.value}
                  data-slot="model-speed-effort-step"
                  data-index={index}
                  className={cn(
                    '-translate-x-1/2 -translate-y-1/2 absolute size-0.5 rounded-full bg-background transition-opacity duration-100 motion-reduce:transition-none',
                    index === currentIndex && 'opacity-0'
                  )}
                  style={{ left: `${(index / (sliderOptions.length - 1)) * 100}%` }}
                />
              ))}
            </div>
          </WheelStepControl>
        </div>
      ) : supportsReasoning ? (
        <RadioGroup
          value={radioValue}
          aria-label={effortControlLabel}
          className="mt-2 gap-0"
          onValueChange={(value) => {
            if (!disabled) onRadioValueChange(value)
          }}>
          {radioOptions.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex h-8 items-center gap-2 rounded-sm px-2 text-xs',
                disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-accent'
              )}>
              <RadioGroupItem value={option.value} size="sm" disabled={disabled || undefined} />
              <span>{option.label}</span>
            </label>
          ))}
        </RadioGroup>
      ) : null}
    </>
  )
}

export function ModelSpeedControl({
  model,
  reasoningEffort,
  reasoningSummary,
  serviceTier = 'standard',
  fastMode = false,
  side = 'top',
  onReasoningEffortChange,
  onReasoningSummaryChange,
  onServiceTierChange,
  onFastModeChange
}: ModelSpeedControlProps) {
  const { t } = useTranslation()
  const [peakBurst, setPeakBurst] = useState(0)
  const reasoningOptions = useMemo(() => {
    const declaredEfforts = new Set(deriveThinkingOptions(model) ?? [])
    return SLIDER_EFFORT_ORDER.filter((effort) => declaredEfforts.has(effort))
  }, [model])
  const supportsReasoning = reasoningOptions.length > 1
  const supportsFast = onFastModeChange !== undefined && model.supportsFastMode === true
  const serviceTierOptions = onServiceTierChange ? (model.requestControls?.serviceTier?.options ?? []) : []
  const supportsServiceTier = serviceTierOptions.length > 0
  // The saved tier stays visible (disabled) when the active model does not declare it.
  const storedServiceTier = serviceTier
  const serviceTierValues = onServiceTierChange ? model.requestControls?.serviceTier?.values : undefined
  const displayedServiceTiers = serviceTierOptions.includes(storedServiceTier)
    ? serviceTierOptions
    : SERVICE_TIER_ORDER.filter((tier) => serviceTierOptions.includes(tier) || tier === storedServiceTier)
  const [showServiceTierDetails, setShowServiceTierDetails] = useState(false)
  // Only endpoints whose wire carries a summary knob project these; the wire's own default is 'auto'.
  const summaryOptions = onReasoningSummaryChange ? (model.reasoning?.summaryOptions ?? []) : []
  const selectedSummary: ReasoningSummary = reasoningSummary ?? 'auto'

  if (!supportsReasoning && !supportsServiceTier && !supportsFast) return null

  const sliderEfforts = reasoningOptions.filter((effort) => effort !== 'default')
  const supportsDisableThinking = sliderEfforts.includes('none')
  const showEffortSlider = sliderEfforts.filter((effort) => effort !== 'none' && effort !== 'auto').length > 1

  // A model swap reconciles in an effect owned by the caller. During that one render, preserve
  // provider Default rather than displaying an explicit value the new model rejects.
  const effectiveReasoningEffort = resolveSupportedReasoningEffort(model, reasoningEffort)
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
  const isPeakEffort = effectiveReasoningEffort !== 'default' && currentIndex === sliderEfforts.length - 1
  const displayedEffort = showEffortSlider ? effectiveReasoningEffort : selectedOption
  const effortLabel = displayedEffort ? reasoningEffortLabel(displayedEffort, t) : ''
  const effortControlLabel = t('agent.speed.effort')
  const serviceTierControlLabel = t('agent.speed.service_tier.label')
  const effectiveServiceTier = resolveSupportedServiceTier(model, serviceTier)
  const serviceTierDiffers = storedServiceTier !== effectiveServiceTier
  const serviceTierLabel = serviceTierDiffers
    ? `${t(SERVICE_TIER_LABEL_KEYS[storedServiceTier])} → ${t(SERVICE_TIER_LABEL_KEYS[effectiveServiceTier])}`
    : t(SERVICE_TIER_LABEL_KEYS[effectiveServiceTier])
  const triggerLabel = fastMode ? t('agent.speed.fast') : t('agent.speed.label')
  const handleSliderValueChange = (index: number) => {
    const effort = sliderEfforts[index]
    if (effort) {
      if (index === sliderEfforts.length - 1 && !isPeakEffort) setPeakBurst((burst) => burst + 1)
      onReasoningEffortChange(effort)
    }
  }

  return (
    <Popover onOpenChange={() => setPeakBurst(0)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 rounded-md px-1.5 text-muted-foreground text-xs hover:text-foreground focus-visible:text-foreground dark:text-foreground dark:hover:text-foreground dark:focus-visible:text-foreground"
          aria-label={t('agent.speed.title')}>
          <Gauge size={14} className="shrink-0" />
          <span>{supportsReasoning ? effortLabel : supportsServiceTier ? serviceTierLabel : triggerLabel}</span>
          {supportsReasoning && fastMode && supportsFast ? <span>· {t('agent.speed.fast')}</span> : null}
          <ChevronDown size={13} className="shrink-0 text-muted-foreground dark:text-current" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align="end"
        sideOffset={8}
        className="w-72 rounded-lg border-frame-border p-3 text-xs shadow-xl">
        {supportsReasoning || supportsFast ? (
          <ReasoningEffortSection
            supportsReasoning={supportsReasoning}
            showEffortSlider={showEffortSlider}
            effortControlLabel={effortControlLabel}
            effortLabel={effortLabel}
            headerFallbackLabel={t('agent.speed.label')}
            defaultAction={
              effectiveReasoningEffort !== 'default'
                ? { label: reasoningEffortLabel('default', t), onClick: () => onReasoningEffortChange('default') }
                : undefined
            }
            disableAction={
              supportsDisableThinking && effectiveReasoningEffort !== 'none'
                ? { label: reasoningEffortLabel('none', t), onClick: () => onReasoningEffortChange('none') }
                : undefined
            }
            headerExtra={
              supportsFast ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={cn('rounded-full', fastMode && 'text-primary hover:text-primary')}
                  aria-label={t('agent.speed.fast')}
                  aria-pressed={fastMode}
                  onClick={() => onFastModeChange?.(!fastMode)}>
                  <Zap size={14} fill={fastMode ? 'currentColor' : 'none'} />
                </Button>
              ) : null
            }
            sliderOptions={sliderEfforts.map((effort) => ({ value: effort, label: reasoningEffortLabel(effort, t) }))}
            currentIndex={currentIndex}
            isPeakEffort={isPeakEffort}
            peakBurst={peakBurst}
            onSliderValueChange={handleSliderValueChange}
            radioValue={displayedEffort}
            radioOptions={reasoningOptions.map((effort) => ({ value: effort, label: reasoningEffortLabel(effort, t) }))}
            onRadioValueChange={(effort) => onReasoningEffortChange(effort as ThinkingOption)}
          />
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
            <div className="mb-2 flex items-center justify-between leading-none">
              <span className="font-medium text-[11px] text-muted-foreground">{serviceTierControlLabel}</span>
              {serviceTierValues && Object.values(serviceTierValues).some(Boolean) ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={showServiceTierDetails}
                  className="h-5 px-1 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => setShowServiceTierDetails((shown) => !shown)}>
                  {t('agent.speed.service_tier.details')}
                </Button>
              ) : null}
            </div>
            <RadioGroup
              value={storedServiceTier}
              aria-label={serviceTierControlLabel}
              className="gap-0"
              onValueChange={(tier) => onServiceTierChange?.(tier as ServiceTierSelection)}>
              {displayedServiceTiers.map((tier) => {
                const isUnsupportedStoredTier = tier === storedServiceTier && serviceTierDiffers
                return (
                  <label
                    key={tier}
                    className={cn(
                      'flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors',
                      isUnsupportedStoredTier ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-accent'
                    )}>
                    <RadioGroupItem
                      value={tier}
                      size="sm"
                      disabled={isUnsupportedStoredTier}
                      aria-label={t(SERVICE_TIER_LABEL_KEYS[tier])}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span>{t(SERVICE_TIER_LABEL_KEYS[tier])}</span>
                      <span className="text-muted-foreground">{t(SERVICE_TIER_DESCRIPTION_KEYS[tier])}</span>
                      {isUnsupportedStoredTier ? (
                        <span className="text-muted-foreground">
                          {t('agent.speed.service_tier.unsupported', {
                            effective: t(SERVICE_TIER_LABEL_KEYS[effectiveServiceTier])
                          })}
                        </span>
                      ) : null}
                      {showServiceTierDetails && serviceTierValues?.[tier] ? (
                        <span className="text-muted-foreground">
                          {t('agent.speed.service_tier.provider_value', { value: serviceTierValues[tier] })}
                        </span>
                      ) : null}
                    </span>
                  </label>
                )
              })}
            </RadioGroup>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

export function ReasoningEffortControl({
  options,
  currentValue,
  disabled = false,
  readOnlyNotice,
  side = 'top',
  onChange
}: ReasoningEffortControlProps) {
  const { t } = useTranslation()
  const [peakBurst, setPeakBurst] = useState(0)
  const orderedOptions = useMemo(() => sortEffortOptions(options), [options])

  if (orderedOptions.length <= 1) return null

  const defaultOption = orderedOptions.find((option) => option.normalizedTier === 'default')
  const disableOption = orderedOptions.find((option) => option.normalizedTier === 'none')
  const sliderOptions = orderedOptions.filter((option) => option.normalizedTier !== 'default')
  const showEffortSlider =
    sliderOptions.filter((option) => option.normalizedTier !== 'none' && option.normalizedTier !== 'auto').length > 1
  const currentOption = orderedOptions.find((option) => option.value === currentValue)
  const effortLabel = currentOption?.label ?? currentValue
  const effortControlLabel = t('agent.speed.effort')
  const selectedIndex =
    currentOption?.normalizedTier === 'default'
      ? -1
      : sliderOptions.findIndex((option) => option.value === currentValue)
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0
  const isPeakEffort =
    currentOption?.normalizedTier !== 'default' && sliderOptions.length > 0 && currentIndex === sliderOptions.length - 1

  const selectValue = (nextValue: string) => {
    if (disabled || nextValue === currentValue) return
    onChange(nextValue)
  }

  const handleSliderValueChange = (index: number) => {
    if (disabled) return
    const nextOption = sliderOptions[index]
    if (!nextOption || nextOption.value === currentValue) return
    if (index === sliderOptions.length - 1 && !isPeakEffort) setPeakBurst((burst) => burst + 1)
    onChange(nextOption.value)
  }

  return (
    <Popover onOpenChange={() => setPeakBurst(0)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 rounded-md px-1.5 text-muted-foreground text-xs hover:text-foreground focus-visible:text-foreground dark:text-foreground dark:hover:text-foreground dark:focus-visible:text-foreground"
          aria-label={t('agent.speed.title')}>
          <Gauge size={14} className="shrink-0" />
          <span>{effortLabel}</span>
          <ChevronDown size={13} className="shrink-0 text-muted-foreground dark:text-current" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align="end"
        sideOffset={8}
        className="w-72 rounded-lg border-frame-border p-3 text-xs shadow-xl">
        <ReasoningEffortSection
          supportsReasoning
          showEffortSlider={showEffortSlider}
          effortControlLabel={effortControlLabel}
          effortLabel={effortLabel}
          defaultAction={
            defaultOption && currentValue !== defaultOption.value
              ? { label: defaultOption.label, onClick: () => selectValue(defaultOption.value) }
              : undefined
          }
          disableAction={
            disableOption && currentValue !== disableOption.value
              ? { label: disableOption.label, onClick: () => selectValue(disableOption.value) }
              : undefined
          }
          sliderOptions={sliderOptions}
          currentIndex={currentIndex}
          isPeakEffort={isPeakEffort}
          peakBurst={peakBurst}
          onSliderValueChange={handleSliderValueChange}
          radioValue={currentValue}
          radioOptions={orderedOptions}
          onRadioValueChange={selectValue}
          disabled={disabled}
          readOnlyNotice={disabled ? readOnlyNotice : undefined}
        />
      </PopoverContent>
    </Popover>
  )
}
