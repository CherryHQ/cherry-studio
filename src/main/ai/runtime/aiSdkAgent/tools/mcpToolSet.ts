/**
 * MCP tool set for the `ai-sdk` agent runtime (plan D6).
 *
 * Mirrors the pi runtime's `buildMcpToolDefinitions`: resolve the agent's
 * selected server ids/names, warm the catalog (`warmToolsCache` is a no-op on
 * a populated cache and single-flights a cold one, so per-turn assembly stays
 * cheap and a dead/slow server neither blocks nor fails the turn — it
 * degrades to an empty tool list and is re-probed next turn), then read
 * cache-only via `listTools`. Tools keep their native `mcp__<server>__<tool>`
 * ids so they match the other runtimes on the wire, and the actual execution
 * reuses the chat adapter's `createMcpTool` (McpRuntimeService proxy). The
 * agent's approval policy is layered on afterwards by `toolPolicy` — the
 * source-policy `needsApproval` baked in here is overridden.
 */

import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { createMcpTool } from '@main/ai/tools/adapters/aiSdk/mcp/mcpTools'
import { isMcpToolForcePromptBySource } from '@shared/ai/tools/mcpSourcePolicy'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { Tool } from 'ai'

const logger = loggerService.withContext('AiSdkAgentMcpToolSet')

/** Build the AI SDK tools for the agent's selected MCP servers, keyed by native tool id. */
export async function buildMcpToolSet(mcpIds: readonly string[]): Promise<Record<string, Tool>> {
  if (mcpIds.length === 0) return {}

  const catalog = application.get('McpCatalogService')

  // Dedup by id: a server selected twice must not mint duplicate tool names.
  const servers = new Map<string, McpServer>()
  for (const idOrName of mcpIds) {
    const server = mcpServerService.findByIdOrName(idOrName)
    if (!server) {
      logger.warn('Skipping unresolvable MCP server referenced by agent', { idOrName })
      continue
    }
    servers.set(server.id, server)
  }
  if (servers.size === 0) return {}

  const resolved = [...servers.values()]
  await Promise.allSettled(resolved.map((server) => catalog.warmToolsCache(server.id)))

  const tools: Record<string, Tool> = {}
  for (const server of resolved) {
    for (const mcpTool of catalog.listTools(server.id, { includeDisabled: false })) {
      tools[mcpTool.id] = createMcpTool(mcpTool, isMcpToolForcePromptBySource(server, mcpTool))
    }
  }
  return tools
}
