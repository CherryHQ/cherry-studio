import { isToolUIPart, type DynamicToolUIPart, type ToolUIPart } from 'ai'

import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'

type UarToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type UarHistoryMessage = {
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: UarToolCall[]
}

const TERMINAL_TOOL_STATES = new Set(['output-available', 'output-error', 'output-denied'])
const MAX_HISTORY_MESSAGES = 1_000
const MAX_HISTORY_BYTES = 4 * 1024 * 1024

export function buildUarHostHistory(
  messages: readonly AgentSessionMessageEntity[],
  excludeMessageId: string
): UarHistoryMessage[] {
  const groups: UarHistoryMessage[][] = []
  const seenToolCalls = new Set<string>()

  for (const message of messages) {
    if (message.id === excludeMessageId || message.role === 'system' || message.status === 'pending') continue
    const content = messageText(message)
    if (message.role !== 'assistant') {
      if (content) groups.push([{ role: 'user', content }])
      continue
    }

    const toolCalls: UarToolCall[] = []
    const toolResults: UarHistoryMessage[] = []
    for (const part of message.data.parts ?? []) {
      if (!isToolUIPart(part) || !TERMINAL_TOOL_STATES.has(part.state) || seenToolCalls.has(part.toolCallId)) {
        continue
      }
      const toolName = part.type === 'dynamic-tool' ? part.toolName : part.type.slice('tool-'.length)
      if (!toolName) continue
      const argumentsJson = stringifyJson(part.input ?? {})
      if (!argumentsJson) continue
      seenToolCalls.add(part.toolCallId)
      toolCalls.push({
        id: part.toolCallId,
        type: 'function',
        function: { name: toolName, arguments: argumentsJson }
      })
      toolResults.push({
        role: 'tool',
        tool_call_id: part.toolCallId,
        content: toolResultContent(part)
      })
    }

    if (content || toolCalls.length > 0) {
      groups.push([
        { role: 'assistant', content, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) },
        ...toolResults
      ])
    }
  }

  let messageCount = groups.reduce((total, group) => total + group.length, 0)
  let byteCount = groups.reduce((total, group) => total + historyBytes(group), 0)
  while (groups.length > 0 && (messageCount > MAX_HISTORY_MESSAGES || byteCount > MAX_HISTORY_BYTES)) {
    const removed = groups.shift()
    if (!removed) break
    messageCount -= removed.length
    byteCount -= historyBytes(removed)
  }
  return groups.flat()
}

function messageText(message: AgentSessionMessageEntity): string {
  return (message.data.parts ?? [])
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()
}

function toolResultContent(part: ToolUIPart | DynamicToolUIPart): string {
  switch (part.state) {
    case 'output-available':
      return stringifyOutput(part.output)
    case 'output-error':
      return part.errorText.trim() || 'Tool execution failed'
    case 'output-denied':
      return 'Tool call denied by the host'
    default:
      return 'Tool result unavailable'
  }
}

function stringifyOutput(value: unknown): string {
  if (typeof value === 'string') return value || 'null'
  return stringifyJson(value) || 'null'
}

function stringifyJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function historyBytes(messages: readonly UarHistoryMessage[]): number {
  return Buffer.byteLength(JSON.stringify(messages))
}
