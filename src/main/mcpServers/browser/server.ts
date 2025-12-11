import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { Server as MCServer } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { app } from 'electron'

import { CdpBrowserController } from './controller'
import { toolDefinitions, toolHandlers } from './tools'

export class BrowserServer {
  public server: Server
  private controller = new CdpBrowserController()

  constructor() {
    const server = new MCServer(
      {
        name: 'browser',
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
      return {
        tools: toolDefinitions
      }
    })

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
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

    this.server = server
  }
}

export default BrowserServer
