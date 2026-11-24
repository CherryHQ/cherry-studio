import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { AgentToolsType, isBackgroundAgentOutput } from '../shared/agentToolTypes'
import { SkeletonValue, ToolHeader } from '../shared/GenericTools'
import { readToolStringArgument } from '../shared/toolArgumentObject'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import type { ToolDisplayProps } from '../shared/toolDisplay'

const AgentStatsSchema = z.object({
  status: z.literal('completed'),
  totalTokens: z.number().optional().catch(undefined),
  totalToolUseCount: z.number().optional().catch(undefined),
  totalDurationMs: z.number().optional().catch(undefined)
})

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)

  if (totalSeconds < 60) return `${totalSeconds}s`

  return `${Math.floor(totalSeconds / 60)}m${totalSeconds % 60}s`
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
}

export function AgentTool({ input, output }: ToolDisplayProps): ToolDisclosureItem {
  const { t } = useTranslation()

  // A detached subagent returns its launch receipt immediately, so without this the card reads as a
  // plain success while the agent is still working.
  const isBackground = isBackgroundAgentOutput(output)
  const completed = AgentStatsSchema.safeParse(output)

  const stats: string[] = []

  if (completed.success) {
    const { totalTokens, totalToolUseCount, totalDurationMs } = completed.data

    if (totalTokens !== undefined) stats.push(formatTokens(totalTokens))

    if (totalToolUseCount !== undefined) stats.push(t('message.tools.units.item', { count: totalToolUseCount }))

    if (totalDurationMs !== undefined) stats.push(formatDuration(totalDurationMs))
  }

  return {
    key: AgentToolsType.Agent,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Agent}
        args={input}
        params={<SkeletonValue value={readToolStringArgument(input, 'description')} width="150px" />}
        stats={isBackground ? t('message.tools.agent_background') : stats.length > 0 ? stats.join(' · ') : undefined}
        variant="collapse-label"
        showStatus={false}
      />
    )
  }
}
