import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const logger = loggerService.withContext('SdkMcpBridge')

/**
 * Creates an `McpServer` instance that acts as an in-process bridge,
 * proxying tool list/call requests to an existing MCP server managed
 * by `McpService`.
 *
 * The returned instance is designed for use with the Claude Agent SDK's
 * in-memory (`type: 'sdk'`) transport, keeping all communication
 * within the Electron main process.
 */
export async function createSdkMcpServerInstance(mcpId: string): Promise<McpServer> {
  const serverConfig = await mcpServerService.findByIdOrName(mcpId)
  if (!serverConfig) {
    throw new Error(`MCP server not found: ${mcpId}`)
  }

  const sdkServer = new McpServer({ name: serverConfig.name, version: '0.1.0' }, { capabilities: { tools: {} } })

  // Use the low-level Server to set raw request handlers because this bridge
  // proxies requests to the downstream MCP server whose tool schemas are not
  // known at construction time. The high-level McpServer.tool() API requires
  // Zod schemas to be declared upfront, which is not feasible for a proxy.
  const rawServer = sdkServer.server

  rawServer.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
      logger.debug('SDK bridge: listing tools', { mcpId })
      const mcpService = application.get('McpService')
      const client = await mcpService.initClient(serverConfig)
      return client.listTools()
    } catch (error) {
      logger.error('SDK bridge: failed to list tools', { mcpId, error })
      throw error
    }
  })

  rawServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      logger.debug('SDK bridge: calling tool', { mcpId, tool: request.params.name })
      const mcpService = application.get('McpService')
      const client = await mcpService.initClient(serverConfig)
      return client.callTool(request.params)
    } catch (error) {
      logger.error('SDK bridge: failed to call tool', { mcpId, tool: request.params.name, error })
      throw error
    }
  })

  logger.info(`Created SDK MCP bridge for "${serverConfig.name}"`)
  return sdkServer
}
