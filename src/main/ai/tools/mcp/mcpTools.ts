import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { mcpServerService } from '@main/data/services/McpServerService'
import { shouldAutoApprove } from '@main/services/toolApproval/autoApprovePolicy'
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
function createMcpTool(mcpTool: MCPTool, disabledAutoApproveTools?: readonly string[]): Tool {
  return {
    type: 'function',
    description: mcpTool.description || mcpTool.name,
    inputSchema: jsonSchema(mcpTool.inputSchema as JSONSchema7),
    needsApproval: async () =>
      !shouldAutoApprove({
        toolKind: 'mcp',
        toolName: mcpTool.name,
        serverDisabledAutoApprove: disabledAutoApproveTools
      }),
    execute: async (args: Record<string, unknown>, { toolCallId }) => {
      const server = await resolveServerById(mcpTool.serverId)
      if (!server) {
        throw new Error(`MCP server ${mcpTool.serverId} is not active or no longer registered`)
      }
      const mcpService = application.get('McpService')
      const result: MCPCallToolResponse = await mcpService.callTool({
        server,
        name: mcpTool.name,
        args,
        callId: toolCallId
      })

      if (result.isError) {
        throw new Error(mcpResultToTextSummary(result) || 'MCP tool call failed')
      }

      // Return the full MCPCallToolResponse so the renderer's ToolUIPart has
      // access to the original content array (images, audio, resources). The
      // model-facing string view is produced by `toModelOutput` below so
      // multimodal parts collapse to placeholders instead of being silently
      // dropped.
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
    tool: createMcpTool(mcpTool, server.disabledAutoApproveTools),
    applies: (scope) => scope.mcpToolIds.has(mcpTool.id)
  }
}

/**
 * Reconcile the registry's MCP entries with the live server snapshot. Adds
 * entries for tools currently listable, replaces existing ones (so schema
 * changes take effect immediately), and drops entries whose tools are no
 * longer in the snapshot — covering both server uninstall and per-server
 * `tools/list_changed` notifications without an explicit event subscription.
 *
 * Tests pass a fresh registry; production calls default to the module
 * singleton.
 */
export async function syncMcpToolsToRegistry(reg: ToolRegistry = registry): Promise<void> {
  const mcpService = application.get('McpService')
  const { items: activeServers } = await mcpServerService.list({ isActive: true })

  const freshNames = new Set<string>()
  for (const server of activeServers) {
    try {
      const allTools = await mcpService.listTools(server)
      for (const mcpTool of allTools) {
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
    if (entry.namespace.startsWith('mcp:') && !freshNames.has(entry.name)) {
      reg.deregister(entry.name)
    }
  }
}
