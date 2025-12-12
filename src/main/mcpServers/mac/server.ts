import { loggerService } from '@logger'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { Server as MCServer } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { toolDefinitions, toolHandlers } from './tools'

const logger = loggerService.withContext('MacMCP')

export class MacServer {
  public server: Server

  constructor() {
    logger.info('Initializing @cherry/mac MCP server')

    const server = new MCServer(
      {
        name: '@cherry/mac',
        version: '0.1.0'
      },
      {
        capabilities: {
          resources: {},
          tools: {}
        }
      }
    )

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug('Listing tools', { count: toolDefinitions.length })
      return {
        tools: toolDefinitions
      }
    })

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params
      logger.debug('Tool call received', { tool: name })

      const handler = toolHandlers[name]
      if (!handler) {
        logger.warn('Unknown tool requested', { tool: name })
        throw new Error(`Tool not found: ${name}`)
      }

      return handler(args)
    })

    this.server = server
  }
}

export default MacServer
