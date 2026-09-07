import { SESSION_CREATE_TOOL_NAME, SESSION_SEND_TOOL_NAME } from '@shared/ai/agentSessionDelivery'

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
  kind: 'create' | 'send'
  renderKey: string
  sessionId: string
  sessionName: string
}

function isSessionCreateToolName(toolName: string | undefined): boolean {
  return toolName === SESSION_CREATE_TOOL_NAME || toolName === `mcp__cherry-tools__${SESSION_CREATE_TOOL_NAME}`
}

function isSessionSendToolName(toolName: string | undefined): boolean {
  return toolName === SESSION_SEND_TOOL_NAME || toolName === `mcp__cherry-tools__${SESSION_SEND_TOOL_NAME}`
}

export function isCherrySessionToolResponse(toolResponse: ToolResponseLike): boolean {
  const { tool } = toolResponse
  const isSessionTool = isSessionCreateToolName(tool.name) || isSessionSendToolName(tool.name)
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

export function getSessionToolTarget(toolResponse: ToolResponseLike): SessionToolTarget | undefined {
  if (!isCherrySessionToolResponse(toolResponse)) return undefined
  const toolName = toolResponse.tool.name
  const args = toolResponse.arguments
  const input = isRecord(args) ? args : undefined

  if (isSessionCreateToolName(toolName)) {
    const result = parseSessionCreateResult(toolResponse.response)
    if (!result) return undefined
    const title = typeof input?.title === 'string' ? input.title.trim() : ''
    return {
      kind: 'create',
      renderKey: toolResponse.toolCallId ?? toolResponse.id,
      sessionId: result.sessionId,
      sessionName: title
    }
  }

  if (!isSessionSendToolName(toolName)) return undefined
  const result = parseSessionSendResult(toolResponse.response)
  const sessionId = result?.delivery?.receiver?.sessionId
  if (!sessionId) return undefined
  return {
    agentName: result.delivery?.receiverSnapshot?.agentName?.trim() || undefined,
    kind: 'send',
    renderKey: toolResponse.toolCallId ?? toolResponse.id,
    sessionId,
    sessionName: result.delivery?.receiverSnapshot?.sessionName?.trim() || ''
  }
}
