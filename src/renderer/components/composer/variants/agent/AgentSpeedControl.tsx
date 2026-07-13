import { Button, Popover, PopoverContent, PopoverTrigger, Slider, Switch } from '@cherrystudio/ui'
import { AGENT_REASONING_EFFORTS, type AgentReasoningEffort } from '@shared/ai/agentRuntimeOptions'
import type { Model } from '@shared/data/types/model'
import { ChevronDown, Gauge, Zap } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const AGENT_EFFORTS = new Set<AgentReasoningEffort>(AGENT_REASONING_EFFORTS)
const AGENT_SPEED_POPOVER_WIDTHS = ['w-64', 'w-64', 'w-56', 'w-64', 'w-72', 'w-80'] as const
type DisplayReasoningEffort = AgentReasoningEffort | 'default'
type ManualReasoningEffort = Exclude<AgentReasoningEffort, 'none' | 'auto'>

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
  const supportedEfforts = useMemo(() => getAgentReasoningEfforts(model), [model])
  const enabledEfforts = useMemo(() => supportedEfforts.filter((effort) => effort !== 'none'), [supportedEfforts])
  const manualEfforts = useMemo(
    () => enabledEfforts.filter((effort): effort is ManualReasoningEffort => effort !== 'auto'),
    [enabledEfforts]
  )
  const supportsAuto = enabledEfforts.includes('auto')
  const isAutomatic = reasoningEffort === 'auto'
  const showEffortSlider = manualEfforts.length > 1
  const defaultManualEffort =
    manualEfforts.find((effort) => effort === model.reasoning?.defaultEffort) ??
    (manualEfforts.includes('medium') ? 'medium' : manualEfforts[Math.floor(manualEfforts.length / 2)])
  const currentManualEffort = manualEfforts.find((effort) => effort === reasoningEffort)
  const lastManualEffortRef = useRef<ManualReasoningEffort | undefined>(currentManualEffort ?? defaultManualEffort)
  const selectedManualEffort =
    currentManualEffort ?? manualEfforts.find((effort) => effort === lastManualEffortRef.current) ?? defaultManualEffort
  const currentIndex = Math.max(
    0,
    manualEfforts.findIndex((effort) => effort === selectedManualEffort)
  )
  const isReasoningEnabled = reasoningEffort !== 'none'
  const showReasoningToggle = supportedEfforts.includes('none')
  const lastEnabledEffortRef = useRef<AgentReasoningEffort>(
    isReasoningEnabled && reasoningEffort !== 'default' ? reasoningEffort : getDefaultAgentReasoningEffort(model)
  )
  const supportsFast = onFastModeChange !== undefined && supportsAgentFastMode(model)
  const popoverWidthClass = AGENT_SPEED_POPOVER_WIDTHS[Math.min(manualEfforts.length, 5)]

  if (!isSupported) return null

  const effortLabel = t(EFFORT_LABEL_KEYS[reasoningEffort])
  const selectReasoningEffort = (effort: AgentReasoningEffort) => {
    if (effort !== 'none' && effort !== 'auto') lastManualEffortRef.current = effort
    if (effort !== 'none') lastEnabledEffortRef.current = effort
    onReasoningEffortChange(effort)
  }
  const setReasoningEnabled = (enabled: boolean) => {
    if (!enabled) {
      if (reasoningEffort !== 'default') lastEnabledEffortRef.current = reasoningEffort
      selectReasoningEffort('none')
      return
    }
    const previousEffort = lastEnabledEffortRef.current
    selectReasoningEffort(
      supportedEfforts.includes(previousEffort) && previousEffort !== 'none'
        ? previousEffort
        : getDefaultAgentReasoningEffort(model)
    )
  }
  const toggleAutomatic = () => {
    const previousManualEffort = manualEfforts.find((effort) => effort === lastManualEffortRef.current)
    const fallbackManualEffort = previousManualEffort ?? defaultManualEffort
    if (isAutomatic && fallbackManualEffort) {
      selectReasoningEffort(fallbackManualEffort)
      return
    }
    if (isAutomatic && supportedEfforts.includes('none')) {
      selectReasoningEffort('none')
      return
    }
    selectReasoningEffort('auto')
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 rounded-full px-2 text-muted-foreground text-xs hover:text-foreground"
          aria-label={t('agent.speed.title')}>
          <Gauge size={14} />
          <span>{effortLabel}</span>
          {fastMode && supportsFast ? <span>· {t('agent.speed.fast')}</span> : null}
          <ChevronDown size={12} />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className={`${popoverWidthClass} p-4`}>
        <div className="flex items-center justify-between gap-4">
          <div className="font-medium text-sm">{t('agent.speed.reasoning')}</div>
          {showReasoningToggle ? (
            <Switch
              size="sm"
              checked={isReasoningEnabled}
              aria-label={t('agent.speed.reasoning')}
              onCheckedChange={setReasoningEnabled}
            />
          ) : null}
        </div>
        {showEffortSlider ? (
          <div className="mt-3">
            <Slider
              thumbAriaLabel={t('agent.speed.reasoning')}
              getThumbAriaValueText={(index) => t(EFFORT_LABEL_KEYS[manualEfforts[index]])}
              value={[currentIndex]}
              min={0}
              max={manualEfforts.length - 1}
              step={1}
              size="sm"
              disabled={isAutomatic || !isReasoningEnabled}
              className={isAutomatic || !isReasoningEnabled ? 'opacity-50' : undefined}
              marks={manualEfforts.map((effort, index) => ({
                value: index,
                label: t(EFFORT_LABEL_KEYS[effort])
              }))}
              onValueChange={([index]) => {
                const effort = manualEfforts[index]
                if (effort) selectReasoningEffort(effort)
              }}
            />
          </div>
        ) : null}
        {supportsAuto ? (
          <div className="mt-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="font-medium text-sm">{t(EFFORT_LABEL_KEYS.auto)}</div>
              <div className="text-muted-foreground text-xs">
                {t('assistants.settings.reasoning_effort.auto_description')}
              </div>
            </div>
            <Button
              type="button"
              variant={isAutomatic ? 'default' : 'outline'}
              size="sm"
              className="rounded-full"
              aria-label={t(EFFORT_LABEL_KEYS.auto)}
              aria-pressed={isAutomatic}
              data-active={isAutomatic || undefined}
              disabled={isAutomatic && !defaultManualEffort && !supportedEfforts.includes('none')}
              onClick={toggleAutomatic}>
              {t(EFFORT_LABEL_KEYS.auto)}
            </Button>
          </div>
        ) : null}
        {supportsFast ? (
          <div className="mt-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="font-medium text-sm">{t('agent.speed.fast')}</div>
              <div className="text-muted-foreground text-xs">{t('agent.speed.fast_description')}</div>
            </div>
            <Button
              type="button"
              variant={fastMode ? 'default' : 'outline'}
              size="sm"
              className="rounded-full"
              aria-label={t('agent.speed.fast')}
              aria-pressed={fastMode}
              data-active={fastMode || undefined}
              onClick={() => onFastModeChange?.(!fastMode)}>
              <Zap fill={fastMode ? 'currentColor' : 'none'} size={14} />
              <span>{t('agent.speed.fast')}</span>
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
