import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { app } from 'electron'

import { CdpBrowserController } from './controller'
import { toolDefinitions, toolHandlers } from './tools'

export class BrowserServer {
  public mcpServer: McpServer
  private controller = new CdpBrowserController()

  /** Low-level Server instance (used by factory / InMemoryTransport) */
  public get server(): Server {
    return this.mcpServer.server
  }

  constructor() {
    this.mcpServer = new McpServer(
      {
        name: '@cherry/browser',
        version: '0.1.0'
      },
      {
        capabilities: {
          resources: {},
          tools: {}
        }
      }
    )

    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: toolDefinitions
      }
    })

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params
      const handler = toolHandlers[name]
      if (!handler) {
        throw new Error('Tool not found')
      }
      return handler(this.controller, args)
    })

    app.on('before-quit', () => {
      void this.controller.reset()
    })
  }
}

export default BrowserServer
