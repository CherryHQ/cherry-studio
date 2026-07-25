import { dataApiService } from '@data/DataApiService'
import { ipcApi } from '@renderer/ipc'
import type { AgentSessionToolResult } from '@shared/ai/transport'
import type { ResponseForPath } from '@shared/data/api/paths'
import type { DeferredToolResultRef } from '@shared/data/types/uiParts'

export async function loadAgentSessionToolResult({
  sessionId,
  topicId,
  deferredToolResult
}: {
  sessionId: string
  topicId: string
  deferredToolResult: DeferredToolResultRef
}): Promise<AgentSessionToolResult> {
  const { messageId, toolCallId } = deferredToolResult
  const response = await dataApiService.get(
    `/agent-sessions/${sessionId}/messages/${messageId}/tool-results/${toolCallId}`
  )
  const storedResult = response as ResponseForPath<
    '/agent-sessions/:sessionId/messages/:messageId/tool-results/:toolCallId',
    'GET'
  >
  if (storedResult.found) return storedResult.result

  const liveResult = await ipcApi.request('ai.get_agent_session_tool_result', {
    topicId,
    messageId,
    toolCallId
  })
  if (liveResult.found) return liveResult.result

  throw new Error(`Tool result is not available: ${toolCallId}`)
}
