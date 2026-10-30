import { createHash } from 'node:crypto'

import { getCurrentSystemMessage } from '@earendil-works/pi-ai/utils/transcript'
import { estimateTokens, type AgentSession } from '@earendil-works/pi-coding-agent'

import type { OperationResult, ThreadContextUsage } from '@cherrystudio/agent-runtime'

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
  const categories: NonNullable<ThreadContextUsage['breakdown']>['categories'][number][] = []
  if (system) {
    const { toolsAdded, ...prompt } = system
    categories.push({
      id: 'system-prompt',
      key: 'system-prompt',
      occupancy: 'included',
      precision: 'estimated',
      tokens: estimateTokens(prompt)
    })
    if (toolsAdded?.length)
      categories.push({
        id: 'system-tools',
        key: 'system-tools',
        occupancy: 'included',
        precision: 'estimated',
        tokens: estimateTokens({ role: 'system', content: '', toolsAdded, timestamp: system.timestamp })
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
  if (deferred.length)
    categories.push({
      id: 'deferred-tools',
      key: 'system-tools',
      occupancy: 'deferred',
      precision: 'estimated',
      tokens: deferred.reduce(
        (sum, { name, description, parameters }) =>
          sum +
          estimateTokens({
            role: 'system',
            content: '',
            toolsAdded: [{ name, description, parameters }],
            timestamp: 0
          }),
        0
      )
    })
  return {
    status: 'confirmed',
    value: {
      model: model.id,
      revision: createHash('sha256')
        .update(JSON.stringify([model, session.sessionManager.getLeafId(), system]))
        .digest('hex'),
      contextWindow: usage.contextWindow,
      ...(usage.tokens === null ? {} : { used: { tokens: usage.tokens, precision: 'estimated' as const } }),
      basis: 'current-context',
      breakdown: { coverage: 'partial', categories },
      resources: [
        ...(system?.toolsAdded ?? []).map((tool) => ({
          id: tool.name,
          category: 'system-tools' as const,
          name: tool.name,
          state: 'loaded' as const,
          source: tools.find((info) => info.name === tool.name)?.sourceInfo.path
        })),
        ...deferred.map((tool) => ({
          id: tool.name,
          category: 'system-tools' as const,
          name: tool.name,
          state: 'deferred' as const,
          source: tool.sourceInfo.path
        })),
        ...session.resourceLoader
          .getAgentsFiles()
          .agentsFiles.map((file) => ({ id: file.path, category: 'memory-files' as const, name: file.path })),
        ...session.resourceLoader.getSkills().skills.map((skill) => ({
          id: skill.filePath,
          category: 'skills' as const,
          name: skill.name,
          source: skill.sourceInfo.path
        }))
      ]
    }
  }
}
