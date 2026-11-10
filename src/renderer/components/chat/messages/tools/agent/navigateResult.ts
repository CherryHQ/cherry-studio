import { isToolUIPart } from 'ai'

import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'

import { buildToolResponseFromPart } from '../toolResponse'

interface AgentNavigateResult {
  readonly input: { path: string; query?: Record<string, string> }
  readonly output: string
}

function isAgentNavigateResponse({ tool }: McpToolResponse | NormalToolResponse): boolean {
  return (
    tool.type === 'mcp' &&
    'serverId' in tool &&
    tool.serverId === 'assistant' &&
    (tool.name === 'navigate' || tool.name === 'mcp__assistant__navigate' || tool.id === 'mcp__assistant__navigate')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getAgentNavigateResult(
  response: McpToolResponse | NormalToolResponse
): AgentNavigateResult | undefined {
  if (!isAgentNavigateResponse(response) || response.status !== 'done' || response.approval?.approved === false) {
    return undefined
  }
  const input = response.arguments
  if (!isRecord(input) || typeof input.path !== 'string' || input.path.length === 0) return undefined
  if (
    'query' in input &&
    (!isRecord(input.query) || !Object.values(input.query).every((value) => typeof value === 'string'))
  ) {
    return undefined
  }
  const prefix = 'Navigate link created: '
  if (
    typeof response.response !== 'string' ||
    !response.response.startsWith(prefix) ||
    response.response.length === prefix.length
  ) {
    return undefined
  }
  return {
    input: { path: input.path, ...('query' in input ? { query: input.query as Record<string, string> } : {}) },
    output: response.response
  }
}

export function isAgentNavigateResultPart(part: CherryMessagePart): boolean {
  if (!isToolUIPart(part) || part.state !== 'output-available') return false
  const response = buildToolResponseFromPart(part)
  return response !== null && getAgentNavigateResult(response) !== undefined
}
