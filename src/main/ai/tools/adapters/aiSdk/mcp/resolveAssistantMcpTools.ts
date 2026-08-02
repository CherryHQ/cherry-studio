/**
 * Resolve MCP tool IDs an assistant can use. Called when a request
 * doesn't carry explicit `mcpToolIds`.
 */

import { application } from '@application'
import { assistantDataService } from '@data/services/AssistantService'
import { loggerService } from '@logger'
import { mcpServerService } from '@main/data/services/McpServerService'
import { isMcpToolDisabledBySource } from '@shared/ai/tools/mcpSourcePolicy'
import { type Assistant, DEFAULT_MCP_MODE, type McpMode } from '@shared/data/types/assistant'
import type { McpServer } from '@shared/data/types/mcpServer'

const logger = loggerService.withContext('resolveAssistantMcpTools')

/** `settings.mcpMode` if set; else the shared default ('manual' — only linked
 *  servers; with zero links that resolves to no tools, same as 'disabled'). */
export function getEffectiveMcpMode(assistant: Assistant): McpMode {
  return assistant.settings?.mcpMode ?? DEFAULT_MCP_MODE
}

function resolveServersForAssistant(assistant: Assistant, mode: McpMode): McpServer[] {
  const { items: activeServers } = mcpServerService.list({ isActive: true })
  if (mode === 'auto') return activeServers
  const linkedIds = new Set(assistant.mcpServerIds)
  return activeServers.filter((server) => linkedIds.has(server.id))
}

function isToolDisabled(server: McpServer, tool: { name: string; id: string; description?: string }): boolean {
  return isMcpToolDisabledBySource(server, tool)
}

/** Returns `[]` when the assistant is missing, MCP disabled, or no servers linked. */
export async function resolveAssistantMcpToolIds(assistantId: string): Promise<string[]> {
  let assistant: Assistant | null
  try {
    assistant = assistantDataService.getById(assistantId)
  } catch {
    assistant = null
  }
  if (!assistant) {
    logger.debug('Assistant not found, skipping MCP resolution', { assistantId })
    return []
  }

  const mode = getEffectiveMcpMode(assistant)
  if (mode === 'disabled') return []

  const servers = resolveServersForAssistant(assistant, mode)
  if (servers.length === 0) return []

  const perServerResults = await Promise.allSettled(
    servers.map(async (server) => {
      const catalog = application.get('McpCatalogService')
      // Warm before listing: `listTools` is cache-only, so a cold cache used to
      // resolve to a silent empty tool set (the request then ran without the
      // assistant's MCP tools — same assistant, different turns, different
      // tools). `warmToolsCache` awaits a live refresh when cold, resolves
      // immediately when populated, and respects the dead-server backoff.
      await catalog.warmToolsCache(server.id)
      const tools = catalog.listTools(server.id)
      return tools.filter((tool) => !isToolDisabled(server, tool)).map((tool) => tool.id)
    })
  )

  return perServerResults.flatMap((result) => {
    if (result.status === 'fulfilled') return result.value
    logger.warn('Failed to list tools for an MCP server', { err: result.reason })
    return []
  })
}
