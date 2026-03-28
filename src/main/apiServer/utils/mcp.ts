import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const logger = loggerService.withContext('MCPApiService')

/**
 * Creates a fresh MCP Server instance for a given server ID.
 *
 * A new Server is created for each transport session because the MCP SDK's
 * Protocol.connect() throws "Already connected" if the Server is already
 * bound to a transport. Since the Claude Agent SDK spawns a new CLI process
 * per query (including resumes), each process establishes a new HTTP
 * transport, so the proxy must provide a fresh Server instance every time.
 */
export async function createMcpServerForTransport(id: string): Promise<Server> {
  const mcpServer = await mcpServerService.findByIdOrName(id)
  if (!mcpServer) {
    throw new Error(`Server not found: ${id}`)
  }

  const server = new Server({ name: mcpServer.name, version: '0.1.0' }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    const serverId = request.params?._meta?.serverId
    if (typeof serverId !== 'string') throw new Error('Missing serverId in _meta')
    logger.debug('Handling list tools request', { serverId })
    const serverConfig = await mcpServerService.getById(serverId)
    const client = await application.get('MCPService').initClient(serverConfig)
    return client.listTools()
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const serverId = request.params._meta?.serverId
    if (typeof serverId !== 'string') throw new Error('Missing serverId in _meta')
    logger.debug('Handling call tool request', { serverId })
    const serverConfig = await mcpServerService.getById(serverId)
    const client = await application.get('MCPService').initClient(serverConfig)
    return client.callTool(request.params)
  })

  return server
}
