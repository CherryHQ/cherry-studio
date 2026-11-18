import { getToolName, isToolUIPart } from 'ai'

import { application } from '@application'
import { readAgentSessionPath } from '@data/services/agentSessionMessageTree'
import type { CherryMessagePart } from '@shared/data/types/message'

/** Reuse product history only before this branch has submitted native input. */
export async function readSessionHistory(
  sessionId: string,
  beforeMessageId: string
): Promise<CherryMessagePart[] | undefined> {
  const path = readAgentSessionPath(application.get('DbService').getDb(), sessionId, beforeMessageId)
  const before = path.findIndex((row) => row.id === beforeMessageId)
  if (before < 0) return
  const prefix = path.slice(0, before)
  if (prefix.some((row) => row.runtimeResumeToken || row.data.nativeSessionId || row.inputContextId)) return
  const history: string[] = []
  const files: CherryMessagePart[] = []
  for (const row of prefix) {
    if (
      (row.role !== 'user' && row.role !== 'assistant') ||
      row.status === 'pending' ||
      row.status === 'streaming' ||
      (row.deliveryStatus && row.deliveryStatus !== 'consumed')
    )
      continue
    const parts = (row.data.parts ?? []).map((part) => {
      if (part.type === 'file') files.push(part)
      if (!isToolUIPart(part)) return part
      return {
        type: part.type,
        toolCallId: part.toolCallId,
        toolName: getToolName(part),
        state: part.state,
        input: part.input,
        output: part.state === 'output-available' ? '[Historical tool output omitted]' : undefined,
        errorText: part.state === 'output-error' ? part.errorText.slice(0, 256) : undefined
      }
    })
    history.push(JSON.stringify({ role: row.role, status: row.status, parts }))
  }
  if (!history.length) return
  return [
    {
      type: 'text',
      text: [
        'Previous conversation history (reference only; historical tool calls are already completed):',
        ...history,
        'End of previous conversation. Continue with the new user message below.'
      ].join('\n')
    },
    ...files
  ]
}
