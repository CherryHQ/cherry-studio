import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, Slider } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { AGENT_REASONING_EFFORTS, type AgentReasoningEffort } from '@shared/ai/agentRuntimeOptions'
import type { Model } from '@shared/data/types/model'
import { ChevronDown, Gauge, Zap } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const AGENT_EFFORTS = new Set<AgentReasoningEffort>(AGENT_REASONING_EFFORTS)
const AGENT_EFFORT_ORDER: readonly AgentReasoningEffort[] = [
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
type DisplayReasoningEffort = AgentReasoningEffort | 'default'

const EFFORT_LABEL_KEYS: Record<DisplayReasoningEffort, string> = {
  default: 'assistants.settings.reasoning_effort.default',
  none: 'assistants.settings.reasoning_effort.off',
  minimal: 'assistants.settings.reasoning_effort.minimal',
  low: 'assistants.settings.reasoning_effort.low',
  medium: 'assistants.settings.reasoning_effort.medium',
  high: 'assistants.settings.reasoning_effort.high',
  xhigh: 'assistants.settings.reasoning_effort.xhigh',
  max: 'assistants.settings.reasoning_effort.max',
  ultra: 'assistants.settings.reasoning_effort.ultra',
  auto: 'assistants.settings.reasoning_effort.auto'
}

export function getAgentReasoningEfforts(model: Model): AgentReasoningEffort[] {
  return (model.reasoning?.supportedEfforts ?? []).filter((effort): effort is AgentReasoningEffort =>
    AGENT_EFFORTS.has(effort)
  )
}

export function getDefaultAgentReasoningEffort(model?: Model): AgentReasoningEffort {
  if (!model) return 'medium'
  const efforts = getAgentReasoningEfforts(model)
  const defaultEffort = model.reasoning?.defaultEffort
  if (defaultEffort && efforts.includes(defaultEffort)) {
    return defaultEffort
  }
  if (efforts.includes('medium')) return 'medium'
  if (efforts.includes('auto')) return 'auto'
  const enabledEfforts = efforts.filter((effort) => effort !== 'none')
  return enabledEfforts[Math.floor(enabledEfforts.length / 2)] ?? 'none'
}

export function supportsAgentSpeedControl(model: Model): boolean {
  return getAgentReasoningEfforts(model).some((effort) => effort !== 'none')
}

export function supportsAgentFastMode(model: Model): boolean {
  return model.supportsFastMode === true
}

interface AgentSpeedControlProps {
  model: Model
  reasoningEffort: DisplayReasoningEffort
  fastMode?: boolean
  onReasoningEffortChange: (effort: AgentReasoningEffort) => void
  onFastModeChange?: (enabled: boolean) => void
}

export function AgentSpeedControl({
  model,
  reasoningEffort,
  fastMode,
  onReasoningEffortChange,
  onFastModeChange
}: AgentSpeedControlProps) {
  const { t } = useTranslation()
  const isSupported = supportsAgentSpeedControl(model)
  const supportedEfforts = useMemo(() => {
    const declaredEfforts = new Set(getAgentReasoningEfforts(model))
    return AGENT_EFFORT_ORDER.filter((effort) => declaredEfforts.has(effort))
  }, [model])
  const sliderEfforts = supportedEfforts
  const selectedSliderEffort = sliderEfforts.find((effort) => effort === reasoningEffort) ?? sliderEfforts[0]
  const showEffortSlider = sliderEfforts.length > 1
  const currentIndex = Math.max(
    0,
    sliderEfforts.findIndex((effort) => effort === selectedSliderEffort)
  )
  const supportsFast = onFastModeChange !== undefined && supportsAgentFastMode(model)

  if (!isSupported) return null

  const effortLabel = t(EFFORT_LABEL_KEYS[reasoningEffort])
  const selectReasoningEffort = (effort: AgentReasoningEffort) => {
    onReasoningEffortChange(effort)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1 rounded-md px-2.5 text-muted-foreground text-xs hover:text-foreground"
          aria-label={t('agent.speed.title')}>
          <Gauge size={14} className="shrink-0" />
          <span>{effortLabel}</span>
          {fastMode && supportsFast ? <span>· {t('agent.speed.fast')}</span> : null}
          <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-56 overflow-hidden rounded-md border-frame-border p-1.5 text-xs shadow-xl">
        <div className="flex h-10 items-center px-2">
          <div className="flex min-w-0 items-baseline gap-1 text-xs">
            <span className="shrink-0 text-muted-foreground">{t('agent.speed.effort')}:</span>
            <AnimatePresence initial={false} mode="wait">
              <motion.span
                key={selectedSliderEffort}
                data-testid="agent-effort-slider-label"
                aria-live="polite"
                className="truncate font-medium text-foreground"
                initial={{ y: 2, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -2, opacity: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}>
                {t(EFFORT_LABEL_KEYS[selectedSliderEffort])}
              </motion.span>
            </AnimatePresence>
          </div>
          {supportsFast ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={`ml-auto rounded-full ${fastMode ? 'text-primary hover:text-primary' : ''}`}
              aria-label={t('agent.speed.fast')}
              aria-pressed={Boolean(fastMode)}
              onClick={() => onFastModeChange?.(!fastMode)}>
              <Zap size={14} fill={fastMode ? 'currentColor' : 'none'} />
            </Button>
          ) : null}
        </div>
        {showEffortSlider ? (
          <div className="mx-2.5 mt-1 mb-2">
            <div className="flex items-center justify-between font-medium text-[11px]" aria-hidden="true">
              <span className="text-muted-foreground">{t('agent.speed.faster')}</span>
              <span className="text-primary">{t('agent.speed.smarter')}</span>
            </div>
            <div className="relative mt-1.5 h-8">
              <Slider
                thumbAriaLabel={t('agent.speed.reasoning')}
                getThumbAriaValueText={(index) => t(EFFORT_LABEL_KEYS[sliderEfforts[index]])}
                value={[currentIndex]}
                min={0}
                max={sliderEfforts.length - 1}
                step={1}
                size="lg"
                className={cn(
                  'h-8',
                  '[&_[data-slot=slider-track]]:h-2.5 [&_[data-slot=slider-track]]:bg-muted [&_[data-slot=slider-track]]:shadow-inner',
                  '[&_[data-slot=slider-range]]:bg-primary',
                  '[&_[data-slot=slider-thumb]]:z-20 [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:rounded-full',
                  '[&_[data-slot=slider-thumb]]:border-border [&_[data-slot=slider-thumb]]:bg-popover! [&_[data-slot=slider-thumb]]:shadow-sm dark:[&_[data-slot=slider-thumb]]:bg-neutral-100!',
                  '[&_[data-slot=slider-thumb]:hover]:ring-0'
                )}
                onValueChange={([index]) => {
                  const effort = sliderEfforts[index]
                  if (effort) selectReasoningEffort(effort)
                }}
              />
              <div className="pointer-events-none absolute inset-x-3 top-1/2 z-10 h-0">
                {sliderEfforts.map((effort, index) =>
                  index === currentIndex ? null : (
                    <span
                      key={effort}
                      data-slot="agent-effort-step"
                      data-index={index}
                      className="-translate-x-1/2 -translate-y-1/2 absolute size-1 rounded-full bg-background"
                      style={{ left: `${(index / (sliderEfforts.length - 1)) * 100}%` }}
                    />
                  )
                )}
              </div>
            </div>
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
