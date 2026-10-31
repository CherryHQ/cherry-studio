import { createHash } from 'node:crypto'

import { measureSystemContext } from '@earendil-works/pi-ai/utils/context-usage'
import { getCurrentSystemMessage } from '@earendil-works/pi-ai/utils/transcript'
import { estimateSystemCharacters, estimateTokens, type AgentSession } from '@earendil-works/pi-coding-agent'

import type {
  ContextCategory,
  ContextCategoryKey,
  ContextResource,
  OperationResult,
  ThreadContextUsage
} from '@cherrystudio/agent-runtime'

export function readContextUsage(session: AgentSession): OperationResult<ThreadContextUsage> {
  const usage = session.getContextUsage()
  const model = session.model
  if (!usage || !model)
    return {
      status: 'unknown',
      error: { operation: 'contextUsage', code: 'no-model', message: 'No model context window' }
    }
  const projection = session.sessionManager.buildSessionProjection()
  const system = getCurrentSystemMessage(projection.messages)
  const tools = session.getAllTools()
  const loaded = new Set(system?.toolsAdded?.map((tool) => tool.name))
  const deferred = tools.filter((tool) => !loaded.has(tool.name) && tool.exposure === 'deferred')
  const categories: ContextCategory[] = []
  const resources: ContextResource[] = []
  for (const part of measureSystemContext(system, deferred, estimateSystemCharacters, '')) {
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
            tokens: estimateTokens({ role: 'system', content: ' '.repeat(resource.characters), timestamp: 0 }),
            precision: 'estimated'
          }
        })
  }
  categories.push({
    id: 'messages',
    key: 'messages',
    occupancy: 'included',
    precision: 'estimated',
    tokens: projection.messages
      .filter((message) => message.role !== 'system')
      .reduce((sum, message) => sum + estimateTokens(message), 0)
  })
  return {
    status: 'confirmed',
    value: {
      model: model.id,
      revision: createHash('sha256')
        .update(JSON.stringify([model, session.sessionManager.getLeafId(), system, deferred]))
        .digest('hex'),
      contextWindow: usage.contextWindow,
      ...(usage.tokens === null ? {} : { used: { tokens: usage.tokens, precision: 'estimated' as const } }),
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
