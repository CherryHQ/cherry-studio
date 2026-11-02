import type { ToolCall } from '@earendil-works/pi-ai'
import { type SessionEntry, SessionManager } from '@earendil-works/pi-coding-agent'

import { type Subagent, SUBAGENT_ORIGIN_STATE } from './subagent'

const PLACEHOLDER = 'This tool call was still running when the subagent started; its result is not available here.'

function toolCalls(entry: SessionEntry): ToolCall[] {
  return entry.type === 'message' && entry.message.role === 'assistant'
    ? entry.message.content.filter((part): part is ToolCall => part.type === 'toolCall')
    : []
}

export function subagentForkPoint(parent: SessionManager, toolCallId: string): string {
  const entry = parent.getBranch().findLast((entry) => toolCalls(entry).some((call) => call.id === toolCallId))
  if (!entry) throw new Error(`No assistant message holds the call ${toolCallId}.`)
  return entry.id
}

export function createSubagentSessionManager(
  parent: SessionManager,
  child: Subagent,
  forkPoint?: string
): SessionManager {
  const options = { id: child.sessionId, parentSession: parent.getSessionFile() }
  const manager = parent.isPersisted()
    ? forkPoint
      ? SessionManager.forkFrom(parent.getSessionFile()!, parent.getCwd(), parent.getSessionDir(), options)
      : SessionManager.create(parent.getCwd(), parent.getSessionDir(), options)
    : SessionManager.inMemory(parent.getCwd(), options, forkPoint ? parent.getBranch(forkPoint) : [])
  if (forkPoint) {
    manager.branch(forkPoint)
    const entry = manager.getEntry(forkPoint)!
    for (const call of toolCalls(entry)) {
      manager.appendMessage({
        role: 'toolResult',
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: 'text', text: PLACEHOLDER }],
        isError: false,
        timestamp: Date.parse(entry.timestamp)
      })
    }
  }
  manager.appendCustomEntry(SUBAGENT_ORIGIN_STATE, { parentToolCallId: child.parentToolCallId, fork: child.fork })
  return manager
}
