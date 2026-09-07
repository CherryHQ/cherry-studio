import { application } from '@application'
import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { BROWSER_TOOL_NAMES } from '@shared/ai/browserTools'
import { Mutex } from 'async-mutex'

import type { BrowserSessionService } from '../BrowserSessionService'
import { BrowserSessionError } from '../session/BrowserSessionError'
import type { BrowserController } from './browserController'
import { CdpBrowserController } from './controller'
import { OpenSchema } from './tools/open'
import { toolDefinitions, toolHandlers } from './tools/registry'

const logger = loggerService.withContext('BrowserServer')

export class BrowserServer {
  public readonly server: McpServer
  private readonly controller: BrowserController
  private readonly paneRequests = new Mutex()
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
    private readonly onClosed: () => void,
    controller?: BrowserController
  ) {
    this.controller = controller ?? new CdpBrowserController(service)
    this.server = new McpServer({ name: '@cherry/browser', version: '0.1.0' })

    const definitions = controller
      ? toolDefinitions.filter((tool) => BROWSER_TOOL_NAMES.some((name) => name === tool.name))
      : toolDefinitions
    for (const { name, description, inputSchema } of definitions) {
      this.server.registerTool(
        name,
        {
          description:
            controller && name === 'open'
              ? 'Navigate the current Agent session browser pane. The user sees the same page. Multiple tabs and private windows are unavailable.'
              : description,
          inputSchema:
            controller && name === 'open'
              ? OpenSchema.omit({ showWindow: true }).extend({
                  privateMode: OpenSchema.shape.privateMode.describe('Unsupported by this host; must be false.'),
                  newTab: OpenSchema.shape.newTab.describe('Unsupported by this host; must be false.')
                })
              : inputSchema
        },
        async (args, extra) => {
          if (this.closing) throw new BrowserSessionError('debugger_unavailable')
          this.controller.assertAvailable?.()
          const signal = this.controller.signal ? AbortSignal.any([extra.signal, this.controller.signal]) : extra.signal
          const invoke = () => {
            signal.throwIfAborted()
            if (
              controller &&
              application.get('PreferenceService').get('app.browser.tool_permissions')[
                name as (typeof BROWSER_TOOL_NAMES)[number]
              ] === 'deny'
            )
              throw new BrowserSessionError('not_allowed')
            this.controller.assertAvailable?.()
            return toolHandlers[name](this.controller, args, signal)
          }
          const request = controller ? this.paneRequests.runExclusive(invoke) : invoke()
          this.requests.add(request)
          try {
            return await request
          } finally {
            this.requests.delete(request)
          }
        }
      )
    }

    this.server.server.onclose = () => {
      void this.close().catch((error) => logger.warn('Browser disconnect cleanup failed', { error }))
    }
  }
}

export default BrowserServer
