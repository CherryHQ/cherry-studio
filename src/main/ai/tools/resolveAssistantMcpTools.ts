/**
 * Resolve the MCP tool IDs available to an assistant, entirely in Main.
 *
 * Flow (mirrors the former renderer-side `fetchMcpTools`):
 *   1. Load the assistant from SQLite via AssistantService
 *   2. Derive the effective MCP mode (auto / manual / disabled)
 *   3. Pick servers accordingly (hub server for auto, assistant-linked for manual)
 *   4. Ask MCPService to list tools per server, filter out disabled ones
 *   5. Return the flattened list of tool IDs
 *
 * Called by `AiService` when a request does not carry explicit
 * `mcpToolIds` — renderers no longer need to resolve tools themselves.
 */

import { assistantDataService } from '@data/services/AssistantService'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { mcpServerService } from '@main/data/services/McpServerService'
import type { Assistant, McpMode } from '@shared/data/types/assistant'
import type { MCPServer } from '@shared/data/types/mcpServer'

const logger = loggerService.withContext('resolveAssistantMcpTools')

/** Hub aggregation server auto-injected when an assistant is in `auto` MCP mode. */
const HUB_MCP_SERVER: MCPServer = {
  id: 'hub',
  name: 'mcp-hub',
  type: 'inMemory',
  isActive: true,
  provider: 'CherryAI',
  installSource: 'builtin',
  isTrusted: true
}

/**
 * Resolve the effective MCP mode for an assistant:
 *   - If `settings.mcpMode` is set, use it verbatim.
 *   - Otherwise, 'manual' when the assistant has any linked servers, else 'disabled'.
 * Exported so `systemPromptPlugin` can decide whether to append the hub-mode
 * system prompt on top of the user prompt.
 */
export function getEffectiveMcpMode(assistant: Assistant): McpMode {
  const mode = assistant.settings?.mcpMode
  if (mode) return mode
  return assistant.mcpServerIds.length > 0 ? 'manual' : 'disabled'
}

async function resolveServersForAssistant(assistant: Assistant, mode: McpMode): Promise<MCPServer[]> {
  if (mode === 'auto') return [HUB_MCP_SERVER]
  const { items: activeServers } = await mcpServerService.list({ isActive: true })
  const linkedIds = new Set(assistant.mcpServerIds)
  return activeServers.filter((server) => linkedIds.has(server.id))
}

/**
 * Resolve the MCP tool IDs ("serverName__toolName") for the given assistant.
 * Returns an empty list when the assistant is missing, MCP is disabled, or no
 * active servers are linked.
 */
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

  const mcpService = application.get('MCPService')
  const perServerResults = await Promise.allSettled(
    servers.map(async (server) => {
      const tools = await mcpService.listTools(server)
      return tools.filter((tool) => !server.disabledTools?.includes(tool.name)).map((tool) => tool.id)
    })
  )

  return perServerResults.flatMap((result) => {
    if (result.status === 'fulfilled') return result.value
    logger.warn('Failed to list tools for an MCP server', { err: result.reason })
    return []
  })
}
