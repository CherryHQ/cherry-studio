import { createHash } from 'node:crypto'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { measureSystemContext } from '@earendil-works/pi-ai/utils/context-usage'
import { estimateMessageTokens } from '@earendil-works/pi-ai/utils/estimate'
import { getCurrentSystemMessage } from '@earendil-works/pi-ai/utils/transcript'
import type { Conversation } from '@earendil-works/pi-durable'

import type {
  ContextCategory,
  ContextCategoryKey,
  ContextResource,
  OperationResult,
  ThreadContextUsage
} from '@cherrystudio/agent-runtime'

export async function readContextUsage(conversation: Conversation): Promise<OperationResult<ThreadContextUsage>> {
  const usage = await conversation.contextUsage(BACKGROUND_CONTEXT)
  if (!usage)
    return {
      status: 'unknown',
      error: { operation: 'contextUsage', code: 'unavailable', message: 'Context measurement unavailable' }
    }
  const system = getCurrentSystemMessage(usage.messages)
  const categories: ContextCategory[] = []
  const resources: ContextResource[] = []
  for (const part of measureSystemContext(system, usage.deferred)) {
    const key = categoryKeys[part.kind] ?? 'other'
    const occupancy = part.state === 'deferred' ? 'deferred' : 'included'
    const id = `${key}:${occupancy}`
    const category = categories.find((category) => category.id === id)
    if (category) categories[categories.indexOf(category)] = { ...category, tokens: category.tokens + part.tokens }
    else categories.push({ id, key, occupancy, tokens: part.tokens, precision: 'estimated' })
    if (part.state)
      resources.push({
        id: `tool:${part.id}`,
        category: key,
        name: part.id,
        source: part.source,
        state: part.state,
        count: { tokens: part.tokens, precision: 'estimated' }
      })
    else
      for (const resource of part.resources ?? [])
        resources.push({
          id: `section:${part.id}:${resource.id}`,
          category: key,
          name: resource.name,
          source: resource.source,
          state: 'loaded',
          count: {
            tokens: estimateMessageTokens({ role: 'system', content: ' '.repeat(resource.characters), timestamp: 0 }),
            precision: 'estimated'
          }
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
      resources
    }
  }
}

const categoryKeys: Record<string, ContextCategoryKey> = {
  'system-prompt': 'system-prompt',
  'system-tools': 'system-tools',
  'mcp-tools': 'mcp-tools',
  'mcp-instructions': 'mcp-instructions',
  'memory-files': 'memory-files',
  skills: 'skills',
  agents: 'agents'
}
