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

/**
 * Upper bound on how long a chat request waits for `warmToolsCache` on a cold
 * cache. Trade-off: long enough for a healthy server's cold-start refresh
 * (connect + listTools) to land, short enough that an unreachable server —
 * whose connect timeout floor is 3 minutes (`MCP_CONNECT_TIMEOUT_FLOOR_MS`) —
 * cannot stall the first chat message after startup.
 */
const WARM_TOOLS_TIMEOUT_MS = 10_000

/**
 * Race the warm against `WARM_TOOLS_TIMEOUT_MS`; returns `false` on timeout.
 * The underlying refresh is deliberately NOT aborted — it stays single-flighted
 * inside `McpCatalogService` and finishes in the background, so the next
 * request reads a populated cache; this request degrades to whatever the
 * cache-only `listTools` currently holds.
 */
async function warmToolsCacheWithTimeout(serverId: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      application
        .get('McpCatalogService')
        .warmToolsCache(serverId)
        .then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), WARM_TOOLS_TIMEOUT_MS)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** `settings.mcpMode` if set; else the shared default ('manual' — only linked
 *  servers; with zero links that resolves to no tools, same as 'disabled'). */
export function getEffectiveMcpMode(assistant: Assistant): McpMode {
  return assistant.settings?.mcpMode ?? DEFAULT_MCP_MODE
}

export function resolveServersForAssistant(assistant: Assistant, mode: McpMode): McpServer[] {
  const linkedIds = mode === 'auto' ? null : new Set(assistant.mcpServerIds)
  // Manual mode with nothing linked can only resolve to an empty set — skip the query. Every chat
  // request reaches here (the resource-tool gate), and 'manual' is the default mode.
  if (linkedIds?.size === 0) return []
  const { items: activeServers } = mcpServerService.list({ isActive: true })
  return linkedIds ? activeServers.filter((server) => linkedIds.has(server.id)) : activeServers
}

/**
 * The assistant's in-scope servers that declared the `resources` capability — the gate and the
 * reachable set for the `mcp_resource_*` tools.
 *
 * Reads capabilities off already-connected clients only: this runs on the chat hot path (and again
 * inside every tool call), so it must never open a connection. A server that has not connected yet
 * simply doesn't expose its resources this turn; the tools appear once it has.
 */
export function resolveMcpResourceServers(assistant: Assistant | undefined): McpServer[] {
  if (!assistant) return []
  const mode = getEffectiveMcpMode(assistant)
  if (mode === 'disabled') return []
  const runtime = application.get('McpRuntimeService')
  return resolveServersForAssistant(assistant, mode).filter(
    (server) => !!runtime.getConnectedServerCapabilities(server.id)?.resources
  )
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
      // immediately when populated, and respects the dead-server backoff —
      // but the wait is capped so this chat hot path can never hang on a
      // slow connect (see `WARM_TOOLS_TIMEOUT_MS`).
      const warmed = await warmToolsCacheWithTimeout(server.id)
      if (!warmed) {
        logger.warn('Timed out warming MCP tools cache; falling back to the current (possibly empty) cache', {
          serverId: server.id,
          timeoutMs: WARM_TOOLS_TIMEOUT_MS
        })
      }
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
