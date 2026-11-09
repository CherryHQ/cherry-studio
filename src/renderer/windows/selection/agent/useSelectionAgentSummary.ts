import { isToolUIPart } from 'ai'
import { useEffect, useState } from 'react'

import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { TopicStreamStatus } from '@shared/ai/transport'
import { classifyTurn } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { SelectionAgentStatus, SelectionAgentSummary } from '@shared/types/selection'

/** Publishes what this window's capsule shows; `null` publishes nothing until the agent is known. */
export function useSelectionAgentSummary(summary: SelectionAgentSummary | null): void {
  const { agentName, agentAvatar, sessionTitle, status, steps } = summary ?? {}
  useEffect(() => {
    if (agentName === undefined || agentAvatar === undefined || !status || steps === undefined) return
    void ipcApi.request('selection.update_agent_summary', { agentName, agentAvatar, sessionTitle, status, steps })
  }, [agentName, agentAvatar, sessionTitle, status, steps])
}

/** Whether an MCP server is waiting on the user in this topic; the window's interaction host shows the prompt. */
export function usePendingMcpInteraction(topicId: string): boolean {
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  useIpcOn('mcp.interaction.requested', (interaction) => {
    if (interaction.topicId === topicId) setPending((ids) => new Set(ids).add(interaction.requestId))
  })
  useIpcOn('mcp.interaction.ended', ({ requestId }) =>
    setPending((ids) => (ids.has(requestId) ? new Set([...ids].filter((id) => id !== requestId)) : ids))
  )
  return pending.size > 0
}

interface TurnSummaryInput {
  /** False until the first turn shows up, while the window is still starting. */
  turnSeen: boolean
  status: TopicStreamStatus | undefined
  awaitingApproval: boolean
  needsInput: boolean
}

export function getSelectionAgentTurnStatus({
  turnSeen,
  status,
  awaitingApproval,
  needsInput
}: TurnSummaryInput): SelectionAgentStatus {
  if (needsInput) return 'needs-input'
  if (awaitingApproval) return 'awaiting-approval'
  if (!turnSeen) return 'starting'
  if (classifyTurn(status).isStreamLive) return 'running'
  return status === 'error' ? 'failed' : 'done'
}

/** Tool calls since the last user message, counting the parts still streaming in. */
export function countTurnSteps(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>
): number {
  let steps = 0
  for (let index = messages.length - 1; index >= 0 && messages[index].role !== 'user'; index--) {
    const message = messages[index]
    steps += (partsByMessageId[message.id] ?? message.parts).filter((part) => isToolUIPart(part)).length
  }
  return steps
}
