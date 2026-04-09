import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const logger = loggerService.withContext('SdkMcpBridge')

/**
 * Creates a `McpServer` instance that proxies tool calls to an existing
 * MCP server managed by `MCPService`.
 *
 * This avoids the HTTP round-trip of the StreamableHTTP proxy and instead
 * uses the Claude Agent SDK's in-memory (`type: 'sdk'`) transport, which
 * is more reliable for in-process communication.
 */
export async function createSdkMcpServerInstance(mcpId: string): Promise<McpServer> {
  const serverConfig = await mcpServerService.findByIdOrName(mcpId)
  if (!serverConfig) {
    throw new Error(`MCP server not found: ${mcpId}`)
  }

  const sdkServer = new McpServer({ name: serverConfig.name, version: '0.1.0' }, { capabilities: { tools: {} } })

  // Use the low-level Server to set raw request handlers that proxy
  // tool calls to the actual MCP server via MCPService, avoiding
  // Zod schema re-declaration complexity.
  const rawServer = sdkServer.server

  rawServer.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug('SDK bridge: listing tools', { mcpId })
    const mcpService = application.get('MCPService')
    const client = await mcpService.initClient(serverConfig)
    return client.listTools()
  })

  rawServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    logger.debug('SDK bridge: calling tool', { mcpId, tool: request.params.name })
    const mcpService = application.get('MCPService')
    const client = await mcpService.initClient(serverConfig)
    return client.callTool(request.params)
  })

  logger.info(`Created SDK MCP bridge for "${serverConfig.name}"`)
  return sdkServer
}
