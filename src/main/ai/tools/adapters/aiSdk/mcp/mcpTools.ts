import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { mcpServerService } from '@main/data/services/McpServerService'
import { isMcpToolForcePromptBySource } from '@shared/ai/tools/mcpSourcePolicy'
import { toCamelCase } from '@shared/mcp'
import type { MCPCallToolResponse, MCPServer, MCPTool } from '@types'
import { jsonSchema, type JSONSchema7, type Tool } from 'ai'

async function resolveServerById(serverId: string): Promise<MCPServer | undefined> {
  const { items } = await mcpServerService.list({ isActive: true })
  return items.find((s) => s.id === serverId)
}

import { registry, type ToolRegistry } from '../registry'
import type { ToolEntry } from '../types'
import { mcpResultToTextSummary } from './utils'

const logger = loggerService.withContext('mcpTools')

/** Build the AI SDK Tool wrapper around a single MCPTool. */
function createMcpTool(mcpTool: MCPTool, server: MCPServer): Tool {
  return {
    type: 'function',
    description: mcpTool.description || mcpTool.name,
    inputSchema: jsonSchema(mcpTool.inputSchema as JSONSchema7),
    needsApproval: async () => {
      return isMcpToolForcePromptBySource(server, mcpTool)
    },
    execute: async (args: Record<string, unknown>, { toolCallId }) => {
      const server = await resolveServerById(mcpTool.serverId)
      if (!server) {
        throw new Error(`MCP server ${mcpTool.serverId} is not active or no longer registered`)
      }
      const result: MCPCallToolResponse = await application.get('McpRuntimeService').callTool({
        serverId: server.id,
        name: mcpTool.name,
        args,
        callId: toolCallId
      })

      if (result.isError) {
        throw new Error(mcpResultToTextSummary(result) || 'MCP tool call failed')
      }

      // Full MCPCallToolResponse for the renderer's ToolUIPart (multimodal
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
      const result = output as MCPCallToolResponse
      return { type: 'text' as const, value: mcpResultToTextSummary(result) }
    }
  }
}

function toEntry(mcpTool: MCPTool, server: MCPServer): ToolEntry {
  return {
    name: mcpTool.id,
    namespace: `mcp:${server.name}`,
    description: mcpTool.description || mcpTool.name,
    defer: 'auto',
    tool: createMcpTool(mcpTool, server),
    applies: (scope) => scope.mcpToolIds.has(mcpTool.id)
  }
}

/** Prefix `mcp__<camelCase(serverName)>__<rest>` matches `buildFunctionCallToolName`. */
function filterServersByToolIds(
  servers: readonly MCPServer[],
  selectedToolIds: ReadonlySet<string>
): readonly MCPServer[] {
  if (!selectedToolIds.size) return []
  return servers.filter((server) => {
    const prefix = `mcp__${toCamelCase(server.name)}__`
    for (const id of selectedToolIds) {
      if (id.startsWith(prefix)) return true
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
  for (const server of targetServers) {
    try {
      const enabledTools = await application.get('McpCatalogService').listTools(server.id, { includeDisabled: false })
      for (const mcpTool of enabledTools) {
        reg.register(toEntry(mcpTool, server))
        freshNames.add(mcpTool.id)
      }
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
    const inSyncScope = targetNamespaces.has(entry.namespace)
    const missing = !freshNames.has(entry.name)
    if (serverDeactivated || (inSyncScope && missing)) {
      reg.deregister(entry.name)
    }
  }
}
