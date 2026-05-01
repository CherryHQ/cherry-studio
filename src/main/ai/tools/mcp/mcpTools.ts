/**
 * MCP tool resolution: converts MCPTool definitions into AI SDK tool() instances.
 *
 * Flow:
 * 1. AiService calls resolveMcpTools(mcpToolIds) per request
 * 2. mcpServerService.list({ isActive: true }) yields the live server set
 * 3. McpService.listTools(server) fetches tool definitions (5-min cached)
 * 4. createMcpTool() wraps each match as an AI SDK Tool with execute → MCPService.callTool()
 * 5. Returns a fresh ToolSet — never persisted across requests
 *
 * Why per-request (no long-lived registry):
 *  - server uninstall: a cached `execute` closure would keep referencing
 *    a server id that the user removed, surfacing as cryptic
 *    "MCP tool call failed" errors at the LLM tool-call layer.
 *  - schema drift: a server that reloaded with a changed inputSchema
 *    would be served the previous schema until process restart, so the
 *    LLM would call with stale args.
 *
 * Performance: McpService.listTools has its own 5-min cache. Per-request
 * resolution only rebuilds AI SDK Tool wrapper objects, which is cheap.
 */

import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { mcpServerService } from '@main/data/services/McpServerService'
import { shouldAutoApprove } from '@main/services/toolApproval/autoApprovePolicy'
import type { MCPCallToolResponse, MCPServer, MCPTool } from '@types'
import type { JSONSchema7, Tool, ToolSet } from 'ai'
import { jsonSchema } from 'ai'

import { mcpResultToTextSummary } from './utils'

const logger = loggerService.withContext('mcpTools')

/**
 * Convert an MCPTool definition into an AI SDK Tool.
 * @param disabledAutoApproveTools - server's explicit opt-out list
 */
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
      const mcpService = application.get('McpService')
      const result: MCPCallToolResponse = await mcpService.callTool({
        server: { id: mcpTool.serverId } as MCPServer,
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
    // `toModelOutput` produces the string the model sees. We route it
    // through `mcpResultToTextSummary` so image / audio / binary-resource
    // parts become `[Image: …, delivered to user]` placeholders, matching
    // the renderer-side behaviour (origin/main `aiCore/utils/mcp.ts`).
    toModelOutput({ output }) {
      const result = output as MCPCallToolResponse
      return { type: 'text' as const, value: mcpResultToTextSummary(result) }
    }
  }
}

/**
 * Resolve MCP tool IDs to a fresh AI SDK ToolSet for one request.
 *
 * Tool IDs are produced by `buildFunctionCallToolName(serverName, toolName)`
 * in the format `mcp__{camelServerName}__{camelToolName}` — three segments,
 * with the second carrying a transformed display name (camelCased, possibly
 * truncated). That transformation is lossy, so we cannot map a tool id back
 * to a server uuid by string parsing. Instead we iterate every active MCP
 * server, ask `listTools` per server (5-min cache in McpService), and keep
 * the matches.
 *
 * Returns `undefined` (not an empty object) when no tools match, since the
 * AI SDK treats `tools: undefined` as "no tools" — passing `{}` can trip
 * provider plugins that check `tools != null`.
 */
export async function resolveMcpTools(mcpToolIds: string[]): Promise<ToolSet | undefined> {
  if (mcpToolIds.length === 0) return undefined

  const requested = new Set(mcpToolIds)
  const mcpService = application.get('McpService')
  const { items: activeServers } = await mcpServerService.list({ isActive: true })

  const result: ToolSet = {}
  for (const server of activeServers) {
    try {
      const allTools = await mcpService.listTools(server)
      for (const mcpTool of allTools) {
        if (!requested.has(mcpTool.id)) continue
        result[mcpTool.id] = createMcpTool(mcpTool, server.disabledAutoApproveTools)
      }
    } catch (error) {
      logger.error('Failed to resolve MCP tools for server', {
        serverId: server.id,
        serverName: server.name,
        error
      })
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}
