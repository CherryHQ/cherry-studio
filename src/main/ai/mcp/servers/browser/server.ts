import { type ListToolsResult, Server } from '@modelcontextprotocol/server'

import { CdpBrowserController } from './controller'
import { toolDefinitions, toolHandlers } from './tools/registry'

export class BrowserServer {
  private readonly controller = new CdpBrowserController()

  public createServer(): Server {
    const server = new Server(
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

    server.setRequestHandler('tools/list', async (): Promise<ListToolsResult> => {
      return {
        tools: toolDefinitions
      }
    })

    server.setRequestHandler('tools/call', async (request) => {
      const { name, arguments: args } = request.params
      const handler = toolHandlers[name]
      if (!handler) {
        throw new Error('Tool not found')
      }
      return handler(this.controller, args)
    })

    return server
  }

  /** Releases the activation-scoped browser controller on stop/restart/remove. */
  public async close(): Promise<void> {
    await this.controller.reset()
  }
}

export default BrowserServer
