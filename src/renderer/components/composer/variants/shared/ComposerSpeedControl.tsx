import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider
} from '@cherrystudio/ui'
import type { ThinkingOption } from '@renderer/types/reasoning'
import { cn } from '@renderer/utils/style'
import { deriveThinkingOptions, resolveReasoningEffortForModel } from '@shared/ai/reasoning'
import type { Model } from '@shared/data/types/model'
import { isUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { ReasoningEffortOptionSchema } from '@shared/types/aiSdk'
import { ChevronDown, Gauge, Zap } from 'lucide-react'
import { type ReactNode, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

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

const WHEEL_STEP_THRESHOLD = 40
const WHEEL_IDLE_RESET_MS = 120
export const COMPOSER_SPEED_CONTROL_TOOL_KEY = 'speed-control'

export interface ComposerSpeedControlState {
  reasoningEffort?: ThinkingOption
  fastMode?: Partial<Record<UniqueModelId, boolean>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readComposerSpeedControlState(value: unknown): ComposerSpeedControlState {
  if (!isRecord(value)) return {}

  const reasoningEffort = ReasoningEffortOptionSchema.safeParse(value.reasoningEffort)
  const fastMode = isRecord(value.fastMode)
    ? Object.fromEntries(
        Object.entries(value.fastMode).filter(
          (entry): entry is [UniqueModelId, boolean] => isUniqueModelId(entry[0]) && typeof entry[1] === 'boolean'
        )
      )
    : undefined

  return {
    ...(reasoningEffort.success && { reasoningEffort: reasoningEffort.data }),
    ...(fastMode && { fastMode })
  }
}

export interface ComposerSpeedControlTarget {
  model: Model
  fastMode: boolean
}

interface ComposerSpeedControlProps {
  targets: ComposerSpeedControlTarget[]
  reasoningEffort: ThinkingOption
  onReasoningEffortChange: (effort: ThinkingOption) => void
  onFastModeChange: (modelId: Model['id'], enabled: boolean) => void
}

interface SingleComposerSpeedControlProps extends ComposerSpeedControlTarget {
  reasoningEffort: ThinkingOption
  onReasoningEffortChange: (effort: ThinkingOption) => void
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

function SingleComposerSpeedControl({
  model,
  reasoningEffort,
  fastMode,
  onReasoningEffortChange,
  onFastModeChange
}: SingleComposerSpeedControlProps) {
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
  const effectiveReasoningEffort = resolveReasoningEffortForModel(model, reasoningEffort) ?? 'default'
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
          <span>{supportsReasoning ? effortLabel : triggerLabel}</span>
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
                {effortLabel}
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
            <WheelStepControl
              value={currentIndex}
              min={0}
              max={sliderEfforts.length - 1}
              className="relative mt-1.5 h-8"
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
                  'h-8',
                  '[&_[data-slot=slider-track]]:h-2.5 [&_[data-slot=slider-track]]:bg-muted [&_[data-slot=slider-track]]:shadow-inner',
                  '[&_[data-slot=slider-range]]:bg-primary',
                  '[&_[data-slot=slider-thumb]]:z-20 [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:rounded-full',
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

function MultiComposerSpeedControl({
  targets,
  reasoningEffort,
  onReasoningEffortChange,
  onFastModeChange
}: ComposerSpeedControlProps) {
  const { t } = useTranslation()
  const reasoningOptions = SLIDER_EFFORT_ORDER.filter((effort) =>
    targets.some(({ model }) => deriveThinkingOptions(model)?.includes(effort))
  )

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
          <span>{t('agent.speed.title')}</span>
          <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-72 overflow-hidden rounded-md border-frame-border p-1.5 text-xs shadow-xl">
        {reasoningOptions.length > 1 ? (
          <div className="flex items-center gap-2 px-2 py-2">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{t('agent.speed.effort')}</span>
            <Select
              value={reasoningEffort}
              onValueChange={(effort) => onReasoningEffortChange(effort as ThinkingOption)}>
              <SelectTrigger size="sm" className="w-28" aria-label={t('agent.speed.effort')}>
                <SelectValue>{t(EFFORT_LABEL_KEYS[reasoningEffort])}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {reasoningOptions.map((effort) => (
                  <SelectItem key={effort} value={effort} className="text-xs">
                    {t(EFFORT_LABEL_KEYS[effort])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {targets.map(({ model, fastMode }) => {
          const mappedEffort = resolveReasoningEffortForModel(model, reasoningEffort)

          return (
            <div key={model.id} className="flex items-center gap-2 border-border border-t px-2 py-2">
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{model.name}</span>
              <span className="text-muted-foreground">{t(EFFORT_LABEL_KEYS[mappedEffort ?? 'default'])}</span>
              {model.supportsFastMode === true ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={cn('shrink-0 rounded-full', fastMode && 'text-primary hover:text-primary')}
                  aria-label={`${model.name}: ${t('agent.speed.fast')}`}
                  aria-pressed={fastMode}
                  onClick={() => onFastModeChange(model.id, !fastMode)}>
                  <Zap size={14} fill={fastMode ? 'currentColor' : 'none'} />
                </Button>
              ) : null}
            </div>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

export function ComposerSpeedControl({
  targets,
  reasoningEffort,
  onReasoningEffortChange,
  onFastModeChange
}: ComposerSpeedControlProps) {
  const hasControls = targets.some((target) => {
    const reasoningOptions = deriveThinkingOptions(target.model) ?? []
    return reasoningOptions.length > 1 || target.model.supportsFastMode === true
  })

  if (!hasControls) return null
  if (targets.length > 1) {
    return (
      <MultiComposerSpeedControl
        targets={targets}
        reasoningEffort={reasoningEffort}
        onReasoningEffortChange={onReasoningEffortChange}
        onFastModeChange={onFastModeChange}
      />
    )
  }

  const target = targets[0]
  return (
    <SingleComposerSpeedControl
      {...target}
      reasoningEffort={reasoningEffort}
      onReasoningEffortChange={onReasoningEffortChange}
      onFastModeChange={(enabled) => onFastModeChange(target.model.id, enabled)}
    />
  )
}
