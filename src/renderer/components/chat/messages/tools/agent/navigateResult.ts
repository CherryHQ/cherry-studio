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

function isRecord(value: unknown): value is { path?: unknown; query?: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getAgentNavigateResult(
  response: McpToolResponse | NormalToolResponse
): AgentNavigateResult | undefined {
  if (!isAgentNavigateResponse(response) || response.status !== 'done' || response.approval?.approved === false) {
    return undefined
  }

  const input = response.arguments

  if (!isRecord(input)) return undefined
  const path = input.path

  if (typeof path !== 'string' || path.length === 0) return undefined

  const target: AgentNavigateResult['input'] = { path }

  if ('query' in input) {
    const query = input.query

    if (!isRecord(query)) return undefined

    const entries: Array<[string, string]> = []

    for (const [key, value] of Object.entries(query)) {
      if (typeof value !== 'string') return undefined
      entries.push([key, value])
    }

    target.query = Object.fromEntries(entries)
  }

  const prefix = 'Navigate link created: '

  const output = response.response

  if (typeof output !== 'string' || !output.startsWith(prefix) || output.length === prefix.length) {
    return undefined
  }

  return {
    input: target,
    output
  }
}

export function isAgentNavigateResultPart(part: CherryMessagePart): boolean {
  if (!isToolUIPart(part) || part.state !== 'output-available') return false
  const response = buildToolResponseFromPart(part)

  return response !== null && getAgentNavigateResult(response) !== undefined
}
