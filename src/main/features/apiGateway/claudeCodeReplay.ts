import { createHash } from 'node:crypto'

import type { SharedV3ProviderMetadata } from '@ai-sdk/provider'
import type { ContentBlockParam, MessageParam } from '@anthropic-ai/sdk/resources/messages'

import type { ClaudeCodeReplayState } from '@data/db/schemas/agentSessionContext'
import { agentSessionContextService } from '@data/services/AgentSessionContextService'
import { selectToolContinuation, ToolContinuationRouteError } from '@main/ai/provider/replayRoute'
import type { EndpointType } from '@shared/data/types/model'

export interface ClaudeCodeReplayBlock {
  block: ContentBlockParam
  metadata?: SharedV3ProviderMetadata
}

function blockIdentity(block: ContentBlockParam): unknown[] | undefined {
  switch (block.type) {
    case 'tool_use':
      return [block.type, block.id, block.name, block.input]
    case 'thinking':
      return [block.type, block.signature, block.thinking]
    case 'redacted_thinking':
      return [block.type, block.data]
    case 'text':
      return [block.type, block.text]
    default:
      return undefined
  }
}

function fingerprint(values: unknown[]): string {
  const canonical = JSON.stringify(values, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, (value as Record<string, unknown>)[key]])
        )
      : value
  )
  return createHash('sha256').update(canonical).digest('hex')
}

function blockKeys(blocks: readonly ContentBlockParam[]): Array<string | undefined> {
  const identities = blocks.map(blockIdentity)
  const assistantKey = fingerprint(identities)
  return blocks.map((block, index) => {
    const identity = identities[index]
    if (!identity) return undefined
    const hasIdentity =
      block.type === 'tool_use' || block.type === 'redacted_thinking' || (block.type === 'thinking' && block.signature)
    // An empty reasoning block needs its assistant response to identify it.
    return hasIdentity ? fingerprint(identity) : `${assistantKey}:${index}`
  })
}

export function saveClaudeCodeReplay(
  sessionId: string,
  modelAddress: string,
  endpointType: EndpointType | undefined,
  blocks: readonly ClaudeCodeReplayBlock[]
): void {
  const required = blocks.find(({ metadata }) => metadata?.cherry?.replayRequiresRoute === true)?.metadata?.cherry
  const keys = blockKeys(blocks.map(({ block }) => block))
  const entries = blocks.flatMap<[string, ClaudeCodeReplayState | null]>(({ block, metadata }, index) => {
    const key = keys[index]
    if (!key) return []
    const state =
      block.type === 'tool_use' && typeof metadata?.cherry?.replayRouteId !== 'string' && required
        ? { cherry: required }
        : metadata
    return [
      [
        key,
        typeof state?.cherry?.replayRouteId === 'string'
          ? { modelAddress, ...(endpointType && { endpointType }), metadata: state }
          : null
      ]
    ]
  })
  if (entries.length) agentSessionContextService.saveClaudeCodeReplay(sessionId, entries)
}

export function readClaudeCodeReplay(sessionId: string, messages: readonly MessageParam[]) {
  const incomingKeys = new Map<ContentBlockParam, string>()
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'assistant' || typeof message.content === 'string') continue
    const blockIds = blockKeys(message.content)
    for (const [index, block] of message.content.entries()) {
      const key = blockIds[index]
      if (!key) continue
      if (seen.has(key)) repeated.add(key)
      else seen.add(key)
      incomingKeys.set(block, key)
    }
  }

  const states = incomingKeys.size ? agentSessionContextService.readClaudeCodeReplay(sessionId) : undefined
  const getState = (block: ContentBlockParam) => {
    const key = incomingKeys.get(block)
    if (!key) return undefined
    const state = states?.[key]
    return state && repeated.has(key) ? 'ambiguous' : state
  }
  const currentTurn = messages.findLastIndex(
    ({ role, content }) =>
      role === 'user' &&
      (typeof content === 'string'
        ? content.trim().length > 0
        : content.some((block) => block.type !== 'text' || block.text.trim()) &&
          !content.some((block) => block.type === 'tool_result'))
  )
  const completed = new Set<string>()
  for (const { role, content } of messages.slice(currentTurn + 1)) {
    if (role === 'user' && Array.isArray(content)) {
      for (const block of content) if (block.type === 'tool_result') completed.add(block.tool_use_id)
    }
  }
  const steps = messages.slice(currentTurn + 1).flatMap(({ role, content }) => {
    if (role !== 'assistant' || typeof content === 'string') return []
    const toolCallIds = content.flatMap((block) => (block.type === 'tool_use' ? [block.id] : []))
    return content.flatMap((block) => {
      const source = getState(block)
      if (source === 'ambiguous') {
        if (block.type === 'tool_use' && completed.has(block.id)) throw new ToolContinuationRouteError()
        return []
      }
      const cherry = source?.metadata.cherry
      return source && typeof cherry?.replayRouteId === 'string' && cherry.replayRequiresRoute === true
        ? [{ source, toolCallIds, requiredRoutes: [cherry.replayRouteId] }]
        : []
    })
  })
  return {
    getMetadata: (block: ContentBlockParam) => {
      const state = getState(block)
      return state === 'ambiguous' ? null : state?.metadata
    },
    continuation: selectToolContinuation(steps, completed)
  }
}
