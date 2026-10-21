import {
  SESSION_CREATE_TOOL_NAME,
  SESSION_READ_TOOL_NAME,
  SESSION_SEARCH_TOOL_NAME,
  SESSION_SEND_TOOL_NAME
} from '@shared/ai/agentSessionDelivery'

import type { ToolResponseLike } from '../toolResponse'

export interface SessionCreateResult {
  ok: true
  sessionId: string
  delivery?: {
    status?: string
  }
}

export interface SessionToolTarget {
  agentName?: string
  /** Which surface the session opens on: `agent` via sessionId, `assistant` via topicId. */
  conversationType: 'agent' | 'assistant'
  kind: 'create' | 'send' | 'search' | 'read'
  renderKey: string
  sessionId: string
  sessionName: string
}

/** session_search may return many matches; that many cards keep the reply readable. */
export const MAX_SESSION_SEARCH_RESULT_CARDS = 3

function isSessionCreateToolName(toolName: string | undefined): boolean {
  return toolName === SESSION_CREATE_TOOL_NAME || toolName === `mcp__cherry-tools__${SESSION_CREATE_TOOL_NAME}`
}

function isSessionSendToolName(toolName: string | undefined): boolean {
  return toolName === SESSION_SEND_TOOL_NAME || toolName === `mcp__cherry-tools__${SESSION_SEND_TOOL_NAME}`
}

function isSessionSearchToolName(toolName: string | undefined): boolean {
  return toolName === SESSION_SEARCH_TOOL_NAME || toolName === `mcp__cherry-tools__${SESSION_SEARCH_TOOL_NAME}`
}

function isSessionReadToolName(toolName: string | undefined): boolean {
  return toolName === SESSION_READ_TOOL_NAME || toolName === `mcp__cherry-tools__${SESSION_READ_TOOL_NAME}`
}

export function isCherrySessionToolResponse(toolResponse: ToolResponseLike): boolean {
  const { tool } = toolResponse
  const isSessionTool =
    isSessionCreateToolName(tool.name) ||
    isSessionSendToolName(tool.name) ||
    isSessionSearchToolName(tool.name) ||
    isSessionReadToolName(tool.name)
  if (!isSessionTool) return false
  return tool.type !== 'mcp' || ('serverId' in tool && tool.serverId === 'cherry-tools')
}

export interface SessionSendResult {
  ok: true
  status?: string
  delivery?: {
    receiver?: { agentId?: string; sessionId?: string }
    receiverSnapshot?: { agentName?: string; sessionName?: string }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonResult(value: unknown): unknown {
  if (isRecord(value) && Array.isArray(value.content)) {
    const text = value.content
      .map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : ''))
      .filter(Boolean)
      .join('\n')
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

export function parseSessionCreateResult(value: unknown): SessionCreateResult | undefined {
  const candidate = parseJsonResult(value)
  if (!isRecord(candidate) || candidate.ok !== true || typeof candidate.sessionId !== 'string') return undefined
  const delivery = isRecord(candidate.delivery) ? candidate.delivery : undefined
  return {
    ok: true,
    sessionId: candidate.sessionId,
    delivery: delivery && typeof delivery.status === 'string' ? { status: delivery.status } : undefined
  }
}

export function parseSessionSendResult(value: unknown): SessionSendResult | undefined {
  const candidate = parseJsonResult(value)
  if (!isRecord(candidate) || candidate.ok !== true) return undefined

  const delivery = isRecord(candidate.delivery) ? candidate.delivery : undefined
  const receiver = delivery && isRecord(delivery.receiver) ? delivery.receiver : undefined
  const receiverSnapshot = delivery && isRecord(delivery.receiverSnapshot) ? delivery.receiverSnapshot : undefined

  return {
    ok: true,
    status: typeof candidate.status === 'string' ? candidate.status : undefined,
    delivery: delivery
      ? {
          receiver: receiver
            ? {
                agentId: typeof receiver.agentId === 'string' ? receiver.agentId : undefined,
                sessionId: typeof receiver.sessionId === 'string' ? receiver.sessionId : undefined
              }
            : undefined,
          receiverSnapshot: receiverSnapshot
            ? {
                agentName: typeof receiverSnapshot.agentName === 'string' ? receiverSnapshot.agentName : undefined,
                sessionName: typeof receiverSnapshot.sessionName === 'string' ? receiverSnapshot.sessionName : undefined
              }
            : undefined
        }
      : undefined
  }
}

export interface SessionSearchResultSession {
  agentName?: string
  isCurrent: boolean
  sessionId: string
  sessionName: string
}

export function parseSessionSearchResult(value: unknown): SessionSearchResultSession[] {
  const candidate = parseJsonResult(value)
  if (!isRecord(candidate) || !Array.isArray(candidate.sessions)) return []

  return candidate.sessions.filter(
    (session): session is SessionSearchResultSession =>
      isRecord(session) &&
      typeof session.sessionId === 'string' &&
      session.isCurrent !== true &&
      typeof session.sessionName === 'string'
  )
}

export interface SessionReadResult {
  conversationType: 'agent' | 'assistant'
  sessionId: string
}

export function parseSessionReadResult(value: unknown): SessionReadResult | undefined {
  const candidate = parseJsonResult(value)
  if (!isRecord(candidate) || typeof candidate.sessionId !== 'string') return undefined
  // Temporary conversations are ephemeral and have no addressable surface to open.
  if (candidate.source !== 'agent' && candidate.source !== 'topic') return undefined
  return { conversationType: candidate.source === 'topic' ? 'assistant' : 'agent', sessionId: candidate.sessionId }
}

export function getSessionToolTargets(toolResponse: ToolResponseLike): SessionToolTarget[] {
  if (!isCherrySessionToolResponse(toolResponse)) return []
  const toolName = toolResponse.tool.name
  const args = toolResponse.arguments
  const input = isRecord(args) ? args : undefined
  const renderKey = toolResponse.toolCallId ?? toolResponse.id

  if (isSessionCreateToolName(toolName)) {
    const result = parseSessionCreateResult(toolResponse.response)
    if (!result) return []
    const title = typeof input?.title === 'string' ? input.title.trim() : ''
    return [
      {
        conversationType: 'agent',
        kind: 'create',
        renderKey,
        sessionId: result.sessionId,
        sessionName: title
      }
    ]
  }

  if (isSessionSendToolName(toolName)) {
    const result = parseSessionSendResult(toolResponse.response)
    const sessionId = result?.delivery?.receiver?.sessionId
    if (!sessionId) return []
    return [
      {
        agentName: result.delivery?.receiverSnapshot?.agentName?.trim() || undefined,
        conversationType: 'agent',
        kind: 'send',
        renderKey,
        sessionId,
        sessionName: result.delivery?.receiverSnapshot?.sessionName?.trim() || ''
      }
    ]
  }

  if (isSessionSearchToolName(toolName)) {
    return parseSessionSearchResult(toolResponse.response)
      .slice(0, MAX_SESSION_SEARCH_RESULT_CARDS)
      .map((session) => ({
        agentName: session.agentName?.trim() || undefined,
        conversationType: 'agent' as const,
        kind: 'search' as const,
        renderKey: `${renderKey}:${session.sessionId}`,
        sessionId: session.sessionId,
        sessionName: session.sessionName.trim()
      }))
  }

  if (!isSessionReadToolName(toolName)) return []
  const result = parseSessionReadResult(toolResponse.response)
  if (!result) return []
  return [
    {
      conversationType: result.conversationType,
      kind: 'read',
      renderKey,
      sessionId: result.sessionId,
      sessionName: ''
    }
  ]
}
