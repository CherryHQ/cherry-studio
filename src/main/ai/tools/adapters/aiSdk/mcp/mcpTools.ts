import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { mcpServerService } from '@main/data/services/McpServerService'
import { isMcpToolForcePromptBySource } from '@shared/ai/tools/mcpSourcePolicy'
import { isFunctionCallToolNameForServer } from '@shared/mcp'
import type { McpCallToolResponse, McpServer, McpTool } from '@types'
import { jsonSchema, type JSONSchema7, type Tool } from 'ai'

import { registry, type ToolRegistry } from '../registry'
import type { ToolEntry } from '../types'
import { mcpResultToTextSummary } from './utils'

const logger = loggerService.withContext('mcpTools')

async function resolveActiveServerById(serverId: string): Promise<McpServer | undefined> {
  // Direct point lookup instead of listing every active server on each tool call.
  const server = await mcpServerService.getById(serverId).catch(() => undefined)
  return server?.isActive ? server : undefined
}

/** Build the AI SDK Tool wrapper around a single McpTool. */
function createMcpTool(mcpTool: McpTool, forcePrompt: boolean): Tool {
  return {
    type: 'function',
    description: mcpTool.description || mcpTool.name,
    inputSchema: jsonSchema(mcpTool.inputSchema as JSONSchema7),
    needsApproval: async () => forcePrompt,
    execute: async (args: Record<string, unknown>, { toolCallId }) => {
      const server = await resolveActiveServerById(mcpTool.serverId)
      if (!server) {
        throw new Error(`MCP server ${mcpTool.serverId} is not active or no longer registered`)
      }
      const result: McpCallToolResponse = await application.get('McpRuntimeService').callTool({
        serverId: server.id,
        name: mcpTool.name,
        args,
        callId: toolCallId
      })

      if (result.isError) {
        throw new Error(mcpResultToTextSummary(result) || 'MCP tool call failed')
      }

      // Full McpCallToolResponse for the renderer's ToolUIPart (multimodal
      // parts intact); `toModelOutput` below produces the string view.
      return {
        ...result,
        metadata: {
          serverName: mcpTool.serverName,
          serverId: mcpTool.serverId,
          type: 'mcp' as const
        }
      }
    },
    toModelOutput({ output }) {
      const result = output as McpCallToolResponse
      return { type: 'text' as const, value: mcpResultToTextSummary(result) }
    }
  }
}

function toEntry(mcpTool: McpTool, server: McpServer): ToolEntry {
  // A force-prompt (approval-gated) tool must never defer: deferring removes it from the SDK
  // tool-set, so the SDK's native `needsApproval` gate never fires and it becomes reachable only
  // via `tool_invoke` — which would run it with no approval card. Keep it inline. Reading
  // `forcePrompt` once keeps `defer` and `needsApproval` in lock-step (they must always agree).
  const forcePrompt = isMcpToolForcePromptBySource(server, mcpTool)
  return {
    name: mcpTool.id,
    namespace: `mcp:${server.name}`,
    description: mcpTool.description || mcpTool.name,
    defer: forcePrompt ? 'never' : 'auto',
    tool: createMcpTool(mcpTool, forcePrompt),
    applies: (scope) => scope.mcpToolIds.has(mcpTool.id)
  }
}

/** Keep servers that own at least one selected tool id (see `buildFunctionCallToolName`). */
function filterServersByToolIds(
  servers: readonly McpServer[],
  selectedToolIds: ReadonlySet<string>
): readonly McpServer[] {
  if (!selectedToolIds.size) return []
  return servers.filter((server) => {
    for (const id of selectedToolIds) {
      if (isFunctionCallToolNameForServer(server.name, id)) return true
    }
    return false
  })
}

export interface SyncMcpToolsToRegistryOptions {
  /**
   * Restrict the per-server `listTools` round-trip to servers owning a
   * selected tool. Stale-server cleanup still runs globally. Omit for
   * full reconcile (bootstrap / admin).
   */
  readonly selectedToolIds?: ReadonlySet<string>
}

/**
 * Reconcile the registry against the live server snapshot. Adds new
 * tools, replaces existing (so schema changes take effect), drops
 * deactivated — covers server uninstall and `tools/list_changed`
 * without subscribing to events.
 */
export async function syncMcpToolsToRegistry(
  reg: ToolRegistry = registry,
  opts: SyncMcpToolsToRegistryOptions = {}
): Promise<void> {
  const { items: activeServers } = await mcpServerService.list({ isActive: true })

  const targetServers = opts.selectedToolIds
    ? filterServersByToolIds(activeServers, opts.selectedToolIds)
    : activeServers
  const targetNamespaces = new Set(targetServers.map((s) => `mcp:${s.name}`))
  const activeNamespaces = new Set(activeServers.map((s) => `mcp:${s.name}`))

  const freshNames = new Set<string>()
  // Only namespaces whose `listTools` actually succeeded. A transient connection drop
  // must NOT evict a still-active server's previously-registered tools — without this
  // guard the eviction loop below sees every prior tool as `missing` and deregisters them.
  const refreshedNamespaces = new Set<string>()
  for (const server of targetServers) {
    try {
      const enabledTools = await application.get('McpCatalogService').listTools(server.id, { includeDisabled: false })
      for (const mcpTool of enabledTools) {
        reg.register(toEntry(mcpTool, server))
        freshNames.add(mcpTool.id)
      }
      refreshedNamespaces.add(`mcp:${server.name}`)
    } catch (error) {
      logger.error('Failed to list MCP tools for server', {
        serverId: server.id,
        serverName: server.name,
        error
      })
    }
  }

  for (const entry of reg.getAll()) {
    if (!entry.namespace.startsWith('mcp:')) continue
    const serverDeactivated = !activeNamespaces.has(entry.namespace)
    // Gate the in-scope eviction on a successful refresh, so a failed `listTools` leaves
    // the prior snapshot intact. A truly deactivated server is still evicted regardless.
    const inSyncScope = targetNamespaces.has(entry.namespace) && refreshedNamespaces.has(entry.namespace)
    const missing = !freshNames.has(entry.name)
    if (serverDeactivated || (inSyncScope && missing)) {
      reg.deregister(entry.name)
    }
  }
}
