import { isToolUIPart } from 'ai'
import * as z from 'zod'

import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import { isDeferredToolOutput } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'

import { buildToolResponseFromPart } from '../toolResponse'

const CREATE_AGENT_TOOL_NAME = 'mcp__assistant__create_agent'

const createAgentResultSchema = z.object({
  ok: z.literal(true),
  agentId: z.string(),
  name: z.string(),
  model: z.string()
})

export type CreateAgentResult = z.infer<typeof createAgentResultSchema>

function isRecord(value: unknown): value is {
  structuredContent?: unknown
  data?: unknown
  details?: unknown
  content?: unknown
  text?: unknown
} {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Historical MCP/native results may use structured or text envelopes; the result schema validates extracted agent fields.
export function parseCreateAgentResult(value: unknown): CreateAgentResult | undefined {
  let candidate: unknown = value

  if (isRecord(value)) {
    candidate = value.structuredContent ?? value.data ?? value.details ?? value

    if (candidate === value && Array.isArray(value.content)) candidate = value.content
  }

  if (Array.isArray(candidate) || typeof candidate === 'string') {
    const text =
      typeof candidate === 'string'
        ? candidate
        : candidate
            .flatMap((item) => {
              const text = isRecord(item) && typeof item.text === 'string' ? item.text : ''

              return text ? [text] : []
            })
            .join('\n')

    try {
      candidate = JSON.parse(text)
    } catch {
      return undefined
    }
  }

  const parsed = createAgentResultSchema.safeParse(candidate)

  return parsed.success ? parsed.data : undefined
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
