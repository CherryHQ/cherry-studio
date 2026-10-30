import { createHash } from 'node:crypto'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { estimateMessageTokens } from '@earendil-works/pi-ai/utils/estimate'
import { getCurrentSystemMessage } from '@earendil-works/pi-ai/utils/transcript'
import type { Conversation } from '@earendil-works/pi-durable'

import type { OperationResult, ThreadContextUsage } from '@cherrystudio/agent-runtime'

export async function readContextUsage(conversation: Conversation): Promise<OperationResult<ThreadContextUsage>> {
  const usage = await conversation.contextUsage(BACKGROUND_CONTEXT)
  if (!usage)
    return {
      status: 'unknown',
      error: { operation: 'contextUsage', code: 'unavailable', message: 'Context measurement unavailable' }
    }
  const system = getCurrentSystemMessage(usage.messages)
  const categories: NonNullable<ThreadContextUsage['breakdown']>['categories'][number][] = []
  if (system) {
    const { toolsAdded, ...prompt } = system
    categories.push({
      id: 'system-prompt',
      key: 'system-prompt',
      occupancy: 'included',
      precision: 'estimated',
      tokens: estimateMessageTokens(prompt)
    })
    if (toolsAdded?.length)
      categories.push({
        id: 'system-tools',
        key: 'system-tools',
        occupancy: 'included',
        precision: 'estimated',
        tokens: estimateMessageTokens({ role: 'system', content: '', toolsAdded, timestamp: system.timestamp })
      })
  }
  categories.push({
    id: 'messages',
    key: 'messages',
    occupancy: 'included',
    precision: 'estimated',
    tokens: usage.messages
      .filter((message) => message.role !== 'system')
      .reduce((sum, message) => sum + estimateMessageTokens(message), 0)
  })
  if (usage.deferred.length)
    categories.push({
      id: 'deferred-tools',
      key: 'system-tools',
      occupancy: 'deferred',
      precision: 'estimated',
      tokens: estimateMessageTokens({ role: 'system', content: '', toolsAdded: [...usage.deferred], timestamp: 0 })
    })
  return {
    status: 'confirmed',
    value: {
      model: usage.model.modelId,
      revision: createHash('sha256').update(usage.revision).digest('hex'),
      contextWindow: usage.contextWindow,
      ...(usage.compactionThreshold !== undefined && { compactionThreshold: usage.compactionThreshold }),
      used: { tokens: usage.tokens, precision: 'estimated' },
      basis: 'current-context',
      breakdown: { coverage: 'partial', categories },
      resources: [
        ...(system?.toolsAdded ?? []).map((tool) => ({
          id: tool.name,
          category: 'system-tools' as const,
          name: tool.name,
          state: 'loaded' as const
        })),
        ...usage.deferred.map((tool) => ({
          id: tool.name,
          category: 'system-tools' as const,
          name: tool.name,
          state: 'deferred' as const
        }))
      ]
    }
  }
}
