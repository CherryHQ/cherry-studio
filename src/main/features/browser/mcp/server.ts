import { type CallToolResult, McpServer, type Transport } from '@modelcontextprotocol/server'
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio'

import { loggerService } from '@logger'
import { toolDefinitions, sessionToolDefinitions } from '@main/ai/mcp/browserToolDefinitions'

import { BrowserControlSession } from '../BrowserControlSession'
import type { BrowserSessionService } from '../BrowserSessionService'
import { BrowserSessionError } from '../session/BrowserSessionError'
import type { BrowserController } from './browserController'
import { CdpBrowserController } from './controller'
import { toolHandlers } from './tools/registry'

const logger = loggerService.withContext('BrowserServer')

export class BrowserServer {
  private readonly control: BrowserControlSession
  private readonly definitions: typeof toolDefinitions
  private readonly protocols = new Set<McpServer>()
  private closing?: Promise<void>

  constructor(
    service: BrowserSessionService,
    private readonly onClosed: () => void,
    controller?: BrowserController
  ) {
    this.definitions = controller ? sessionToolDefinitions : toolDefinitions
    this.control = new BrowserControlSession(() => {}, controller ?? new CdpBrowserController(service), !!controller)
  }

  callTool(name: string, args: unknown, signal: AbortSignal): Promise<CallToolResult> {
    if (this.closing) throw new BrowserSessionError('debugger_unavailable')
    const tool = this.definitions.find((tool) => tool.name === name)
    if (!tool) throw new BrowserSessionError('not_allowed')
    const parsed = tool.inputSchema.parse(args)
    return this.control.run((controller, signal) => toolHandlers[tool.name](controller, parsed, signal), signal)
  }

  createServer(): McpServer {
    const server = new McpServer({ name: '@cherry/browser', version: '0.1.0' })
    for (const { name, description, inputSchema } of this.definitions) {
      server.registerTool(name, { description, inputSchema }, (args, context) =>
        this.callTool(name, args, context.mcpReq.signal)
      )
    }
    this.protocols.add(server)
    return server
  }

  /** Serves one Agent connection; its disconnect releases this server's controller. */
  serve(transport: Transport): StdioServerHandle {
    return serveStdio(
      () => {
        const protocol = this.createServer()
        protocol.server.onclose = () => {
          void this.close().catch((error) => logger.warn('Browser disconnect cleanup failed', { error }))
        }
        return protocol
      },
      { transport }
    )
  }

  get isClosing(): boolean {
    return this.closing !== undefined
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
