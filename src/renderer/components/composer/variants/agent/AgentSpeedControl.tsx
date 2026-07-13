import { Button, Popover, PopoverContent, PopoverTrigger, Slider } from '@cherrystudio/ui'
import { AGENT_REASONING_EFFORTS, type AgentReasoningEffort } from '@shared/ai/agentRuntimeOptions'
import { isClaudeCodeProviderId } from '@shared/data/presets/claudeCode'
import { isCodexProviderId } from '@shared/data/presets/codex'
import type { Model } from '@shared/data/types/model'
import { ChevronDown, Gauge, Zap } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const AGENT_EFFORTS = new Set<AgentReasoningEffort>(AGENT_REASONING_EFFORTS)
const EFFORT_LABEL_KEYS: Record<AgentReasoningEffort, string> = {
  low: 'assistants.settings.reasoning_effort.low',
  medium: 'assistants.settings.reasoning_effort.medium',
  high: 'assistants.settings.reasoning_effort.high',
  xhigh: 'assistants.settings.reasoning_effort.xhigh',
  max: 'assistants.settings.reasoning_effort.max',
  ultra: 'assistants.settings.reasoning_effort.ultra'
}

export function getAgentReasoningEfforts(model: Model): AgentReasoningEffort[] {
  const supported = model.reasoning?.supportedEfforts?.filter((effort): effort is AgentReasoningEffort =>
    AGENT_EFFORTS.has(effort as AgentReasoningEffort)
  )
  return supported ?? []
}

export function getDefaultAgentReasoningEffort(model?: Model): AgentReasoningEffort {
  if (!model) return 'medium'
  const efforts = getAgentReasoningEfforts(model)
  const defaultEffort = model.reasoning?.defaultEffort
  if (defaultEffort && efforts.includes(defaultEffort as AgentReasoningEffort)) {
    return defaultEffort as AgentReasoningEffort
  }
  return efforts.includes('medium') ? 'medium' : (efforts[Math.floor(efforts.length / 2)] ?? 'medium')
}

export function supportsAgentSpeedControl(model: Model): boolean {
  return (
    (isClaudeCodeProviderId(model.providerId) || isCodexProviderId(model.providerId)) &&
    getAgentReasoningEfforts(model).length > 0
  )
}

export function supportsAgentFastMode(model: Model): boolean {
  return model.supportsFastMode === true
}

interface AgentSpeedControlProps {
  model: Model
  reasoningEffort: AgentReasoningEffort
  fastMode: boolean
  onReasoningEffortChange: (effort: AgentReasoningEffort) => void
  onFastModeChange: (enabled: boolean) => void
}

export function AgentSpeedControl({
  model,
  reasoningEffort,
  fastMode,
  onReasoningEffortChange,
  onFastModeChange
}: AgentSpeedControlProps) {
  const { t } = useTranslation()
  const isAgentProvider = supportsAgentSpeedControl(model)
  const efforts = useMemo(() => getAgentReasoningEfforts(model), [model])
  const currentIndex = Math.max(0, efforts.indexOf(reasoningEffort))
  const supportsFast = supportsAgentFastMode(model)

  if (!isAgentProvider) return null

  const effortLabel = t(EFFORT_LABEL_KEYS[efforts[currentIndex]])

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
      <PopoverContent side="top" align="end" className="w-80 p-4">
        <div className="font-medium text-sm">{t('agent.speed.reasoning')}</div>
        <Slider
          thumbAriaLabel={t('agent.speed.reasoning')}
          getThumbAriaValueText={(index) => t(EFFORT_LABEL_KEYS[efforts[index]])}
          value={[currentIndex]}
          min={0}
          max={Math.max(1, efforts.length - 1)}
          step={1}
          size="sm"
          className="mt-3"
          marks={efforts.map((effort, index) => ({
            value: index,
            label: t(EFFORT_LABEL_KEYS[effort])
          }))}
          onValueChange={([index]) => {
            const effort = efforts[index]
            if (effort) onReasoningEffortChange(effort)
          }}
        />
        {supportsFast ? (
          <div className="mt-4 flex items-center justify-between gap-4 border-t pt-3">
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
              onClick={() => onFastModeChange(!fastMode)}>
              <Zap fill={fastMode ? 'currentColor' : 'none'} size={14} />
              <span>{t('agent.speed.fast')}</span>
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
