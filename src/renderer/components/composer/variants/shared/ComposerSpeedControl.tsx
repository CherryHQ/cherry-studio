import { Button, Popover, PopoverContent, PopoverTrigger, RadioGroup, RadioGroupItem, Slider } from '@cherrystudio/ui'
import type { ThinkingOption } from '@renderer/types/reasoning'
import { cn } from '@renderer/utils/style'
import { deriveThinkingOptions } from '@shared/ai/reasoning'
import type { Model } from '@shared/data/types/model'
import { ChevronDown, Gauge, Zap } from 'lucide-react'
import { useMemo } from 'react'
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
  const sliderEfforts = reasoningOptions.filter((effort) => effort !== 'default')
  const supportsReasoning = reasoningOptions.length > 1
  const showEffortSlider = sliderEfforts.filter((effort) => effort !== 'none' && effort !== 'auto').length > 1
  const supportsFast = model.supportsFastMode === true

  if (!supportsReasoning && !supportsFast) return null

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
  const triggerLabel = supportsReasoning ? effortLabel : fastMode ? t('agent.speed.fast') : t('agent.speed.label')

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
          <span>{triggerLabel}</span>
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
              <span className="shrink-0 text-muted-foreground">{t('agent.speed.effort')}:</span>
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
          {supportsFast ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn('ml-auto rounded-full', fastMode && 'text-control-accent hover:text-control-accent')}
              aria-label={t('agent.speed.fast')}
              aria-pressed={fastMode}
              onClick={() => onFastModeChange(!fastMode)}>
              <Zap size={14} fill={fastMode ? 'currentColor' : 'none'} />
            </Button>
          ) : null}
        </div>
        {supportsReasoning && showEffortSlider ? (
          <div className="mx-2.5 mt-1 mb-2">
            <div className="flex items-center justify-between font-medium text-[11px]" aria-hidden="true">
              <span className="text-muted-foreground">{t('agent.speed.faster')}</span>
              <span className="text-control-accent">{t('agent.speed.smarter')}</span>
            </div>
            <div className="relative mt-1.5 h-8">
              <Slider
                value={[currentIndex]}
                min={0}
                max={sliderEfforts.length - 1}
                step={1}
                size="lg"
                getThumbAriaLabel={() => t('agent.speed.effort')}
                getThumbAriaValueText={() => effortLabel}
                className={cn(
                  'h-8',
                  '[&_[data-slot=slider-track]]:h-2.5 [&_[data-slot=slider-track]]:bg-muted [&_[data-slot=slider-track]]:shadow-inner',
                  '[&_[data-slot=slider-range]]:bg-control-accent',
                  '[&_[data-slot=slider-thumb]]:z-20 [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:rounded-full',
                  '[&_[data-slot=slider-thumb]]:border-border [&_[data-slot=slider-thumb]]:bg-popover! [&_[data-slot=slider-thumb]]:shadow-sm',
                  '[&_[data-slot=slider-thumb]:hover]:ring-0'
                )}
                onValueChange={([index]) => {
                  const effort = sliderEfforts[index]
                  if (effort) onReasoningEffortChange(effort)
                }}
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
            </div>
          </div>
        ) : supportsReasoning ? (
          <RadioGroup
            value={displayedEffort}
            aria-label={t('agent.speed.effort')}
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
