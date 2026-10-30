import { createHash } from 'node:crypto'

import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk'

import type { ContextCategoryKey, ContextResource, ThreadContextUsage } from '@cherrystudio/agent-runtime'

const keys: Record<string, ContextCategoryKey> = {
  messages: 'messages',
  system_prompt: 'system-prompt',
  system_tools: 'system-tools',
  mcp_tools: 'mcp-tools',
  mcp_instructions: 'mcp-instructions',
  memory_files: 'memory-files',
  skills: 'skills',
  custom_agents: 'agents',
  mcp_tools_deferred: 'mcp-tools',
  system_tools_deferred: 'system-tools'
}
const names: Record<string, string> = {
  'System prompt': 'system_prompt',
  'System tools': 'system_tools',
  'MCP tools': 'mcp_tools',
  'MCP server instructions': 'mcp_instructions',
  'MCP tools (deferred)': 'mcp_tools_deferred',
  'System tools (deferred)': 'system_tools_deferred',
  'Memory files': 'memory_files',
  Messages: 'messages',
  Skills: 'skills',
  'Custom agents': 'custom_agents'
}
const estimated = (tokens: number) => ({ tokens, precision: 'estimated' as const })

export function normalizeContextUsage(
  native: SDKControlGetContextUsageResponse,
  contextWindow: number
): ThreadContextUsage {
  const categories = native.categories
    .filter((row) => row.kind !== 'free' && row.kind !== 'buffer')
    .map((row) => {
      const id = (row.id && keys[row.id] ? row.id : names[row.name]) ?? row.name
      return {
        id,
        key: keys[id] ?? 'other',
        label: row.name,
        occupancy: row.kind === 'deferred' || row.isDeferred ? ('deferred' as const) : ('included' as const),
        ...estimated(row.tokens)
      }
    })
  const buffers = native.categories.filter((row) => row.kind === 'buffer')
  const reserved = buffers.length === 1 ? estimated(buffers[0].tokens) : undefined
  const resources: ContextResource[] = [
    ...(native.mcpTools ?? []).map((tool) => ({
      id: `mcp:${tool.serverName}:${tool.name}`,
      category: 'mcp-tools' as const,
      name: tool.name,
      source: tool.serverName,
      count: estimated(tool.tokens),
      ...(tool.isLoaded === undefined ? {} : { state: tool.isLoaded ? ('loaded' as const) : ('deferred' as const) })
    })),
    ...(native.memoryFiles ?? []).map((file) => ({
      id: `memory:${file.path}`,
      category: 'memory-files' as const,
      name: file.path,
      source: file.type,
      count: estimated(file.tokens)
    })),
    ...(native.agents ?? []).map((agent) => ({
      id: `agent:${agent.source}:${agent.agentType}`,
      category: 'agents' as const,
      name: agent.agentType,
      source: agent.source,
      count: estimated(agent.tokens)
    })),
    ...(native.skills?.skillFrontmatter ?? []).map((skill) => ({
      id: `skill:${skill.source}:${skill.name}`,
      category: 'skills' as const,
      name: skill.name,
      source: skill.source,
      count: estimated(skill.tokens)
    }))
  ]
  return {
    model: native.model,
    revision: createHash('sha256')
      .update(
        JSON.stringify([
          native.model,
          contextWindow,
          native.totalTokens,
          native.rawMaxTokens,
          native.autoCompactThreshold,
          native.isAutoCompactEnabled,
          reserved,
          categories,
          resources
        ])
      )
      .digest('hex'),
    contextWindow,
    ...(native.isAutoCompactEnabled &&
      native.autoCompactThreshold !== undefined && { compactionThreshold: native.autoCompactThreshold }),
    used: estimated(native.totalTokens),
    basis: 'current-context',
    ...(reserved && { reserved }),
    ...(reserved &&
      contextWindow === native.rawMaxTokens && {
        free: estimated(Math.max(0, contextWindow - native.totalTokens - reserved.tokens))
      }),
    breakdown: {
      coverage:
        categories.filter((row) => row.occupancy === 'included').reduce((sum, row) => sum + row.tokens, 0) ===
        native.totalTokens
          ? 'complete'
          : 'partial',
      categories
    },
    resources
  }
}
