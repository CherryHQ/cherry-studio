/**
 * Resolve MCP tool IDs an assistant can use. Called when a request
 * doesn't carry explicit `mcpToolIds`.
 */

import { assistantDataService } from '@data/services/AssistantService'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { mcpServerService } from '@main/data/services/McpServerService'
import { isMcpToolDisabledBySource } from '@shared/ai/tools/mcpSourcePolicy'
import type { Assistant, McpMode } from '@shared/data/types/assistant'
import type { McpServer } from '@shared/data/types/mcpServer'

const logger = loggerService.withContext('resolveAssistantMcpTools')

/** `settings.mcpMode` if set; else 'manual' when any linked servers, else 'disabled'. */
export function getEffectiveMcpMode(assistant: Assistant): McpMode {
  const mode = assistant.settings?.mcpMode
  if (mode) return mode
  return assistant.mcpServerIds.length > 0 ? 'manual' : 'disabled'
}

async function resolveServersForAssistant(assistant: Assistant, mode: McpMode): Promise<McpServer[]> {
  const { items: activeServers } = await mcpServerService.list({ isActive: true })
  if (mode === 'auto') return activeServers
  const linkedIds = new Set(assistant.mcpServerIds)
  return activeServers.filter((server) => linkedIds.has(server.id))
}

function isToolDisabled(server: McpServer, tool: { name: string; id: string; description?: string }): boolean {
  return isMcpToolDisabledBySource(server, tool)
}

/** Returns `[]` when the assistant is missing, MCP disabled, or no servers linked. */
export async function resolveAssistantMcpToolIds(assistantId: string): Promise<string[]> {
  const assistant = await assistantDataService.getById(assistantId).catch(() => null)
  if (!assistant) {
    logger.debug('Assistant not found, skipping MCP resolution', { assistantId })
    return []
  }

  const mode = getEffectiveMcpMode(assistant)
  if (mode === 'disabled') return []

  const servers = await resolveServersForAssistant(assistant, mode)
  if (servers.length === 0) return []

  const perServerResults = await Promise.allSettled(
    servers.map(async (server) => {
      const tools = await application.get('McpCatalogService').listTools(server.id)
      return tools.filter((tool) => !isToolDisabled(server, tool)).map((tool) => tool.id)
    })
  )

  return perServerResults.flatMap((result) => {
    if (result.status === 'fulfilled') return result.value
    logger.warn('Failed to list tools for an MCP server', { err: result.reason })
    return []
  })
}
