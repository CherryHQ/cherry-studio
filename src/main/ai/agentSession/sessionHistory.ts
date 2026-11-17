import { isToolUIPart } from 'ai'

import { application } from '@application'
import { readAgentSessionPath } from '@data/services/agentSessionMessageTree'
import { findPersistedToolOutput } from '@main/ai/messages/persistedToolOutput'
import { isPersistedToolOutput } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'

import { buildAgentSessionTopicId } from './topic'

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
    const parts: CherryMessagePart[] = []
    for (const part of row.data.parts ?? []) {
      if (part.type === 'file') files.push(part)
      if (isToolUIPart(part) && part.state === 'output-available' && isPersistedToolOutput(part.output)) {
        const stored = await findPersistedToolOutput(buildAgentSessionTopicId(sessionId), row.id, part.toolCallId)
        parts.push(stored.found ? { ...part, output: stored.output } : part)
      } else parts.push(part)
    }
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
