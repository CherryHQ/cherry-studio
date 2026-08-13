import type { LoggerService } from '@logger'
import type { NeutralTool } from '@main/ai/agents/tools/types'
import { ToolError } from '@main/ai/agents/tools/types'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'

/**
 * Format a thrown error into the exact text the legacy MCP servers produced.
 *
 * The old handlers threw `McpError`, whose `.message` is already
 * `MCP error <code>: <text>`. Neutral handlers throw `ToolError` (which carries
 * the same numeric code), so reconstruct that prefix to keep the wire output
 * byte-identical. Plain errors from downstream services keep their bare message.
 */
function formatToolError(error: unknown): string {
  if (error instanceof McpError) return error.message
  if (error instanceof ToolError && error.code !== undefined) return `MCP error ${error.code}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}

/**
 * Wrap a set of runtime-neutral tools as a Claude SDK MCP server.
 *
 * The MCP-facing surface (tool names, descriptions, JSON Schemas, and the
 * `{ content, isError }` result/error shapes) mirrors the hand-written servers
 * this replaced — see the neutral definitions in `@main/ai/agents/tools`.
 */
export function createNeutralToolMcpServer<Ctx>(
  info: { name: string; version: string },
  tools: NeutralTool<Ctx>[],
  ctx: Ctx,
  logger: LoggerService
): McpServer {
  const server = new McpServer(info, { capabilities: { tools: {} } })

  const toolList: Tool[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as Tool['inputSchema']
  }))
  const byName = new Map(tools.map((tool) => [tool.name, tool]))

  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList }))

  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name
    const args = request.params.arguments ?? {}

    try {
      const tool = byName.get(toolName)
      if (!tool) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`)
      const result = await tool.handler(args, ctx)
      return { content: result.content, ...(result.isError ? { isError: true as const } : {}) }
    } catch (error) {
      const message = formatToolError(error)
      logger.error(`Tool error: ${toolName}`, { error: message })
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true
      }
    }
  })

  return server
}
