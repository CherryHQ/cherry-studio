import { isToolUIPart } from 'ai'

import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import { isDeferredToolOutput } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'

import { buildToolResponseFromPart } from '../toolResponse'

const CREATE_AGENT_TOOL_NAME = 'mcp__assistant__create_agent'

export interface CreateAgentResult {
  ok: true
  agentId: string
  name: string
  model: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseText(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

export function parseCreateAgentResult(value: unknown): CreateAgentResult | undefined {
  let candidate: unknown = value

  if (isRecord(value)) {
    candidate = value.structuredContent ?? value.data ?? value.details ?? value
    if (candidate === value && Array.isArray(value.content)) candidate = value.content
  }

  if (Array.isArray(candidate)) {
    candidate = parseText(
      candidate
        .map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : ''))
        .filter(Boolean)
        .join('\n')
    )
  } else if (typeof candidate === 'string') {
    candidate = parseText(candidate)
  }

  if (
    !isRecord(candidate) ||
    candidate.ok !== true ||
    typeof candidate.agentId !== 'string' ||
    typeof candidate.name !== 'string' ||
    typeof candidate.model !== 'string'
  ) {
    return undefined
  }

  return {
    ok: true,
    agentId: candidate.agentId,
    name: candidate.name,
    model: candidate.model
  }
}

export function isCreateAgentToolResponse(toolResponse: McpToolResponse | NormalToolResponse): boolean {
  const { tool } = toolResponse
  if (tool.name === CREATE_AGENT_TOOL_NAME || tool.id === CREATE_AGENT_TOOL_NAME) return true
  return tool.type === 'mcp' && 'serverId' in tool && tool.serverId === 'assistant' && tool.name === 'create_agent'
}

export function getCreateAgentResult(
  toolResponse: McpToolResponse | NormalToolResponse
): CreateAgentResult | undefined {
  if (toolResponse.status !== 'done' || !isCreateAgentToolResponse(toolResponse)) return undefined
  return parseCreateAgentResult(toolResponse.response)
}

export function isCreateAgentResultPart(part: CherryMessagePart): boolean {
  if (!isToolUIPart(part) || part.state !== 'output-available') return false

  const toolResponse = buildToolResponseFromPart(part)
  if (!toolResponse || !isCreateAgentToolResponse(toolResponse)) return false
  return isDeferredToolOutput(toolResponse.response) || getCreateAgentResult(toolResponse) !== undefined
}
