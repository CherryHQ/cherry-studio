import { type CallToolResult, McpServer } from '@modelcontextprotocol/server'

import { toolDefinitions } from '@main/ai/mcp/browserToolDefinitions'

import { BrowserControlSession } from '../BrowserControlSession'
import type { BrowserSessionService } from '../BrowserSessionService'
import { BrowserSessionError } from '../session/BrowserSessionError'
import { CdpBrowserController } from './controller'
import { toolHandlers } from './tools/registry'

export class BrowserServer {
  private readonly control: BrowserControlSession
  private readonly protocols = new Set<McpServer>()
  private closing?: Promise<void>

  constructor(
    service: BrowserSessionService,
    private readonly onClosed: () => void
  ) {
    this.control = new BrowserControlSession(() => {}, new CdpBrowserController(service), false)
  }

  callTool(name: string, args: unknown, signal: AbortSignal): Promise<CallToolResult> {
    if (this.closing) throw new BrowserSessionError('debugger_unavailable')
    const tool = toolDefinitions.find((tool) => tool.name === name)
    if (!tool) throw new BrowserSessionError('not_allowed')
    const parsed = tool.inputSchema.parse(args)
    return this.control.run((controller, signal) => toolHandlers[tool.name](controller, parsed, signal), signal)
  }

  createServer(): McpServer {
    const server = new McpServer({ name: '@cherry/browser', version: '0.1.0' })
    for (const { name, description, inputSchema } of toolDefinitions) {
      server.registerTool(name, { description, inputSchema }, (args, context) =>
        this.callTool(name, args, context.mcpReq.signal)
      )
    }
    this.protocols.add(server)
    return server
  }

  close(): Promise<void> {
    return (this.closing ??= Promise.resolve().then(async () => {
      try {
        const results = await Promise.allSettled([
          this.control.close(),
          ...[...this.protocols].map((protocol) => protocol.close())
        ])
        const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []))
        if (errors.length) throw new AggregateError(errors, 'Failed to close browser server')
      } finally {
        this.onClosed()
      }
    }))
  }
}

export default BrowserServer
