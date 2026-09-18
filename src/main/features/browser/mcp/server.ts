import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { Mutex } from 'async-mutex'

import { loggerService } from '@logger'
import { toolDefinitions, sessionToolDefinitions } from '@main/ai/mcp/browserToolDefinitions'

import type { BrowserSessionService } from '../BrowserSessionService'
import { BrowserSessionError } from '../session/BrowserSessionError'
import type { BrowserController } from './browserController'
import { CdpBrowserController } from './controller'
import { toolHandlers } from './tools/registry'

const logger = loggerService.withContext('BrowserServer')

export class BrowserServer {
  public readonly server: McpServer
  private readonly controller: BrowserController
  private readonly paneRequests = new Mutex()
  private closing?: Promise<void>
  private readonly calls = new Map<string, (args: unknown, signal: AbortSignal) => Promise<CallToolResult>>()

  callTool(name: string, args: unknown, signal: AbortSignal): Promise<CallToolResult> {
    const call = this.calls.get(name)
    if (!call) throw new BrowserSessionError('not_allowed')
    return call(args, signal)
  }

  private readonly requests = new Set<Promise<CallToolResult>>()

  get isClosing(): boolean {
    return this.closing !== undefined
  }

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
    private readonly onClosed: () => void,
    controller?: BrowserController
  ) {
    this.controller = controller ?? new CdpBrowserController(service)
    this.server = new McpServer({ name: '@cherry/browser', version: '0.1.0' })

    const definitions = controller ? sessionToolDefinitions : toolDefinitions
    for (const { name, description, inputSchema } of definitions) {
      this.calls.set(name, async (args, callSignal) => {
        const parsed = inputSchema.parse(args)
        if (this.closing) throw new BrowserSessionError('debugger_unavailable')
        this.controller.assertAvailable?.()
        const signal = this.controller.signal ? AbortSignal.any([callSignal, this.controller.signal]) : callSignal
        const invoke = async () => {
          signal.throwIfAborted()
          this.controller.assertAvailable?.()
          try {
            this.controller.beginTool?.(signal)
            return await toolHandlers[name](this.controller, parsed, signal)
          } finally {
            this.controller.finishTool?.()
          }
        }
        const request = controller ? this.paneRequests.runExclusive(invoke) : invoke()
        this.requests.add(request)
        try {
          return await request
        } finally {
          this.requests.delete(request)
        }
      })
      this.server.registerTool(
        name,
        {
          description,
          inputSchema
        },
        async (args, extra) => {
          return this.callTool(name, args, extra.signal)
        }
      )
    }

    this.server.server.onclose = () => {
      void this.close().catch((error) => logger.warn('Browser disconnect cleanup failed', { error }))
    }
  }
}

export default BrowserServer
