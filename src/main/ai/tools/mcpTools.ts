/**
 * MCP tool registration: converts MCPTool definitions into AI SDK tool() instances.
 *
 * Flow:
 * 1. AiService calls registerMcpTools() with mcpToolIds from the request
 * 2. MCPService.listTools() fetches tool definitions from MCP servers
 * 3. createMcpTool() wraps each as an AI SDK tool with execute → MCPService.callTool()
 * 4. needsApproval set per-tool based on server.disabledAutoApproveTools
 * 5. Tools are registered in ToolRegistry, resolved per-request via resolve(toolIds)
 */

import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { mcpServerService } from '@main/data/services/McpServerService'
import { shouldAutoApprove } from '@main/services/toolApproval/autoApprovePolicy'
import type { MCPCallToolResponse, MCPServer, MCPTool } from '@types'
import type { JSONSchema7, Tool } from 'ai'
import { jsonSchema } from 'ai'

import { mcpResultToTextSummary } from '../utils/mcp'
import type { RegisteredTool, ToolRegistry } from './ToolRegistry'

const logger = loggerService.withContext('mcpTools')

/**
 * Convert an MCPTool definition into a RegisteredTool for the ToolRegistry.
 *
 * The `needsApproval` function delegates to `autoApprovePolicy` — single
 * source of truth shared with Claude Agent SDK's `canUseTool` wrapper. When
 * AI SDK v6 calls the predicate before executing, we emit a
 * `tool-approval-request` chunk automatically; the renderer flips the
 * `ToolUIPart` via `chat.addToolApprovalResponse` and `sendAutomaticallyWhen`
 * fires a new turn where `execute()` runs (or an `output-denied` part is
 * emitted on deny).
 *
 * @param disabledAutoApproveTools - server's explicit opt-out list
 */
function createMcpTool(mcpTool: MCPTool, disabledAutoApproveTools?: readonly string[]): RegisteredTool {
  const mcpToolDef: Tool = {
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

  return { name: mcpTool.id, source: 'mcp', tool: mcpToolDef }
}

/**
 * Register MCP tools into the ToolRegistry for the given tool IDs.
 * Tool IDs are in format "serverId__toolName" (MCPTool.id).
 *
 * Fetches tool definitions from MCPService + server config from DB,
 * creates AI SDK tool wrappers with needsApproval, and registers them.
 */
export async function registerMcpTools(registry: ToolRegistry, mcpToolIds: string[]): Promise<void> {
  if (mcpToolIds.length === 0) return

  const mcpService = application.get('McpService')

  // Group tool IDs by server to batch listTools calls
  const serverToolMap = new Map<string, string[]>()
  for (const toolId of mcpToolIds) {
    if (registry.has(toolId)) continue
    const separatorIndex = toolId.indexOf('__')
    if (separatorIndex === -1) continue
    const serverId = toolId.substring(0, separatorIndex)
    const existing = serverToolMap.get(serverId) ?? []
    existing.push(toolId)
    serverToolMap.set(serverId, existing)
  }

  for (const [serverId, toolIds] of serverToolMap) {
    try {
      // Fetch tools + server config in parallel
      const [allTools, serverConfig] = await Promise.all([
        mcpService.listTools({ id: serverId } as MCPServer),
        mcpServerService.getById(serverId).catch(() => null)
      ])

      const toolIdSet = new Set(toolIds)
      const disabledAutoApprove = serverConfig?.disabledAutoApproveTools

      for (const mcpTool of allTools) {
        if (toolIdSet.has(mcpTool.id)) {
          registry.register(createMcpTool(mcpTool, disabledAutoApprove))
        }
      }
    } catch (error) {
      logger.error('Failed to register MCP tools for server', { serverId, error })
    }
  }
}
