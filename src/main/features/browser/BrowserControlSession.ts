import { Mutex } from 'async-mutex'

import { executeBrowserOperation, type BrowserAutomationResult } from './automation'
import type { BrowserController } from './mcp/browserController'
import { BrowserSessionError } from './session/BrowserSessionError'

export class BrowserControlSession {
  private readonly paneRequests = new Mutex()
  private closing?: Promise<void>
  private readonly requests = new Set<Promise<unknown>>()

  async execute(
    name: string,
    args: Record<string, unknown>,
    tabId: string | undefined,
    callSignal: AbortSignal
  ): Promise<BrowserAutomationResult> {
    return this.run((controller, signal) => executeBrowserOperation(controller, name, args, tabId, signal), callSignal)
  }

  async run<T>(
    operation: (controller: BrowserController, signal: AbortSignal) => Promise<T>,
    callSignal: AbortSignal
  ): Promise<T> {
    if (this.closing) throw new BrowserSessionError('debugger_unavailable')
    const signal = this.controller.signal ? AbortSignal.any([callSignal, this.controller.signal]) : callSignal
    const invoke = async () => {
      signal.throwIfAborted()
      if (this.closing) throw new BrowserSessionError('debugger_unavailable')
      this.controller.assertAvailable?.()
      try {
        this.controller.beginTool?.(signal)
        return await operation(this.controller, signal)
      } finally {
        this.controller.finishTool?.()
      }
    }
    const request = this.serialize ? this.paneRequests.runExclusive(invoke) : invoke()
    this.requests.add(request)
    try {
      return await request
    } finally {
      this.requests.delete(request)
    }
  }

  get isClosing(): boolean {
    return this.closing !== undefined
  }

  close(): Promise<void> {
    return (this.closing ??= Promise.resolve().then(async () => {
      try {
        await this.controller.dispose()
      } finally {
        await Promise.allSettled(this.requests)
        this.onClosed()
      }
    }))
  }

  constructor(
    private readonly onClosed: () => void,
    private readonly controller: BrowserController,
    private readonly serialize = true
  ) {}
}
