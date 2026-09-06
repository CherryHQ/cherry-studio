import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import type { BrowserSessionService } from '../BrowserSessionService'
import { BrowserSessionError } from '../session/BrowserSessionError'
import { CdpBrowserController } from './controller'
import { toolDefinitions, toolHandlers } from './tools/registry'

const logger = loggerService.withContext('BrowserServer')

export class BrowserServer {
  public readonly server: McpServer
  private readonly controller: CdpBrowserController
  private closing?: Promise<void>
  private readonly requests = new Set<Promise<CallToolResult>>()

  close(): Promise<void> {
    return (this.closing ??= Promise.resolve().then(async () => {
      try {
        const results = await Promise.allSettled([this.controller.dispose(), this.server.close()])
        await Promise.allSettled(this.requests)
        const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []))
        if (errors.length) throw new AggregateError(errors, 'Failed to close browser server')
      } finally {
        this.onClosed()
      }
    }))
  }

  constructor(
    service: BrowserSessionService,
    private readonly onClosed: () => void
  ) {
    this.controller = new CdpBrowserController(service)
    this.server = new McpServer({ name: '@cherry/browser', version: '0.1.0' })

    for (const { name, description, inputSchema } of toolDefinitions) {
      this.server.registerTool(name, { description, inputSchema }, async (args, extra) => {
        if (this.closing) throw new BrowserSessionError('debugger_unavailable')
        const request = toolHandlers[name](this.controller, args, extra.signal)
        this.requests.add(request)
        try {
          return await request
        } finally {
          this.requests.delete(request)
        }
      })
    }

    this.server.server.onclose = () => {
      void this.close().catch((error) => logger.warn('Browser disconnect cleanup failed', { error }))
    }
  }
}

export default BrowserServer
