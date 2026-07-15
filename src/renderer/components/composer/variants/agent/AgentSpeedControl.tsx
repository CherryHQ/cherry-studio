import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Slider
} from '@cherrystudio/ui'
import { AGENT_REASONING_EFFORTS, type AgentReasoningEffort } from '@shared/ai/agentRuntimeOptions'
import type { Model } from '@shared/data/types/model'
import { ChevronDown, ChevronRight, ChevronUp, Gauge, Zap } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const AGENT_EFFORTS = new Set<AgentReasoningEffort>(AGENT_REASONING_EFFORTS)
const AGENT_EFFORT_ORDER: readonly AgentReasoningEffort[] = [
  'auto',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra'
]
type DisplayReasoningEffort = AgentReasoningEffort | 'default'
type ManualReasoningEffort = Exclude<AgentReasoningEffort, 'auto' | 'none'>

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
  const [showAdvanced, setShowAdvanced] = useState(false)
  const isSupported = supportsAgentSpeedControl(model)
  const supportedEfforts = useMemo(() => {
    const declaredEfforts = new Set(getAgentReasoningEfforts(model))
    return AGENT_EFFORT_ORDER.filter((effort) => declaredEfforts.has(effort))
  }, [model])
  const automaticEfforts = supportedEfforts.filter((effort) => effort === 'auto' || effort === 'none')
  const manualEfforts = supportedEfforts.filter(
    (effort): effort is ManualReasoningEffort => effort !== 'auto' && effort !== 'none'
  )
  const defaultManualEffort =
    manualEfforts.find((effort) => effort === model.reasoning?.defaultEffort) ??
    (manualEfforts.includes('medium') ? 'medium' : manualEfforts[Math.floor(manualEfforts.length / 2)])
  const currentManualEffort = manualEfforts.find((effort) => effort === reasoningEffort)
  const lastManualEffortRef = useRef<ManualReasoningEffort | undefined>(currentManualEffort ?? defaultManualEffort)
  const selectedManualEffort =
    currentManualEffort ?? manualEfforts.find((effort) => effort === lastManualEffortRef.current) ?? defaultManualEffort
  const showEffortSlider = manualEfforts.length > 1
  const currentIndex = Math.max(
    0,
    manualEfforts.findIndex((effort) => effort === selectedManualEffort)
  )
  const supportsFast = onFastModeChange !== undefined && supportsAgentFastMode(model)

  if (!isSupported) return null

  const effortLabel = t(EFFORT_LABEL_KEYS[reasoningEffort])
  const selectReasoningEffort = (effort: AgentReasoningEffort) => {
    if (effort !== 'auto' && effort !== 'none') lastManualEffortRef.current = effort
    onReasoningEffortChange(effort)
  }

  return (
    <DropdownMenu onOpenChange={(open) => !open && setShowAdvanced(false)}>
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
        <AnimatePresence initial={false} mode="wait">
          {showAdvanced ? (
            <motion.div
              key="advanced"
              initial={{ x: 10, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 10, opacity: 0 }}
              transition={{ duration: 0.14, ease: 'easeOut' }}>
              <div className="flex h-10 items-center px-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 px-0 text-muted-foreground text-xs hover:bg-transparent hover:text-foreground"
                  aria-label={t('common.back')}
                  onClick={() => setShowAdvanced(false)}>
                  <span>{t('common.advanced_settings')}</span>
                  <ChevronRight size={15} />
                </Button>
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
                <div className="relative mx-2.5 mt-1 mb-2 h-8">
                  <Slider
                    thumbAriaLabel={t('agent.speed.reasoning')}
                    getThumbAriaValueText={(index) => t(EFFORT_LABEL_KEYS[manualEfforts[index]])}
                    value={[currentIndex]}
                    min={0}
                    max={manualEfforts.length - 1}
                    step={1}
                    size="lg"
                    className="h-8 [&_[data-slot=slider-thumb]]:z-20 [&_[data-slot=slider-thumb]]:size-8 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:shadow-none [&_[data-slot=slider-thumb]:hover]:ring-0 [&_[data-slot=slider-track]]:h-6 [&_[data-slot=slider-track]]:bg-muted-foreground/30"
                    onValueChange={([index]) => {
                      const effort = manualEfforts[index]
                      if (effort) selectReasoningEffort(effort)
                    }}
                  />
                  <div className="pointer-events-none absolute inset-x-3 top-1/2 z-10 h-0">
                    {manualEfforts.map((effort, index) => (
                      <span
                        key={effort}
                        className={`absolute size-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                          index <= currentIndex ? 'bg-white/75' : 'bg-muted-foreground'
                        }`}
                        style={{ left: `${(index / (manualEfforts.length - 1)) * 100}%` }}
                      />
                    ))}
                  </div>
                </div>
              ) : manualEfforts.length === 1 ? (
                <div className="px-2.5 py-2 text-xs">{t(EFFORT_LABEL_KEYS[manualEfforts[0]])}</div>
              ) : null}
            </motion.div>
          ) : (
            <motion.div
              key="settings"
              initial={{ x: -10, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -10, opacity: 0 }}
              transition={{ duration: 0.14, ease: 'easeOut' }}>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="h-8 rounded-sm px-2 text-xs [&>svg:last-child]:ml-1">
                  <span>{t('agent.speed.effort')}</span>
                  <span className="ml-auto text-muted-foreground">{effortLabel}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  data-testid="agent-effort-menu"
                  className="w-52 rounded-md border-frame-border p-1.5 text-xs shadow-xl">
                  <DropdownMenuLabel className="px-2 py-1 font-normal text-[11px] text-muted-foreground">
                    {t('agent.speed.effort')}
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={reasoningEffort}
                    onValueChange={(effort) => selectReasoningEffort(effort as AgentReasoningEffort)}>
                    {automaticEfforts.map((effort) => (
                      <DropdownMenuRadioItem key={effort} value={effort} className="h-8 rounded-sm pr-2 pl-8 text-xs">
                        {t(EFFORT_LABEL_KEYS[effort])}
                      </DropdownMenuRadioItem>
                    ))}
                    {automaticEfforts.length > 0 && manualEfforts.length > 0 ? (
                      <DropdownMenuSeparator className="my-1" />
                    ) : null}
                    {manualEfforts.map((effort) => (
                      <DropdownMenuRadioItem key={effort} value={effort} className="h-8 rounded-sm pr-2 pl-8 text-xs">
                        {t(EFFORT_LABEL_KEYS[effort])}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {supportsFast ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="h-8 rounded-sm px-2 text-xs [&>svg:last-child]:ml-1">
                    <span>{t('agent.speed.label')}</span>
                    <span className="ml-auto text-muted-foreground">
                      {fastMode ? t('agent.speed.fast') : t('common.default')}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    data-testid="agent-speed-menu"
                    className="w-52 rounded-md border-frame-border p-1.5 text-xs shadow-xl">
                    <DropdownMenuLabel className="px-2 py-1 font-normal text-[11px] text-muted-foreground">
                      {t('agent.speed.label')}
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={fastMode ? 'fast' : 'default'}
                      onValueChange={(speed) => onFastModeChange?.(speed === 'fast')}>
                      <DropdownMenuRadioItem value="default" className="h-8 rounded-sm pr-2 pl-8 text-xs">
                        {t('common.default')}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="fast" className="h-8 rounded-sm pr-2 pl-8 text-xs">
                        {t('agent.speed.fast')}
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : null}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 rounded-sm px-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setShowAdvanced(true)}>
                <span>{t('common.advanced_settings')}</span>
                <ChevronUp size={15} />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
