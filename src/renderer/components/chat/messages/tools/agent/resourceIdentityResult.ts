import { isToolUIPart } from 'ai'
import * as z from 'zod'

import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
import { AgentConfigToolOutputSchema, AssistantCreateToolOutputSchema } from '@shared/ai/agentConfigToolOutput'
import { isDeferredToolOutput } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'

import { buildToolResponseFromPart } from '../toolResponse'
import { getAgentConfigToolKind } from './agentConfigTool'

/** A created or changed Agent or Assistant, as the create and configure tools report it. */
export interface ResourceIdentityResult {
  kind: 'agent' | 'assistant'
  id: string
  name: string
  /** Empty for a result saved before the tools reported the avatar. */
  emoji: string
  description: string
  /** What was set, or `field: current → new`, already in the app language. */
  summary: string[]
  /** Create only: the model and a key setting or two; absent on results saved before the tools reported it. */
  highlights?: string[]
  action: 'created' | 'updated'
  /** The conversation's own Agent changed, so there is no other conversation to open. */
  self: boolean
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

function toStructuredOutput(value: unknown): unknown {
  let candidate: unknown = value
  if (isRecord(value)) {
    candidate = value.structuredContent ?? value.data ?? value.details ?? value
    if (candidate === value && Array.isArray(value.content)) candidate = value.content
  }
  if (Array.isArray(candidate)) {
    return parseText(
      candidate
        .map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : ''))
        .filter(Boolean)
        .join('\n')
    )
  }
  return typeof candidate === 'string' ? parseText(candidate) : candidate
}

// Results saved before the tools reported a kind, avatar or summary: `create_agent` returned only these.
const LegacyCreateAgentOutputSchema = z.object({ ok: z.literal(true), agentId: z.string(), name: z.string() })

const ToolOutputSchema = z.union([
  AgentConfigToolOutputSchema,
  AssistantCreateToolOutputSchema,
  LegacyCreateAgentOutputSchema
])

export function getResourceIdentityResult(
  toolResponse: McpToolResponse | NormalToolResponse
): ResourceIdentityResult | undefined {
  const toolKind = toolResponse.status === 'done' ? getAgentConfigToolKind(toolResponse) : undefined
  if (!toolKind) return undefined
  const parsed = ToolOutputSchema.safeParse(toStructuredOutput(toolResponse.response))
  if (!parsed.success) return undefined

  const output = parsed.data
  const updated = toolKind === 'update' || toolKind === 'self_update'
  const action = { action: updated ? 'updated' : 'created', self: toolKind === 'self_update' } as const
  if (!('kind' in output)) {
    return { kind: 'agent', id: output.agentId, name: output.name, emoji: '', description: '', summary: [], ...action }
  }
  const { kind, name, emoji, description, summary, highlights } = output
  const id = output.kind === 'assistant' ? output.assistantId : output.agentId
  return { kind, id, name, emoji, description, summary, highlights, ...action }
}

/** Decided before the output loads, so a deferred result still lands in the inline result lane. */
export function isResourceIdentityResultPart(part: CherryMessagePart): boolean {
  if (!isToolUIPart(part) || part.state !== 'output-available') return false

  const toolResponse = buildToolResponseFromPart(part)
  if (!toolResponse || !getAgentConfigToolKind(toolResponse)) return false
  return isDeferredToolOutput(toolResponse.response) || getResourceIdentityResult(toolResponse) !== undefined
}
