import { useTranslation } from 'react-i18next'

import { AgentToolsType, isBackgroundAgentOutput, type ToolRendererProps } from '../shared/agentToolTypes'
import { SkeletonValue, ToolHeader } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  return `${Math.floor(totalSeconds / 60)}m${totalSeconds % 60}s`
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
}

export function AgentTool({ input, output }: ToolRendererProps<typeof AgentToolsType.Agent>): ToolDisclosureItem {
  const { t } = useTranslation()

  // A detached subagent returns its launch receipt immediately, so without this the card reads as a
  // plain success while the agent is still working.
  const isBackground = isBackgroundAgentOutput(output)
  const completed = output && !Array.isArray(output) && output.status === 'completed' ? output : undefined

  const stats: string[] = []
  if (completed) {
    stats.push(formatTokens(completed.totalTokens))
    stats.push(t('message.tools.units.item', { count: completed.totalToolUseCount }))
    stats.push(formatDuration(completed.totalDurationMs))
  }

  return {
    key: AgentToolsType.Agent,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Agent}
        args={input}
        params={<SkeletonValue value={input?.description} width="150px" />}
        stats={isBackground ? t('message.tools.agent_background') : stats.length > 0 ? stats.join(' · ') : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    )
  }
}
