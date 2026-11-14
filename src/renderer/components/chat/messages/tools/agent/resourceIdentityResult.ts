import { isToolUIPart } from 'ai'

import type { McpToolResponse, NormalToolResponse } from '@renderer/types/mcpTool'
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

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

export function getResourceIdentityResult(
  toolResponse: McpToolResponse | NormalToolResponse
): ResourceIdentityResult | undefined {
  const toolKind = toolResponse.status === 'done' ? getAgentConfigToolKind(toolResponse) : undefined
  if (!toolKind) return undefined
  const output = toStructuredOutput(toolResponse.response)
  if (!isRecord(output) || output.ok !== true || typeof output.name !== 'string') return undefined

  const isAssistant = output.kind === 'assistant'
  const id = isAssistant ? output.assistantId : output.agentId
  if (typeof id !== 'string') return undefined
  return {
    kind: isAssistant ? 'assistant' : 'agent',
    id,
    name: output.name,
    emoji: stringOr(output.emoji, ''),
    description: stringOr(output.description, ''),
    summary: Array.isArray(output.summary) ? output.summary.filter((line) => typeof line === 'string') : [],
    action: toolKind === 'create' ? 'created' : 'updated',
    self: toolKind === 'self_update'
  }
}

/** Decided before the output loads, so a deferred result still lands in the inline result lane. */
export function isResourceIdentityResultPart(part: CherryMessagePart): boolean {
  if (!isToolUIPart(part) || part.state !== 'output-available') return false

  const toolResponse = buildToolResponseFromPart(part)
  if (!toolResponse || !getAgentConfigToolKind(toolResponse)) return false
  return isDeferredToolOutput(toolResponse.response) || getResourceIdentityResult(toolResponse) !== undefined
}
