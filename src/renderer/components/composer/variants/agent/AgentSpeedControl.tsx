import { Button, Popover, PopoverContent, PopoverTrigger, Slider, Switch } from '@cherrystudio/ui'
import type { AgentReasoningEffort } from '@shared/ai/agentRuntimeOptions'
import { isClaudeCodeProviderId } from '@shared/data/presets/claudeCode'
import { isCodexProviderId } from '@shared/data/presets/codex'
import type { Model } from '@shared/data/types/model'
import { ChevronDown, Gauge, Zap } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const DEFAULT_EFFORTS: AgentReasoningEffort[] = ['low', 'medium', 'high']
const AGENT_EFFORTS = new Set<AgentReasoningEffort>(['low', 'medium', 'high', 'xhigh'])

export function getAgentReasoningEfforts(model: Model): AgentReasoningEffort[] {
  const supported = model.reasoning?.supportedEfforts?.filter(
    (effort): effort is AgentReasoningEffort => AGENT_EFFORTS.has(effort as AgentReasoningEffort)
  )
  return supported?.length ? supported : DEFAULT_EFFORTS
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
  return isClaudeCodeProviderId(model.providerId) || isCodexProviderId(model.providerId)
}

export function supportsAgentFastMode(model: Model): boolean {
  const modelId = (model.apiModelId ?? model.id).toLowerCase()
  if (isClaudeCodeProviderId(model.providerId)) return /^claude-opus-4-(7|8)(?:-|$)/.test(modelId)
  if (isCodexProviderId(model.providerId)) return /^gpt-5\.(4|5)(?:-|$)/.test(modelId)
  return false
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

  const effortLabel = t(`assistants.settings.reasoning_effort.${efforts[currentIndex]}`)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 rounded-full px-2 text-xs text-muted-foreground hover:text-foreground"
          aria-label={t('agent.speed.title')}>
          <Gauge size={14} />
          <span>{effortLabel}</span>
          {fastMode && supportsFast ? <span>· {t('agent.speed.fast')}</span> : null}
          <ChevronDown size={12} />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-72 p-4">
        <div className="space-y-4">
          <div>
            <div className="mb-3 text-sm font-medium">{t('agent.speed.reasoning')}</div>
            <Slider
              aria-label={t('agent.speed.reasoning')}
              value={[currentIndex]}
              min={0}
              max={Math.max(1, efforts.length - 1)}
              step={1}
              size="sm"
              marks={efforts.map((effort, index) => ({
                value: index,
                label: t(`assistants.settings.reasoning_effort.${effort}`)
              }))}
              onValueChange={([index]) => {
                const effort = efforts[index]
                if (effort) onReasoningEffortChange(effort)
              }}
            />
          </div>
          {supportsFast ? (
            <div className="flex items-center justify-between gap-4 border-t pt-3">
              <div className="flex min-w-0 gap-2">
                <Zap className="mt-0.5 shrink-0 text-amber-500" size={15} />
                <div>
                  <div className="text-sm font-medium">{t('agent.speed.fast')}</div>
                  <div className="text-xs text-muted-foreground">{t('agent.speed.fast_description')}</div>
                </div>
              </div>
              <Switch checked={fastMode} onCheckedChange={onFastModeChange} aria-label={t('agent.speed.fast')} />
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
